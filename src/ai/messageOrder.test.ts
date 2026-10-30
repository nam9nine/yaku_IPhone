import { describe, expect, it } from 'vitest';
import type { AiMessage } from './client';
import { displayedMessageTime, mergeMessageTimeline } from './messageOrder';
import { typingDelay, type ReplyReceipt } from './presentation';
import { dayReducer, initialDay, loadDay, validDay } from '../day/state';

const now = Date.parse('2026-10-29T04:00:00Z');
const receipt = (id: string, sentAt: number, deliveredAt: number): ReplyReceipt => ({
  requestId: id,
  character: 'majima',
  typingAt: sentAt + typingDelay(id),
  deliverAt: deliveredAt,
  delivered: true,
  read: true,
  replyId: `${id}-assistant`,
});
function exchange(id: string, sentAt: number, deliveredAt: number) {
  const r = receipt(id, sentAt, deliveredAt);
  const messages: AiMessage[] = [
    {
      id: `${id}-user`,
      role: 'user',
      content: '형님, 문자 봤습니다.',
      time: '2026-10-26T00:00:00Z',
      request_id: id,
    },
    {
      id: `${id}-assistant`,
      role: 'assistant',
      content: '그래. 나중에 연락해라.',
      time: '2026-10-26T00:00:01Z',
      request_id: id,
    },
  ];
  return messages.map((message) => ({ ...message, displayedAt: displayedMessageTime(message, r) }));
}
function afterCall() {
  const calling = dayReducer(initialDay(), { type: 'start-call', id: 'majima' }, now + 24000);
  return dayReducer(calling, { type: 'end-call' }, now + 25000);
}

describe('로컬 이야기와 AI 도착 순서', () => {
  it('AI 왕복 뒤 전화 후속 문자를 삽입하고 다음 AI 답장을 그 뒤에 둔다', () => {
    const state = afterCall();
    const story = [{ id: 'initial', time: '16:40' }, ...state.storyMessages.majima];
    const remote = [
      ...exchange('first', now, now + 22000),
      ...exchange('second', now + 30000, now + 55000),
    ];
    expect(mergeMessageTimeline(story, remote).map((message) => message.id)).toEqual([
      'initial',
      'first-user',
      'first-assistant',
      'story-1',
      'second-user',
      'second-assistant',
    ]);
    // Sorting is a view operation: original local records and server history remain untouched.
    expect(story[1].id).toBe('story-1');
    expect(remote[0].time).toBe('2026-10-26T00:00:00Z');
  });
  it('재접속해도 로컬 createdAt과 receipt 기준 도착 순서가 바뀌지 않는다', () => {
    const state = afterCall();
    const loaded = loadDay({ getItem: () => JSON.stringify(state) }, now + 60000).state;
    expect(loaded.storyMessages.majima[0].createdAt).toBe(now + 25000);
    const remote = exchange('first', now, now + 22000);
    const before = mergeMessageTimeline(state.storyMessages.majima, remote).map(
      (message) => message.id,
    );
    const after = mergeMessageTimeline(
      loaded.storyMessages.majima,
      JSON.parse(JSON.stringify(remote)),
    ).map((message) => message.id);
    expect(after).toEqual(before);
  });
  it('입력 중 표시 기한이 아닌 사용자의 전송 시각과 실제 assistant 표시 기한을 사용한다', () => {
    const messages = exchange('clock-skew', now, now + 45000);
    expect(messages[0].displayedAt).toBe(now);
    expect(messages[1].displayedAt).toBe(now + 45000);
  });
  it('receipt 없는 옛 원격 이력은 서버 ISO 시각으로 정렬하고 모르는 시각은 만들지 않는다', () => {
    const old: AiMessage = {
      id: 'old',
      role: 'assistant',
      content: '이전 대화',
      time: '2026-10-26T00:00:01Z',
    };
    expect(displayedMessageTime(old)).toBe(Date.parse(old.time!));
    expect(displayedMessageTime({ ...old, time: '어제' })).toBeUndefined();
    expect(displayedMessageTime({ ...old, time: null })).toBeUndefined();
    const merged = mergeMessageTimeline(
      [
        { id: 'initial', time: '16:40' },
        { id: 'local', createdAt: now },
      ],
      [
        { id: 'old', time: old.time },
        { id: 'unknown', time: null },
      ],
    );
    expect(merged.map((message) => message.id)).toEqual(['initial', 'old', 'unknown', 'local']);
  });
  it('시각 없는 기존 원격 이력 뒤에 새 답장을 두어 하단이 최신 수신을 가리킨다', () => {
    const story = [
      { id: 'initial', time: '16:40' },
      { id: 'local', createdAt: now + 25000 },
    ];
    const remote = [
      ...Array.from({ length: 32 }, (_, index) => ({ id: `legacy-${index}`, time: null })),
      ...exchange('new', now + 30000, now + 55000),
    ];
    const before = JSON.stringify(remote);
    const merged = mergeMessageTimeline(story, remote);
    expect(merged.map((message) => message.id)).toEqual([
      'initial',
      ...remote.slice(0, 32).map((message) => message.id),
      'local',
      'new-user',
      'new-assistant',
    ]);
    expect(JSON.stringify(remote)).toBe(before);
    expect(remote[0].time).toBeNull();
  });
  it('서버 시각이 역전되거나 일부 없는 경우에도 원격 순서와 로컬 순서를 보존한다', () => {
    const local = [
      { id: 'local-a', createdAt: now + 20000 },
      { id: 'local-b', createdAt: now + 15000 },
    ];
    const remote = [
      { id: 'remote-a', displayedAt: now + 10000 },
      { id: 'remote-b', time: null },
      { id: 'remote-c', displayedAt: now + 5000 },
      { id: 'remote-d', displayedAt: now + 30000 },
    ];
    const merged = mergeMessageTimeline(local, remote).map((message) => message.id);
    expect(merged.filter((id) => id.startsWith('remote'))).toEqual(remote.map((row) => row.id));
    expect(merged.filter((id) => id.startsWith('local'))).toEqual(local.map((row) => row.id));
    expect(merged.at(-1)).toBe('remote-d');
  });
  it('동일 시각은 원래 입력 순서를 안정적으로 보존한다', () => {
    const local = [
      { id: 'local-a', createdAt: now },
      { id: 'local-b', createdAt: now },
    ];
    const remote = [
      { id: 'user', displayedAt: now },
      { id: 'assistant', displayedAt: now },
    ];
    expect(mergeMessageTimeline(local, remote).map((message) => message.id)).toEqual([
      'local-a',
      'local-b',
      'user',
      'assistant',
    ]);
  });
  it('옛 로컬 행에 날짜를 추측해 넣지 않고 기존 진행과 배열 순서를 유지한다', () => {
    const old = afterCall();
    delete old.storyMessages.majima[0].createdAt;
    const loaded = loadDay({ getItem: () => JSON.stringify(old) }, now + 100000).state;
    expect(loaded.storyMessages.majima).toEqual(old.storyMessages.majima);
    expect(loaded.storyMessages.majima[0].createdAt).toBeUndefined();
    expect(loaded.affinity).toBe(old.affinity);
    expect(validDay(loaded)).toBe(true);
  });
  it('잘못된 createdAt을 허용하지 않고 모든 새 로컬 발생 경로에 주입 시각을 저장한다', () => {
    let state = dayReducer(
      initialDay(),
      { type: 'story-choice', id: 'daigo', choiceId: 'daigo-1a' },
      now,
    );
    expect(state.storyMessages.daigo[0].createdAt).toBe(now);
    for (let i = 0; i < 30; i++)
      state = dayReducer(
        state,
        { type: 'tick', elapsedMs: 1000, allowCalls: false },
        now + (i + 1) * 1000,
      );
    expect(state.storyMessages.daigo[1].createdAt).toBeGreaterThan(now);
    state = dayReducer(state, { type: 'reminder', id: 'garden', done: true }, now + 31000);
    expect(state.storyMessages.haruka[0].createdAt).toBe(now + 31000);
    const invalid = JSON.parse(JSON.stringify(state));
    invalid.storyMessages.haruka[0].createdAt = -1;
    expect(validDay(invalid)).toBe(false);
  });
});
