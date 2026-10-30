import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiMessenger } from './messenger';
import { AI_ENDPOINT } from './config';
import type { AiMessage } from './client';
const connection = { endpoint: AI_ENDPOINT, token: 'test-session' };
const trigger = { call_id: 'call-1:unique', reason: 'missed', direction: 'incoming' } as const;
const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
const stores: AiMessenger[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
});
afterEach(() => {
  stores.splice(0).forEach((s) => s.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function service() {
  const state = {
    hold: false,
    losePost: false,
    losePoll: false,
    pollCount: 0,
    calls: [] as Record<string, unknown>[],
    history: [] as AiMessage[],
    job: null as null | { id: string; requestId: string; complete: boolean },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === '/v1/health') return Response.json({ status: 'ready' });
      if (path === '/v1/sessions') return Response.json({ token: 'test-session' });
      if (path === '/v1/history')
        return Response.json({
          messages: state.history,
          pending_job: state.job && !state.job.complete ? state.job.id : null,
          next_cursor: null,
          completed_exchanges: 0,
        });
      if (path === '/v1/call-followups') {
        const body = JSON.parse(String(options?.body));
        state.calls.push(body);
        state.job ??= { id: 'follow-job', requestId: body.request_id, complete: false };
        if (state.losePost) {
          state.losePost = false;
          throw new Error('lost response');
        }
        return Response.json({ job_id: state.job.id, status: 'queued' });
      }
      if (path === '/v1/jobs/follow-job') {
        state.pollCount++;
        if (state.losePoll) {
          state.losePoll = false;
          throw new Error('lost status');
        }
        const job = state.job!;
        if (!state.hold && !job.complete) {
          job.complete = true;
          state.history.push({
            id: 'follow-assistant',
            role: 'assistant',
            content: '키류쨩, 전화 오면 받아라. 할 말 있다!',
            time: new Date().toISOString(),
            status: 'complete',
            request_id: job.requestId,
            job_id: job.id,
            request_kind: 'call_followup',
          });
        }
        return Response.json({
          job_id: job.id,
          character: 'majima',
          status: job.complete ? 'complete' : 'generating',
          request_kind: 'call_followup',
          request: {
            id: job.requestId,
            kind: 'call_followup',
            trigger,
            time: new Date().toISOString(),
            relationship_tone: 'warm',
            phone_events: [],
          },
        });
      }
      throw new Error('Unexpected endpoint ' + path);
    }),
  );
  return state;
}
function store() {
  const s = new AiMessenger(connection);
  stores.push(s);
  return s;
}
it('background event produces only an assistant message immediately, without a fictional user turn or typing delay', async () => {
  const remote = service();
  const s = store();
  expect(await s.followUp('majima', 'request-1', trigger, 'warm')).toBe(true);
  await flush();
  expect(remote.calls).toHaveLength(1);
  expect(remote.calls[0]).not.toHaveProperty('message');
  const thread = s.getSnapshot().threads.majima;
  expect(thread.displayedMessages.map((m) => m.role)).toEqual(['assistant']);
  expect(thread.pending).toBeNull();
  expect(thread.typing).toBe(false);
  expect(s.getSnapshot().notification?.text).toContain('키류쨩');
});
it('lost acceptance retries the same UUID and repeated call aliases reconcile to the canonical request', async () => {
  const remote = service();
  remote.losePost = true;
  remote.hold = true;
  const s = store();
  expect(await s.followUp('majima', 'request-1', trigger, 'warm')).toBe(false);
  expect(await s.followUp('majima', 'request-1', trigger, 'warm')).toBe(true);
  await flush();
  remote.hold = false;
  await vi.advanceTimersByTimeAsync(1000);
  await flush();
  expect(remote.history).toHaveLength(1);
  expect(await s.followUp('majima', 'alias-request', trigger, 'warm')).toBe(true);
  await flush();
  expect(s.getSnapshot().threads.majima.displayedMessages).toHaveLength(1);
  expect(s.getSnapshot().threads.majima.deliveryPending).toBe(false);
  expect(remote.calls.slice(0, 2).map((c) => c.request_id)).toEqual(['request-1', 'request-1']);
});
it('a pending assistant-only job survives reload and restores its quick delivery kind', async () => {
  const remote = service();
  remote.hold = true;
  const first = store();
  expect(await first.followUp('majima', 'request-1', trigger, 'warm')).toBe(true);
  await flush();
  first.stop();
  const restored = store();
  await restored.activate('majima');
  await flush();
  expect(restored.getSnapshot().threads.majima.pending?.kind).toBe('call_followup');
  expect(restored.getSnapshot().threads.majima.pending?.message).toBe('');
  remote.hold = false;
  await vi.advanceTimersByTimeAsync(1000);
  await flush();
  expect(restored.getSnapshot().threads.majima.displayedMessages.map((m) => m.role)).toEqual([
    'assistant',
  ]);
  expect(restored.getSnapshot().threads.majima.deliveryPending).toBe(false);
});

it('a failed status poll is recovered before a different call event, without regenerating the accepted job', async () => {
  const remote = service();
  remote.losePoll = true;
  const s = store();
  expect(await s.followUp('majima', 'request-1', trigger, 'warm')).toBe(true);
  await flush();
  expect(s.getSnapshot().threads.majima.pending?.phase).toBe('failed');
  expect(
    await s.followUp('majima', 'request-2', { ...trigger, call_id: 'call-2:unique' }, 'warm'),
  ).toBe(true);
  await flush();
  expect(remote.pollCount).toBeGreaterThan(1);
  expect(remote.calls.map((c) => c.request_id)).toEqual(['request-1', 'request-2']);
  expect(remote.history).toHaveLength(1);
});
