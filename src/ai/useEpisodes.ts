import { useEffect, useLayoutEffect, useRef } from 'react';
import { useDay } from '../day/DayContext';
import { affinityTone } from '../day/state';
import { configuredEndpoint, readAiResetId } from './connection';
import { blocksUserInput } from './messenger';
import {
  episodeRequest,
  episodeAvailable,
  episodeScope,
  type EpisodeReport,
  type EpisodeCallAction,
  type EpisodeStatus,
} from './episodes';
import type { AiMessengerView } from './useAiMessenger';

const CLIENT_KEY = 'yaku-iphone.episode-client.v1';
function clientIdentity(): { id: string; sequence: number } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CLIENT_KEY) ?? 'null');
    if (
      typeof saved?.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(saved.id) &&
      Number.isSafeInteger(saved.sequence) &&
      saved.sequence >= 0
    )
      return saved;
  } catch {
    /* Current page still works without storage. */
  }
  return { id: crypto.randomUUID(), sequence: 0 };
}

/** The server owns the story. This hook reports foreground activity and executes claimed UI actions. */
export function useEpisodes(ai: AiMessengerView, online: boolean, unlocked: boolean): void {
  const day = useDay();
  const latest = useRef({ ai, day, online, unlocked });
  useLayoutEffect(() => {
    latest.current = { ai, day, online, unlocked };
  });
  const identity = useRef<ReturnType<typeof clientIdentity> | null>(null);
  if (identity.current === null) identity.current = clientIdentity();
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    const prepare = async () => {
      const endpoint = configuredEndpoint();
      if (
        !endpoint ||
        checking ||
        !online ||
        !unlocked ||
        document.hidden ||
        latest.current.ai.status === 'ready'
      )
        return;
      checking = true;
      try {
        if (await episodeAvailable(endpoint, controller.signal)) {
          if (
            !controller.signal.aborted &&
            latest.current.online &&
            latest.current.unlocked &&
            !document.hidden
          )
            await ai.messenger.prepareEpisodes();
        }
      } catch {
        /* An unavailable episode service does not change ordinary chat. */
      } finally {
        checking = false;
      }
    };
    void prepare();
    const timer = window.setInterval(() => {
      void prepare();
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [ai.connection, ai.messenger, online, unlocked]);

  useEffect(() => {
    const connection = ai.connection;
    if (!connection || !online || ai.status !== 'ready') return;
    const scope = episodeScope(connection);
    const reset = readAiResetId();
    const controller = new AbortController();
    let live = true;
    let busy = false;
    let again = false;
    let status: EpisodeStatus | null = null;
    const claimKey = `yaku-iphone.episode-claim.${scope}`;
    let pendingClaim: EpisodeCallAction | null = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(claimKey) ?? 'null');
      if (
        saved?.kind === 'call' &&
        typeof saved.id === 'string' &&
        typeof saved.call_id === 'string'
      )
        pendingClaim = saved;
    } catch {
      /* Retries remain possible in this page. */
    }
    const rememberClaim = (action: EpisodeCallAction | null) => {
      pendingClaim = action;
      try {
        if (action) sessionStorage.setItem(claimKey, JSON.stringify(action));
        else sessionStorage.removeItem(claimKey);
      } catch {
        /* Do not change server ownership on storage failure. */
      }
    };
    const current = () =>
      live && readAiResetId() === reset && latest.current.ai.connection?.token === connection.token;
    const active = () => {
      const state = latest.current;
      return (
        state.online &&
        state.unlocked &&
        !document.hidden &&
        !state.day.state.call &&
        !Object.values(state.ai.threads).some(blocksUserInput)
      );
    };
    const report = async (value: EpisodeReport, keepalive = false) => {
      const client = identity.current!;
      client.sequence++;
      try {
        sessionStorage.setItem(CLIENT_KEY, JSON.stringify(client));
      } catch {
        /* Memory counter remains monotonic. */
      }
      return episodeRequest(
        connection,
        keepalive ? undefined : controller.signal,
        { ...value, client_id: client.id, sequence: client.sequence },
        keepalive,
      );
    };
    const apply = (result: EpisodeStatus) => {
      if (!current()) return;
      status = result;
      latest.current.ai.messenger.setEpisodeProtocol(true);
      latest.current.day.dispatch({ type: 'set-episodes', enabled: result.enabled });
    };
    const execute = async () => {
      if (!current()) return;
      const outcome = latest.current.day.state.pendingEpisodeOutcomes.find(
        (item) => item.scope === scope,
      );
      if (outcome) {
        const result = await report({
          kind: 'call_result',
          call_id: outcome.callId,
          outcome: outcome.outcome,
        });
        if (!current()) return;
        apply(result);
        if (result.accepted)
          latest.current.day.dispatch({
            type: 'ack-episode-outcome',
            callId: outcome.callId,
            scope,
          });
      }
      if (!status?.enabled || !active()) return;
      if (
        pendingClaim &&
        (latest.current.day.state.call?.id === pendingClaim.call_id ||
          latest.current.day.state.callLog.some((call) => call.id === pendingClaim?.call_id))
      )
        rememberClaim(null);
      const action = status.action ?? pendingClaim;
      if (action?.kind === 'message') {
        await latest.current.ai.messenger.watchEpisodeJob(action.job_id);
        if (!current()) return;
        if (latest.current.ai.messenger.episodeDelivered(action.job_id))
          apply(await report({ kind: 'delivered', action_id: action.id, job_id: action.job_id }));
      } else if (action?.kind === 'call') {
        const claim = async () => {
          if (!current() || !active()) return;
          rememberClaim(action);
          const result = await report({
            kind: 'call_started',
            action_id: action.id,
            call_id: action.call_id,
          });
          if (!current()) return;
          apply(result);
          const marker = `yaku-iphone.episode-call.${scope}.${action.call_id}`;
          let alreadyStarted = false;
          try {
            alreadyStarted = localStorage.getItem(marker) === 'started';
          } catch {
            /* The server claim still prevents another owner. */
          }
          if (result.accepted && active() && !alreadyStarted) {
            try {
              localStorage.setItem(marker, 'started');
            } catch {
              /* Current tab still works. */
            }
            latest.current.day.dispatch({
              type: 'episode-call',
              episode: { actionId: action.id, callId: action.call_id, scope },
            });
          } else if (result.accepted && !alreadyStarted)
            apply(await report({ kind: 'call_result', call_id: action.call_id, outcome: 'ended' }));
          rememberClaim(null);
        };
        if (navigator.locks)
          await navigator.locks.request(`yaku-episode-${scope}-${action.id}`, claim);
        else await claim();
      }
    };
    const pump = async () => {
      if (!current()) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        if (!status || !status.enabled) apply(await episodeRequest(connection, controller.signal));
        if (!current() || !status?.enabled) return;
        apply(
          await report({
            kind: 'presence',
            active: active(),
            relationship_tone: affinityTone(latest.current.day.state),
          }),
        );
        await execute();
      } catch {
        /* Retry server-owned actions; no fake text or user-facing setup is introduced. */
      } finally {
        busy = false;
        if (again && current()) {
          again = false;
          void pump();
        }
      }
    };
    wake.current = () => {
      void pump();
    };
    const visibility = () => {
      void pump();
    };
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => {
      void pump();
    }, 10_000);
    void pump();
    return () => {
      live = false;
      wake.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      controller.abort();
      if (status?.enabled && readAiResetId() === reset)
        void report(
          {
            kind: 'presence',
            active: false,
            relationship_tone: affinityTone(latest.current.day.state),
          },
          true,
        ).catch(() => {});
    };
  }, [ai.connection, ai.messenger, ai.status, online]);

  const blocked = Object.values(ai.threads).some(blocksUserInput);
  useEffect(() => {
    wake.current?.();
  }, [
    unlocked,
    blocked,
    day.state.call?.id,
    day.state.pendingEpisodeOutcomes.length,
    ai.arrival?.id,
  ]);
}
