import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiMessenger, blocksUserInput } from './messenger';
import { AI_ENDPOINT } from './config';
import type { AiMessage } from './client';
import { validEpisodeStatus, episodeRequest } from './episodes';
const connection = { endpoint: AI_ENDPOINT, token: 'episode-session' };
const stores: AiMessenger[] = [];
const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  stores.splice(0).forEach((store) => store.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function service() {
  const state = {
    history: [] as AiMessage[],
    chats: [] as Record<string, string>[],
    complete: false,
    held: null as null | (() => void),
    holdPoll: false,
    followup: false,
    queued: false,
  };
  const fetch = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/health') return Response.json({ status: 'ready' });
    if (parsed.pathname === '/v1/history')
      return Response.json({ messages: state.history, pending_job: null, next_cursor: null });
    if (parsed.pathname === '/v1/chat') {
      const body = JSON.parse(String(options?.body));
      state.chats.push(body);
      return Response.json({ job_id: `user-${body.character}`, status: 'queued' });
    }
    if (parsed.pathname === '/v1/jobs/episode-job') {
      if (state.holdPoll)
        await new Promise<void>((resolve) => {
          state.held = resolve;
        });
      if (state.complete && !state.history.length)
        state.history.push({
          id: 'invite',
          role: 'assistant',
          content: '키류쨩, 볼링 한 판 하자!',
          time: new Date().toISOString(),
          request_id: 'invite-request',
          job_id: 'episode-job',
          status: 'complete',
          request_kind: state.followup ? 'call_followup' : 'proactive_episode',
        });
      return Response.json({
        job_id: 'episode-job',
        character: 'majima',
        status: state.complete ? 'complete' : state.queued ? 'queued' : 'generating',
        request_kind: state.followup ? 'call_followup' : 'proactive_episode',
        request: {
          kind: state.followup ? 'call_followup' : 'proactive_episode',
          episode: {
            episode_id: 'majima-bowling-v1',
            instance_id: 'fixture',
            version: 1,
            stage: state.followup ? 'followup' : 'invite',
          },
          ...(state.followup
            ? { trigger: { call_id: 'call-1', reason: 'missed', direction: 'incoming' } }
            : {}),
          id: 'invite-request',
          time: new Date().toISOString(),
          phone_events: [],
        },
      });
    }
    if (parsed.pathname.startsWith('/v1/jobs/user-')) {
      const character = parsed.pathname.endsWith('majima') ? 'majima' : 'haruka';
      const body = state.chats.find((item) => item.character === character)!;
      return Response.json({
        job_id: `user-${character}`,
        character,
        status: 'generating',
        request: { id: body.request_id, message: body.message, time: new Date().toISOString() },
      });
    }
    throw new Error('Unexpected endpoint: ' + parsed.pathname);
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}
async function store() {
  const value = new AiMessenger(connection);
  stores.push(value);
  await value.activate('majima');
  value.setEpisodeProtocol(true);
  return value;
}
it('adopts an assistant-only invitation and delivers it once without a fabricated user message', async () => {
  const { state, fetch } = service();
  const value = await store();
  state.complete = true;
  await value.watchEpisodeJob('episode-job');
  await vi.advanceTimersByTimeAsync(32_000);
  const thread = value.getSnapshot().threads.majima;
  expect(thread.displayedMessages.map((message) => message.role)).toEqual(['assistant']);
  expect(value.episodeDelivered('episode-job')).toBe(true);
  const arrival = value.getSnapshot().arrival;
  await value.watchEpisodeJob('episode-job');
  await flush();
  expect(value.getSnapshot().arrival).toBe(arrival);
  expect(state.chats).toEqual([]);
  expect(fetch.mock.calls.some(([url]) => url.includes('/v1/jobs/episode-job?episodes=1'))).toBe(
    true,
  );
});
it('an old held proactive poll cannot clear or replace the new user request', async () => {
  const { state } = service();
  const value = await store();
  state.holdPoll = true;
  const oldPoll = value.watchEpisodeJob('episode-job');
  await flush();
  expect(blocksUserInput(value.getSnapshot().threads.majima)).toBe(false);
  expect(value.send('majima', '형님 오늘은 안 됩니다.', true, true)).toBe(true);
  await flush();
  const requestId = value.getSnapshot().threads.majima.pending?.requestId;
  state.complete = true;
  state.held!();
  await oldPoll;
  await flush();
  expect(value.getSnapshot().threads.majima.pending?.requestId).toBe(requestId);
  expect(value.getSnapshot().threads.majima.pending?.jobId).toBe('user-majima');
  expect(value.getSnapshot().threads.majima.error).toBeNull();
  expect(value.getSnapshot().threads.majima.messages).toEqual([]);
  expect(value.getSnapshot().arrival).toBeNull();
});
it('proactive waiting and a normal request to the other contact do not lock the user out', async () => {
  const { state } = service();
  const value = await store();
  await value.watchEpisodeJob('episode-job');
  await value.activate('haruka');
  expect(value.send('haruka', '알았다.', true, true)).toBe(true);
  expect(value.send('majima', '볼링은 내일 하죠.', true, true)).toBe(true);
  await flush();
  expect(state.chats.map((row) => row.character)).toEqual(['haruka', 'majima']);
});
it('reset ignores an old invitation result', async () => {
  const { state } = service();
  const value = await store();
  state.holdPoll = true;
  const oldPoll = value.watchEpisodeJob('episode-job');
  await flush();
  value.stop();
  state.complete = true;
  state.held!();
  await oldPoll;
  expect(value.getSnapshot().arrival).toBeNull();
  expect(value.getSnapshot().threads.majima.messages).toEqual([]);
});
it('validates the episode contract and sends only explicit protocol reports', async () => {
  const response = {
    protocol: 1,
    enabled: true,
    episode: {
      episode_id: 'majima-bowling-v1',
      instance_id: 'instance',
      version: 1,
      phase: 'awaiting_reply',
      contact_stage: 'invitation',
    },
    action: { kind: 'call', id: 'action', call_id: 'call' },
  };
  expect(validEpisodeStatus(response)).toBe(true);
  expect(validEpisodeStatus({ ...response, protocol: 2 })).toBe(false);
  expect(validEpisodeStatus({ ...response, action: { kind: 'call', id: 'action' } })).toBe(false);
  const fetch = vi.fn(async () => Response.json(response));
  vi.stubGlobal('fetch', fetch);
  await episodeRequest(connection, undefined, {
    client_id: 'client',
    sequence: 1,
    kind: 'presence',
    active: false,
    relationship_tone: 'neutral',
  });
  expect(
    JSON.parse(String((fetch.mock.calls as unknown as [string, RequestInit][])[0][1].body)),
  ).toEqual({
    protocol: 1,
    client_id: 'client',
    sequence: 1,
    kind: 'presence',
    active: false,
    relationship_tone: 'neutral',
  });
});

it('already committed invitation stays in history without a late notification when user overrides', async () => {
  const { state } = service();
  const value = await store();
  state.complete = true;
  await value.watchEpisodeJob('episode-job');
  expect(value.getSnapshot().threads.majima.proactiveDeliveryPending).toBe(true);
  expect(value.send('majima', '형님, 오늘은 쉽니다.', true, true)).toBe(true);
  await flush();
  expect(value.getSnapshot().threads.majima.displayedMessages.map((message) => message.id)).toEqual(
    ['invite'],
  );
  expect(value.getSnapshot().arrival).toBeNull();
  value.stop();
  const reloaded = await store();
  await vi.advanceTimersByTimeAsync(32_000);
  expect(
    reloaded.getSnapshot().threads.majima.displayedMessages.map((message) => message.id),
  ).toEqual(['invite']);
  expect(reloaded.getSnapshot().arrival).toBeNull();
  expect(reloaded.getSnapshot().threads.majima.typing).toBe(false);
});

it.each(['queued', 'generating'] as const)(
  'episode followup %s allows input after its first poll and ignores a late result',
  async (phase) => {
    const { state } = service();
    state.followup = true;
    state.queued = phase === 'queued';
    const value = await store();
    await value.watchEpisodeJob('episode-job');
    const pending = value.getSnapshot().threads.majima.pending!;
    expect(pending.kind).toBe('call_followup');
    expect(pending.episode?.stage).toBe('followup');
    expect(blocksUserInput(value.getSnapshot().threads.majima)).toBe(false);
    // Ordinary call followups keep their existing input guard.
    expect(
      blocksUserInput({
        ...value.getSnapshot().threads.majima,
        pending: { ...pending, episode: undefined, episodeOwned: undefined },
      }),
    ).toBe(true);
    state.holdPoll = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(state.held).not.toBeNull();
    expect(value.send('majima', '형님 전화는 못 받았습니다. 지금은 됩니다.', true, true)).toBe(
      true,
    );
    await flush();
    const newRequest = value.getSnapshot().threads.majima.pending?.requestId;
    state.complete = true;
    state.held!();
    await flush();
    expect(value.getSnapshot().threads.majima.pending?.requestId).toBe(newRequest);
    expect(value.getSnapshot().threads.majima.pending?.jobId).toBe('user-majima');
    expect(value.getSnapshot().threads.majima.pending?.kind).not.toBe('call_followup');
    expect(value.getSnapshot().threads.majima.error).toBeNull();
    expect(value.getSnapshot().threads.majima.displayedMessages).toEqual([]);
    expect(value.getSnapshot().arrival).toBeNull();
  },
);
