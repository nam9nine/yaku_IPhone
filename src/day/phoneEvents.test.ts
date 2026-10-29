import { describe, expect, it } from 'vitest';
import { dayReducer, initialDay, loadDay, validDay, type DayState } from './state';
import {
  appendPhoneEvent,
  recentPhoneEvents,
  validPhoneEventLog,
  type PhoneEventId,
} from './phoneEvents';

function tick(state: DayState, seconds: number): DayState {
  for (let n = 0; n < seconds; n++)
    state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: false });
  return state;
}
function connect(state: DayState) {
  return tick(dayReducer(state, { type: 'start-call', id: 'majima' }), 3);
}

describe('모델에 전달할 최근 가상 전화·체크 사건', () => {
  it('초기 문자열·부재중 예시를 새 행위로 등록하지 않는다', () => {
    const state = initialDay();
    expect(recentPhoneEvents(state, 'majima')).toEqual([]);
    expect(recentPhoneEvents(state, 'haruka')).toEqual([]);
    expect(dayReducer(state, { type: 'read-call' })).toBe(state);
  });
  it('부재중·연결 전 거절/취소·짧은 종료·완료 통화를 구분한다', () => {
    const ringing = dayReducer(initialDay(), { type: 'reminder', id: 'shopping', done: true });
    expect(recentPhoneEvents(tick(ringing, 20), 'majima')).toEqual(['majima-call-missed']);
    expect(recentPhoneEvents(dayReducer(ringing, { type: 'end-call' }), 'majima')).toEqual([
      'majima-call-declined',
    ]);
    expect(
      recentPhoneEvents(dayReducer(connect(initialDay()), { type: 'end-call' }), 'majima'),
    ).toEqual(['majima-call-short']);
    const completed = dayReducer(tick(connect(initialDay()), 12), { type: 'end-call' });
    expect(completed.storyMessages.majima).toHaveLength(0);
    expect(recentPhoneEvents(completed, 'majima')).toEqual(['majima-call-completed']);
    expect(validDay(completed)).toBe(true);
  });
  it('네 가지 체크 사건은 하루카에만 속하고 다른 인물의 통화·택배는 섞지 않는다', () => {
    let state = initialDay();
    for (const id of ['shopping', 'garden', 'mame', 'uniform', 'parcel'] as const)
      state = dayReducer(state, { type: 'reminder', id, done: true });
    expect(recentPhoneEvents(state, 'haruka')).toEqual([
      'haruka-shopping-checked',
      'haruka-garden-checked',
      'haruka-mame-checked',
      'haruka-uniform-checked',
    ]);
    expect(recentPhoneEvents(state, 'majima')).toEqual([]);
    expect(recentPhoneEvents(state, 'date')).toEqual([]);
    state = dayReducer(state, { type: 'end-call' });
    const before = recentPhoneEvents(state, 'majima');
    state = dayReducer(state, { type: 'start-call', id: 'date' });
    state = dayReducer(tick(state, 3), { type: 'end-call' });
    expect(recentPhoneEvents(state, 'majima')).toEqual(before);
    expect(recentPhoneEvents(state, 'haruka')).toHaveLength(4);
  });
  it('동일 유형은 최신 위치 하나로 옮기고 최대 네 개만 반환한다', () => {
    let state = initialDay();
    for (const event of [
      'majima-call-missed',
      'majima-call-declined',
      'majima-call-short',
      'majima-call-completed',
      'majima-call-missed',
    ] as PhoneEventId[]) {
      state = { ...state, phoneEvents: appendPhoneEvent(state.phoneEvents, event) };
    }
    expect(recentPhoneEvents(state, 'majima')).toEqual([
      'majima-call-declined',
      'majima-call-short',
      'majima-call-completed',
      'majima-call-missed',
    ]);
    const malformed = {
      ...state,
      phoneEvents: {
        ...state.phoneEvents,
        majima: [
          ...state.phoneEvents.majima,
          'haruka-garden-checked',
          'majima-call-short',
          'majima-call-short',
        ] as PhoneEventId[],
      },
    };
    expect(recentPhoneEvents(malformed, 'majima')).toEqual([
      'majima-call-declined',
      'majima-call-completed',
      'majima-call-missed',
      'majima-call-short',
    ]);
    expect(validPhoneEventLog(malformed.phoneEvents)).toBe(false);
    expect(validPhoneEventLog({ haruka: ['majima-call-missed'], majima: [] })).toBe(false);
  });
  it('체크를 다시 켜면 사건은 최신으로 이동하지만 후속 문자·전화는 반복하지 않는다', () => {
    let state = dayReducer(initialDay(), { type: 'reminder', id: 'garden', done: true });
    state = dayReducer(state, { type: 'reminder', id: 'mame', done: true });
    const sequence = state.storySequence;
    state = dayReducer(state, { type: 'reminder', id: 'garden', done: false });
    state = dayReducer(state, { type: 'reminder', id: 'garden', done: true });
    expect(recentPhoneEvents(state, 'haruka')).toEqual([
      'haruka-mame-checked',
      'haruka-garden-checked',
    ]);
    expect(state.storySequence).toBe(sequence);
  });
  it('재접속은 기록 순서를 보존하고 초기화는 두 인물 모두 지운다', () => {
    let state = dayReducer(initialDay(), { type: 'reminder', id: 'garden', done: true });
    state = dayReducer(connect(state), { type: 'end-call' });
    const restored = loadDay({ getItem: () => JSON.stringify(state) }).state;
    expect(restored.phoneEvents).toEqual(state.phoneEvents);
    expect(dayReducer(restored, { type: 'reset' }).phoneEvents).toEqual({ haruka: [], majima: [] });
  });
  it('구버전 저장에서 완료된 체크·통화는 보존하되 AI 사건으로 소급 작성하지 않는다', () => {
    let state = dayReducer(initialDay(), { type: 'reminder', id: 'garden', done: true });
    state = dayReducer(connect(state), { type: 'end-call' });
    const old: Partial<DayState> = { ...state };
    delete old.phoneEvents;
    const restored = loadDay({ getItem: () => JSON.stringify(old) }).state;
    expect(restored.reminders.garden).toBe(true);
    expect(restored.callLog).toEqual(state.callLog);
    expect(restored.storyMessages).toEqual(state.storyMessages);
    expect(restored.phoneEvents).toEqual({ haruka: [], majima: [] });
    expect(validDay(restored)).toBe(true);
  });
});
