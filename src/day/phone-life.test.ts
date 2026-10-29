import { describe, expect, it } from 'vitest';
import { dayReducer, initialDay, getStoryChoices, loadDay, validDay } from './state';

describe('phone life consequences', () => {
  it('counts one Majima call consequence without changing other relationships', () => {
    let state = dayReducer(initialDay(), { type: 'start-call', id: 'majima' });
    state = dayReducer(state, { type: 'end-call' });
    expect(state.affinity).toBe(-1);
    expect(dayReducer(state, { type: 'end-call' })).toBe(state);
    state = dayReducer(state, { type: 'start-call', id: 'majima' });
    for (let i = 0; i < 15; i++)
      state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: true });
    state = dayReducer(state, { type: 'end-call' });
    expect(state.affinity).toBe(0);
    state = dayReducer(state, { type: 'start-call', id: 'date' });
    state = dayReducer(state, { type: 'end-call' });
    expect(state.affinity).toBe(0);
  });
  it('does not rewrite idle locked storage on every second', () => {
    const state = initialDay();
    expect(dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: false })).toBe(state);
  });
});

it('하루카의 네 퀘스트 답장을 모두 마쳐도 재접속에 진행이 유지된다', () => {
  let state = initialDay();
  for (const id of ['potato', 'onion', 'meat', 'curry'] as const)
    state = dayReducer(state, { type: 'ingredient', id, done: true });
  state = dayReducer(state, { type: 'end-call' });
  for (const id of ['garden', 'mame', 'uniform'] as const)
    state = dayReducer(state, { type: 'reminder', id, done: true });
  for (const choice of getStoryChoices(state, 'haruka'))
    state = dayReducer(state, {
      type: 'story-choice',
      id: 'haruka',
      choiceId: choice.id,
      source: 'ai',
    });
  expect(state.storyChoiceHistory.haruka).toHaveLength(4);
  expect(validDay(state)).toBe(true);
  expect(loadDay({ getItem: () => JSON.stringify(state) }).state).toEqual(state);
});

it('카무로쵸 연락은 명시적으로 한 번만 보내고 도착·싸움 완료를 만들지 않는다', () => {
  let state = initialDay();
  state = dayReducer(state, { type: 'notify-kamurocho' }, 1000);
  expect(state.call?.caller).toBe('majima');
  expect(state.call?.lines.join(' ')).toContain('아직 도착한 건 아니제');
  expect(state.storyMessages.majima.at(-1)?.text).toContain('갈 생각');
  expect(state.phoneEvents.majima).toContain('majima-kamurocho-intent');
  expect(dayReducer(state, { type: 'notify-kamurocho' }, 1100)).toBe(state);
  state = dayReducer(state, { type: 'end-call' }, 2000);
  state = loadDay({ getItem: () => JSON.stringify(state) }).state;
  expect(state.kamurochoNotified).toBe(true);
  expect(dayReducer(state, { type: 'notify-kamurocho' }, 3000)).toBe(state);
  expect(dayReducer(state, { type: 'reset' }).kamurochoNotified).toBe(false);
});

it('마지마의 먼저 온 문자는 인물 문맥에 남고 통화·대기 중에는 겹치지 않는다', () => {
  let state = { ...initialDay(), nextCallInMs: 120_000, nextMajimaTextInMs: 1000 };
  state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: false }, 1000);
  expect(state.storyMessages.majima).toHaveLength(0);
  state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: true }, 2000);
  expect(state.storyMessages.majima.map((m) => m.text)).toEqual(['키류쨩! 폰은 살아 있나?']);
  expect(state.phoneEvents.majima).toContain('majima-proactive-check-phone');
  expect(state.storyMessages.majima[0].createdAt).toBe(2000);
  expect(state.readThreads).not.toContain('majima');
  expect(validDay(state)).toBe(true);
  const restored = loadDay({ getItem: () => JSON.stringify(state) }).state;
  expect(restored.majimaCheckInsSent).toBe(1);
  state = dayReducer({ ...restored, nextMajimaTextInMs: 1000 }, { type: 'start-call', id: 'date' });
  state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: true }, 3000);
  expect(state.storyMessages.majima).toHaveLength(1);
  state = dayReducer(state, { type: 'end-call' }, 4000);
  expect(state.nextMajimaTextInMs).toBeGreaterThanOrEqual(60_000);
  expect(dayReducer(state, { type: 'reset' }).majimaCheckInsSent).toBe(0);
});

it('모든 선제 문자는 한 번씩만 나오고 새로고침·일시 정지는 몰아서 연락하지 않는다', () => {
  let state = initialDay();
  for (let i = 0; i < 12; i++)
    state = dayReducer(
      { ...state, nextCallInMs: 120_000, nextMajimaTextInMs: 1000 },
      { type: 'tick', elapsedMs: 1000, allowCalls: true },
      1000 * (i + 1),
    );
  const texts = state.storyMessages.majima.map((m) => m.text);
  expect(texts.length).toBe(8);
  expect(new Set(texts).size).toBe(8);
  expect(validDay(state)).toBe(true);
  state = dayReducer(
    { ...state, nextCallInMs: 0, nextMajimaTextInMs: 0 },
    { type: 'defer-contact' },
  );
  expect(state.nextCallInMs).toBe(30_000);
  expect(loadDay({ getItem: () => JSON.stringify(state) }).state.nextMajimaTextInMs).toBe(45_000);
});
