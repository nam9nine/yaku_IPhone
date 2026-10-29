import { useEffect, useRef, useState } from 'react';
import type { AiConnection } from './connection';
import type { AiReplyArrival } from './messenger';
import { aiRequest } from './client';
import { PUSH_SETTINGS_EVENT, readPushBinding } from './push';
import type { PushBinding } from './pushBinding';

/** Defer OS push for this subscribed device, then acknowledge actual UI delivery.
 * A 25-second server lease expires if a page dies before its inactive update. */
export function usePushPresence(
  connection: AiConnection | null,
  inConversation: boolean,
  arrival: AiReplyArrival | null,
) {
  const [clientId] = useState(() => crypto.randomUUID());
  const sequence = useRef(0);
  const pendingReceipts = useRef<{ scope: string; ids: Set<string>; seen: Set<string> } | null>(
    null,
  );
  const reportArrival = useRef<((jobIds: string[]) => void) | null>(null);
  useEffect(() => {
    if (!connection) return;
    let stopped = false;
    let binding: PushBinding | null = null;
    const scope = connection.endpoint + ':' + connection.token;
    if (pendingReceipts.current?.scope !== scope)
      pendingReceipts.current = { scope, ids: new Set<string>(), seen: new Set<string>() };
    const receipts = pendingReceipts.current.ids;
    const seen = pendingReceipts.current.seen;
    const isActive = () => !stopped && inConversation && !document.hidden;
    async function report(inactive = false) {
      const revision = ++sequence.current;
      const active = !inactive && isActive();
      const jobIds = [...receipts].slice(0, 32);
      try {
        const current = inactive && binding ? binding : await readPushBinding(connection);
        if (!current || revision !== sequence.current || (!inactive && stopped)) return;
        binding = current;
        await aiRequest(connection!.endpoint, '/v1/push/subscriptions', {
          token: connection!.token,
          keepalive: true,
          body: {
            presence: {
              subscription_id: current.id,
              client_id: clientId,
              sequence: revision,
              active,
              job_ids: jobIds,
            },
          },
        });
        jobIds.forEach((id) => receipts.delete(id));
      } catch {
        /* No receipt on failure: the server falls back to normal push. */
      }
    }
    const refresh = () => {
      void report();
    };
    const leave = () => {
      void report(true);
    };
    reportArrival.current = (jobIds) => {
      if (isActive())
        for (const jobId of jobIds) {
          if (seen.has(jobId)) continue;
          seen.add(jobId);
          receipts.add(jobId);
          if (seen.size > 200) seen.delete(seen.values().next().value!);
        }
      void report();
    };
    refresh();
    const timer = setInterval(() => {
      if (isActive()) refresh();
    }, 10_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', leave);
    window.addEventListener(PUSH_SETTINGS_EVENT, refresh);
    return () => {
      stopped = true;
      reportArrival.current = null;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener(PUSH_SETTINGS_EVENT, refresh);
      leave();
    };
  }, [connection, inConversation, clientId]);
  useEffect(() => {
    reportArrival.current?.(arrival?.deliveredJobIds ?? (arrival?.jobId ? [arrival.jobId] : []));
  }, [arrival, connection, inConversation]);
}
