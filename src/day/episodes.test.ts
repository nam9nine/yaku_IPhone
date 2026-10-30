import { expect, it } from 'vitest';
import { dayReducer, initialDay, loadDay, validDay, type DayState } from './state';
const episode = { actionId: 'action-1', callId: 'episode-call-1', scope: 'visitor-a' };
function begin() {
  const enabled = dayReducer(initialDay(), { type: 'set-episodes', enabled: true });
  return dayReducer(enabled, { type: 'episode-call', episode });
}
it('an episode call records one durable outcome, with no duplicate legacy text or followup', () => {
  const initial = begin();
  expect(initial.call?.id).toBe(episode.callId);
  const ended = dayReducer(initial, { type: 'miss-call', reason: 'missed' });
  expect(ended.pendingEpisodeOutcomes).toEqual([{ ...episode, outcome: 'missed' }]);
  expect(ended.pendingCallFollowups).toEqual([]);
  expect(ended.storyMessages.majima).toEqual([]);
  expect(dayReducer(ended, { type: 'episode-call', episode }).call).toBeNull();
  expect(validDay(ended)).toBe(true);
  const ack = dayReducer(ended, {
    type: 'ack-episode-outcome',
    callId: episode.callId,
    scope: episode.scope,
  });
  expect(ack.pendingEpisodeOutcomes).toEqual([]);
  expect(dayReducer(ack, { type: 'episode-call', episode }).call).toBeNull();
});
it.each(['missed', 'declined'] as const)(
  'preserves %s outcomes through reload and acknowledges only their scope',
  (reason) => {
    const ended = dayReducer(begin(), { type: 'miss-call', reason });
    const loaded = loadDay({ getItem: () => JSON.stringify(ended) }).state;
    expect(loaded.pendingEpisodeOutcomes).toEqual([{ ...episode, outcome: reason }]);
    expect(
      dayReducer(loaded, { type: 'ack-episode-outcome', callId: episode.callId, scope: 'other' })
        .pendingEpisodeOutcomes,
    ).toHaveLength(1);
  },
);
it('reload closes an episode call without ringing it again and keeps its report', () => {
  const loaded = loadDay({ getItem: () => JSON.stringify(begin()) }).state;
  expect(loaded.call).toBeNull();
  expect(loaded.pendingEpisodeOutcomes).toEqual([{ ...episode, outcome: 'missed' }]);
});
it('manual end and peer idle have distinct outcomes and no scripted SMS', () => {
  const connected = dayReducer(begin(), { type: 'answer-call' });
  const ended = dayReducer(connected, { type: 'end-call' });
  const waiting = {
    ...connected,
    call: { ...connected.call!, activityEnabled: true, idleMs: 60_000 },
  };
  const idle = dayReducer(waiting, {
    type: 'peer-end-call',
    callId: episode.callId,
    reason: 'idle',
  });
  expect(ended.pendingEpisodeOutcomes[0].outcome).toBe('ended');
  expect(idle.pendingEpisodeOutcomes[0].outcome).toBe('idle');
  expect(ended.storyMessages.majima).toEqual([]);
  expect(idle.pendingCallFollowups).toEqual([]);
});
it('enabled episodes suppress the legacy Majima schedule while other callers remain', () => {
  let state: DayState = {
    ...initialDay(),
    episodesEnabled: true,
    nextMajimaTextInMs: 0,
    nextCallInMs: 0,
  };
  state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: true });
  expect(state.call?.caller).toBe('daigo');
  expect(state.storyMessages.majima).toEqual([]);
  state = dayReducer(state, { type: 'end-call' });
  state = { ...state, nextCallInMs: 0 };
  state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: true });
  expect(state.call?.caller).toBe('haruka');
});
it('old stored state migrates without enabling episodes or changing messages', () => {
  const stored = { ...initialDay() } as Partial<DayState>;
  delete stored.episodesEnabled;
  delete stored.pendingEpisodeOutcomes;
  const loaded = loadDay({ getItem: () => JSON.stringify(stored) });
  expect(loaded.unavailable).toBe(false);
  expect(loaded.state.episodesEnabled).toBe(false);
  expect(loaded.state.pendingEpisodeOutcomes).toEqual([]);
});
