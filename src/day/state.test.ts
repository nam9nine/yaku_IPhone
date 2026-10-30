import { describe, expect, it } from 'vitest';
import { ingredients, reminders, historyOnlyContacts, type ContactId } from './content';
import {
  DAY_STORAGE_KEY,
  dayReducer,
  getStoryChoices,
  affinityTone,
  peerHangupDelay,
  initialDay,
  loadDay,
  remainingReminders,
  shoppingComplete,
  validDay,
} from './state';

function completeShopping() {
  return ingredients.reduce(
    (state, item) => dayReducer(state, { type: 'ingredient', id: item.id, done: true }),
    initialDay(),
  );
}

describe('나팔꽃의 공유된 하루', () => {
  it('starts with four needed ingredients and five unfinished reminders', () => {
    const state = initialDay();
    expect(shoppingComplete(state)).toBe(false);
    expect(remainingReminders(state)).toBe(5);
    expect(state.missedCall).toBe(false);
  });
  it('only the fourth ingredient completes shopping, changes the count and triggers one missed call', () => {
    let state = initialDay();
    for (const item of ingredients.slice(0, 3))
      state = dayReducer(state, { type: 'ingredient', id: item.id, done: true });
    expect(remainingReminders(state)).toBe(5);
    expect(state.missedCall).toBe(false);
    state = dayReducer(state, { type: 'ingredient', id: 'curry', done: true });
    expect(shoppingComplete(state)).toBe(true);
    expect(remainingReminders(state)).toBe(4);
    expect(state.missedCall).toBe(true);
    expect(dayReducer(state, { type: 'ingredient', id: 'curry', done: true })).toBe(state);
  });
  it('never sends the early Haruka reply or an unknown conversation', () => {
    const state = initialDay();
    expect(dayReducer(state, { type: 'reply', id: 'haruka' })).toBe(state);
    expect(dayReducer(state, { type: 'reply', id: 'stranger' })).toBe(state);
  });
  it('stores the outgoing reply and authored response as one event that cannot replay', () => {
    const state = dayReducer(completeShopping(), { type: 'reply', id: 'haruka' });
    expect(state.replySent).toBe(true);
    expect(state.replies).toEqual(['haruka']);
    expect(state.readThreads).toContain('haruka');
    expect(dayReducer(state, { type: 'reply', id: 'haruka' })).toBe(state);
    expect(validDay(state)).toBe(true);
  });
  it('keeps history when ingredients are unchecked without repeating the phone event', () => {
    let state = dayReducer(completeShopping(), { type: 'reply', id: 'haruka' });
    state = dayReducer(state, { type: 'read-call' });
    state = dayReducer(state, { type: 'ingredient', id: 'potato', done: false });
    expect(remainingReminders(state)).toBe(5);
    expect(state.replySent).toBe(true);
    expect(state.missedCallRead).toBe(true);
    expect(validDay(state)).toBe(true);
    state = dayReducer(state, { type: 'ingredient', id: 'potato', done: true });
    expect(state.missedCallRead).toBe(true);
    expect(state.replies).toHaveLength(1);
  });
  it('changing the shopping reminder changes all four checklist items in the same transaction', () => {
    const done = dayReducer(initialDay(), { type: 'reminder', id: 'shopping', done: true });
    expect(shoppingComplete(done)).toBe(true);
    expect(done.missedCall).toBe(true);
    const undone = dayReducer(done, { type: 'reminder', id: 'shopping', done: false });
    expect(Object.values(undone.ingredients)).toEqual([false, false, false, false]);
    expect(remainingReminders(undone)).toBe(5);
    expect(undone.missedCall).toBe(true);
  });
  it('garden and Mame reminders share the same total without completing shopping', () => {
    const state = dayReducer(
      dayReducer(initialDay(), { type: 'reminder', id: 'garden', done: true }),
      { type: 'reminder', id: 'mame', done: true },
    );
    expect(remainingReminders(state)).toBe(3);
    expect(shoppingComplete(state)).toBe(false);
    expect(state.missedCall).toBe(false);
    expect(
      remainingReminders(dayReducer(state, { type: 'reminder', id: 'shopping', done: true })),
    ).toBe(2);
  });
  it('reading a thread is idempotent and cannot record an unknown contact', () => {
    const state = dayReducer(initialDay(), { type: 'read-thread', id: 'haruka' });
    expect(state.readThreads).toEqual(['haruka']);
    expect(dayReducer(state, { type: 'read-thread', id: 'haruka' })).toBe(state);
    expect(dayReducer(state, { type: 'read-thread', id: 'stranger' })).toBe(state);
  });
  it('preserves the AI source through reload without turning it into a demo reply', () => {
    const state = dayReducer(completeShopping(), { type: 'reply', id: 'haruka', source: 'ai' });
    expect(state.replySent).toBe(true);
    expect(state.aiReplies).toEqual(['haruka']);
    expect(loadDay({ getItem: () => JSON.stringify(state) }).state.aiReplies).toEqual(['haruka']);
    expect(dayReducer(state, { type: 'reset' }).aiReplies).toEqual([]);
  });
  it('offers other contact replies once without advancing the curry event', () => {
    const state = dayReducer(initialDay(), { type: 'reply', id: 'majima' });
    expect(state.replies).toEqual(['majima']);
    expect(state.replySent).toBe(false);
    expect(state.missedCall).toBe(false);
    expect(validDay(state)).toBe(true);
    expect(dayReducer(state, { type: 'reply', id: 'majima' })).toBe(state);
  });
  it('cannot mark a phone event read before it exists', () => {
    const state = initialDay();
    expect(dayReducer(state, { type: 'read-call' })).toBe(state);
  });
  it('reset creates fresh nested state and clears all story progression', () => {
    const old = dayReducer(completeShopping(), { type: 'reply', id: 'haruka' });
    const next = dayReducer(old, { type: 'reset' });
    expect(next).toEqual(initialDay());
    expect(next.ingredients).not.toBe(old.ingredients);
  });
});

describe('저장된 하루 검증', () => {
  it.each([
    null,
    [],
    {},
    { ...initialDay(), ingredients: { potato: 'yes', onion: false, meat: false, curry: false } },
    { ...initialDay(), reminders: { shopping: true, garden: false, mame: false } },
    { ...initialDay(), readThreads: ['haruka', 'haruka'] },
    { ...initialDay(), readThreads: ['stranger'] },
    { ...initialDay(), replySent: true },
    { ...initialDay(), replies: ['haruka'], replySent: true, readThreads: ['haruka'] },
    { ...initialDay(), replies: ['majima'] },
    { ...initialDay(), missedCallRead: true },
    { ...completeShopping(), missedCall: false },
  ])('rejects corrupt or contradictory saved values (%#)', (value) => {
    expect(validDay(value)).toBe(false);
  });
  it('roundtrips a fully completed and read story', () => {
    const state = dayReducer(dayReducer(completeShopping(), { type: 'reply', id: 'haruka' }), {
      type: 'read-call',
    });
    const loaded = loadDay({
      getItem: (key) => (key === DAY_STORAGE_KEY ? JSON.stringify(state) : null),
    });
    expect(loaded.state.ingredients).toEqual(state.ingredients);
    expect(loaded.state.replies).toEqual(state.replies);
    expect(loaded.state.call).toBeNull();
    expect(loaded.state.callStatus).toBe('missed');
    expect(loaded.state.callLog[0].caller).toBe('majima');
    expect(validDay(loaded.state)).toBe(true);
    expect(loaded.unavailable).toBe(false);
  });
  it('falls back safely when storage is denied', () => {
    expect(
      loadDay({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toEqual({ state: initialDay(), unavailable: true });
  });
  it('does not apply invalid stored state or malformed JSON', () => {
    expect(loadDay({ getItem: () => '{' }).state).toEqual(initialDay());
    expect(
      loadDay({ getItem: () => JSON.stringify({ ...initialDay(), replySent: true }) }).state,
    ).toEqual(initialDay());
  });
});

it('전화는 응답/거절 결과를 구분하고 완료 이벤트를 다시 재생하지 않는다', () => {
  const ringing = completeShopping();
  expect(ringing.callStatus).toBe('ringing');
  const answered = dayReducer(ringing, { type: 'answer-call' });
  expect(answered.callStatus).toBe('answered');
  expect(answered.missedCallRead).toBe(true);
  expect(dayReducer(answered, { type: 'miss-call' })).toBe(answered);
  const missed = dayReducer(ringing, { type: 'miss-call' });
  expect(missed.callStatus).toBe('missed');
  expect(missed.missedCallRead).toBe(false);
  expect(dayReducer(missed, { type: 'answer-call' })).toBe(missed);
  expect(loadDay({ getItem: () => JSON.stringify(ringing) }).state.callStatus).toBe('missed');
});

function advance(state: ReturnType<typeof initialDay>, seconds: number, allowCalls = false) {
  for (let i = 0; i < seconds; i++)
    state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls });
  return state;
}
function choose(state: ReturnType<typeof initialDay>, id: ContactId, index = 0, source?: 'ai') {
  return dayReducer(state, {
    type: 'story-choice',
    id,
    choiceId: getStoryChoices(state, id)[index].id,
    source,
  });
}
describe('인물별 선택형 문자와 퀘스트', () => {
  it('서로 다른 연락처는 동시에 선택할 수 있고 각 답장은 한 번만 도착한다', () => {
    let state = choose(initialDay(), 'daigo');
    const duplicate = dayReducer(state, {
      type: 'story-choice',
      id: 'daigo',
      choiceId: 'daigo-1a',
    });
    expect(duplicate).toBe(state);
    expect(getStoryChoices(state, 'daigo')).toEqual([]);
    state = choose(state, 'majima');
    expect(Object.keys(state.storyPending)).toEqual(['daigo', 'majima']);
    expect(state.storyMessages.daigo).toHaveLength(1);
    state = advance(state, 14);
    expect(state.storyMessages.daigo).toHaveLength(1);
    state = advance(state, 16);
    expect(state.storyMessages.daigo).toHaveLength(2);
    expect(state.storyMessages.majima).toHaveLength(2);
    expect(state.storyMessages.daigo[1].outgoing).toBe(false);
    expect(getStoryChoices(state, 'daigo')[0].id).toBe('daigo-2a');
    expect(advance(state, 30).storyMessages.daigo).toHaveLength(2);
    expect(validDay(state)).toBe(true);
  });
  it.each(['daigo'] as const)('%s는 실제 세 왕복 후 선택이 끝난다', (id) => {
    let state = initialDay();
    for (let round = 0; round < 3; round++) state = advance(choose(state, id, round % 2), 30);
    expect(state.storyMessages[id]).toHaveLength(6);
    expect(getStoryChoices(state, id)).toEqual([]);
    expect(validDay(state)).toBe(true);
  });
  it('하루카는 실제 완료된 퀘스트만 보고하고 AI 완료 선택은 로컬 답장을 중복하지 않는다', () => {
    let state = initialDay();
    expect(getStoryChoices(state, 'haruka')).toEqual([]);
    state = dayReducer(state, { type: 'reminder', id: 'garden', done: true });
    expect(getStoryChoices(state, 'haruka').map((c) => c.id)).toEqual(['haruka-garden']);
    const count = state.storyMessages.haruka.length;
    state = choose(state, 'haruka', 0, 'ai');
    expect(state.storyMessages.haruka).toHaveLength(count);
    expect(state.storyPending.haruka).toBeUndefined();
    expect(getStoryChoices(state, 'haruka')).toEqual([]);
    expect(
      dayReducer(state, {
        type: 'story-choice',
        id: 'haruka',
        choiceId: 'haruka-garden',
        source: 'ai',
      }),
    ).toBe(state);
    expect(validDay(state)).toBe(true);
  });
  it('모든 퀘스트는 완료 후 문자를 한 번만 만들고 체크 해제/재체크로 반복하지 않는다', () => {
    let state = initialDay();
    for (const { id } of reminders) state = dayReducer(state, { type: 'reminder', id, done: true });
    expect(state.completedQuests).toHaveLength(5);
    const count = state.storySequence;
    for (const { id } of reminders) {
      state = dayReducer(state, { type: 'reminder', id, done: false });
      state = dayReducer(state, { type: 'reminder', id, done: true });
    }
    expect(state.storySequence).toBe(count);
    expect(state.callSerial).toBe(1);
  });
  it('명시적 마지마 선택만 인연에 반영하고 냉담 상태에서 통화 반응도 바뀐다', () => {
    let state = choose(initialDay(), 'majima', 1, 'ai');
    expect(state.affinity).toBe(-1);
    state = choose(state, 'majima', 1, 'ai');
    expect(state.affinity).toBe(-3);
    expect(affinityTone(state)).toBe('cool');
    expect(state.storyMessages.majima).toEqual([]);
    state = dayReducer(state, { type: 'start-call', id: 'majima' });
    expect(state.call?.lines[0]).toContain('용건');
    expect(validDay(state)).toBe(true);
  });
});

describe('사용 시간 기반 전화', () => {
  it('잠금 중 새 전화 일정을 진행하지 않고 복귀해도 밀린 전화가 한꺼번에 오지 않는다', () => {
    let state = advance(initialDay(), 120, false);
    expect(state.call).toBeNull();
    expect(state.nextCallInMs).toBe(60000);
    state = advance(state, 59, true);
    expect(state.call).toBeNull();
    state = advance(state, 1, true);
    expect(state.call?.caller).toBe('majima');
    expect(state.scheduledCalls).toBe(1);
    state = dayReducer(state, { type: 'miss-call' });
    const next = state.nextCallInMs;
    state = advance(state, 10, false);
    expect(state.nextCallInMs).toBe(next);
    // A proactive text can postpone ringing to avoid overlapping arrivals.
    for (let second = 0; second < 180 && !state.call; second++) state = advance(state, 1, true);
    expect(state.call?.caller).toBe('majima');
  });
  it('발신 취소와 응답 뒤 종료를 구분하고 종료 입력이 반복되어도 후속 문자는 한 번이다', () => {
    let state = dayReducer(initialDay(), { type: 'start-call', id: 'majima' });
    state = dayReducer(state, { type: 'end-call' });
    expect(state.callLog[0].result).toBe('declined');
    expect(state.storyMessages.majima).toHaveLength(1);
    expect(dayReducer(state, { type: 'end-call' })).toBe(state);
    state = dayReducer(state, { type: 'start-call', id: 'date' });
    state = advance(state, 3);
    expect(state.call?.phase).toBe('connected');
    state = dayReducer(state, { type: 'end-call' });
    expect(state.callLog[0].caller).toBe('date');
    expect(state.callLog[0].result).toBe('completed');
    expect(validDay(state)).toBe(true);
  });
  it('응답 전 시간초과는 부재중으로 남고 다 마친 통화에는 끊었다는 문자가 안 온다', () => {
    const missed = advance(completeShopping(), 20);
    expect(missed.call).toBeNull();
    expect(missed.callLog[0].result).toBe('missed');
    let connected = dayReducer(completeShopping(), { type: 'answer-call' });
    connected = advance(connected, 15);
    const count = connected.storyMessages.majima.length;
    connected = dayReducer(connected, { type: 'end-call' });
    expect(connected.storyMessages.majima).toHaveLength(count);
  });
});

it('옛 니시키 저장만 제거하고 다른 인물, 퀘스트, 전화 진행은 마이그레이션으로 보존한다', () => {
  const old = {
    ingredients: { potato: true, onion: true, meat: true, curry: true },
    reminders: { garden: true, mame: false },
    readThreads: ['nishiki', 'daigo'],
    replies: ['nishiki', 'daigo'],
    aiReplies: [],
    replySent: false,
    missedCall: true,
    missedCallRead: true,
    callStatus: 'missed',
  };
  let state = loadDay({ getItem: () => JSON.stringify(old) }).state;
  expect(state.replies).toEqual(['daigo']);
  expect(state.reminders.garden).toBe(true);
  expect(state.reminders.uniform).toBe(false);
  expect(state.completedQuests).toEqual(['shopping', 'garden']);
  expect(getStoryChoices(state, 'daigo')[0].id).toBe('daigo-2a');
  state = advance(choose(state, 'daigo'), 30);
  expect(getStoryChoices(state, 'daigo')[0].id).toBe('daigo-3a');
  state = dayReducer(state, { type: 'ingredient', id: 'potato', done: false });
  state = dayReducer(state, { type: 'ingredient', id: 'potato', done: true });
  expect(state.call).toBeNull();
  expect(state.callSerial).toBe(0);
  expect(validDay(state)).toBe(true);
});

describe('통화 상대의 종료와 자연스러운 간격', () => {
  it('상대가 마친 통화는 호감도나 비난 문자를 만들지 않고 오래된 종료도 무시한다', () => {
    let state = dayReducer({ ...initialDay(), affinity: 3 }, { type: 'start-call', id: 'majima' });
    state = advance(state, 3);
    const id = state.call!.id;
    expect(dayReducer(state, { type: 'peer-end-call', callId: id })).toBe(state);
    state = advance(state, Math.ceil(peerHangupDelay(state.call!) / 1000));
    const affinity = state.affinity;
    const count = state.storyMessages.majima.length;
    state = dayReducer(state, { type: 'peer-end-call', callId: id });
    expect(state.call).toBeNull();
    expect(state.affinity).toBe(affinity);
    expect(state.storyMessages.majima).toHaveLength(count);
    expect(state.callLog[0]).toMatchObject({ result: 'completed', endedBy: 'peer' });
    expect(state.phoneEvents.majima).toContain('majima-call-peer-ended');
    state = dayReducer(state, { type: 'start-call', id: 'majima' });
    expect(dayReducer(state, { type: 'peer-end-call', callId: id })).toBe(state);
    expect(validDay(state)).toBe(true);
  });
  it('사용자가 연속으로 끊어도 같은 후속 문자를 바로 반복하지 않고 cooldown을 지킨다', () => {
    let state = initialDay();
    const messages: string[] = [];
    for (let index = 0; index < 7; index++) {
      state = dayReducer(state, { type: 'start-call', id: 'majima' });
      state = dayReducer(state, { type: 'end-call' });
      messages.push(state.storyMessages.majima.at(-1)!.text);
      expect(state.nextCallInMs).toBeGreaterThanOrEqual(60_000);
      expect(state.nextCallInMs).toBeLessThanOrEqual(120_000);
    }
    expect(messages.every((message, index) => index === 0 || message !== messages[index - 1])).toBe(
      true,
    );
    expect(state.callLog).toHaveLength(7);
  });
  it('친밀한 수신 통화에도 발신 방향을 지어내지 않는다', () => {
    const state = advance({ ...initialDay(), affinity: 3 }, 60, true);
    expect(state.call?.direction).toBe('incoming');
    expect(state.call?.lines.join(' ')).not.toContain('니가 먼저 걸어');
  });
  it('현재 통화 중에는 아무리 기다려도 다음 전화나 문자가 끼어들지 않는다', () => {
    let state = dayReducer(
      { ...initialDay(), nextCallInMs: 0, nextMajimaTextInMs: 0 },
      { type: 'start-call', id: 'majima' },
    );
    state = advance(state, 180, true);
    expect(state.call?.id).toBe('call-1');
    expect(state.callLog).toEqual([]);
    expect(state.storyMessages.majima).toEqual([]);
    expect(state.scheduledCalls).toBe(0);
  });
  it('가상 목적지를 골라도 사용자 문장과 만남 의사를 대신 보내지 않는다', () => {
    const before = { ...initialDay(), affinity: -3 };
    const next = dayReducer(before, { type: 'notify-kamurocho' });
    expect(next.kamurochoNotified).toBe(true);
    expect(next.storyMessages).toEqual(before.storyMessages);
    expect(next.phoneEvents).toEqual(before.phoneEvents);
    expect(next.call).toBeNull();
  });
});

it.each(historyOnlyContacts)(
  '%s는 기존 내역만 읽으며 새로운 선택형 답장을 생성하지 않는다',
  (id) => {
    const state = initialDay();
    expect(getStoryChoices(state, id)).toEqual([]);
    expect(dayReducer(state, { type: 'story-choice', id, choiceId: id + '-1a' })).toBe(state);
  },
);

it('유키 기록은 이치반의 발언으로 바꾸지 않고 다른 인물과 진행 상태는 유지한다', () => {
  const saved = JSON.parse(JSON.stringify(initialDay()));
  saved.affinity = 3;
  saved.storySequence = 4;
  saved.reminders.garden = true;
  saved.storyMessages.majima = [
    { id: 'keep', text: '보존할 문자', sequence: 3, outgoing: false, time: '12:00' },
  ];
  saved.storyMessages.yuki = [
    { id: 'drop', text: '유키 옛 문자', sequence: 4, outgoing: false, time: '12:01' },
  ];
  delete saved.storyMessages.ichiban;
  saved.storyChoiceHistory.yuki = ['yuki-1a'];
  delete saved.storyChoiceHistory.ichiban;
  saved.storyPending.yuki = { choiceId: 'yuki-1a', deliverAt: 12345 };
  saved.readThreads = ['yuki', 'majima'];
  saved.replies = ['yuki'];
  saved.legacyReplies = ['yuki'];
  saved.callLog = [
    {
      id: 'call-1',
      caller: 'yuki',
      direction: 'outgoing',
      result: 'completed',
      time: '12:00',
      read: true,
    },
  ];
  const loaded = loadDay({ getItem: () => JSON.stringify(saved) }).state;
  expect(loaded.affinity).toBe(3);
  expect(loaded.reminders.garden).toBe(true);
  expect(loaded.storyMessages.majima[0].text).toBe('보존할 문자');
  expect(loaded.storyMessages.ichiban).toEqual([]);
  expect(loaded.storyPending).toEqual({});
  expect(loaded.callLog).toEqual([]);
  expect(loaded.replies).toEqual([]);
  expect(validDay(loaded)).toBe(true);
});
