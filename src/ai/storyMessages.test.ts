import { expect, it } from 'vitest';
import { dayMessages, replyChoices } from '../day/content';
import { legacyChoices, storyThreadMessages } from './storyMessages';

it('하루카·마지마는 연결 상태와 이전 스토리 진행에 관계없이 고정 후속 답장을 추가하지 않는다', () => {
  for (const character of ['haruka', 'majima'] as const) {
    expect(storyThreadMessages(character, true)).toEqual(dayMessages[character]);
    expect(storyThreadMessages(character, false)).toEqual(dayMessages[character]);
    expect(
      storyThreadMessages(character, true).some((m) => m.text === replyChoices[character].response),
    ).toBe(false);
  }
});
it('다른 연락처는 기존 스토리 답장을 유지한다', () => {
  expect(storyThreadMessages('daigo', true).at(-1)?.text).toBe(legacyChoices.daigo!.response);
  expect(storyThreadMessages('daigo', false)).toEqual(dayMessages.daigo);
});

it('AI 답변은 서버에서만 오고 별도 퀘스트/전화 문자는 로컬 원문으로 유지한다', async () => {
  const { initialDay, dayReducer, getStoryChoices } = await import('../day/state');
  let state = dayReducer(initialDay(), { type: 'reminder', id: 'garden', done: true });
  const before = storyThreadMessages('haruka', state);
  expect(before).toHaveLength(dayMessages.haruka.length + 1);
  state = dayReducer(state, {
    type: 'story-choice',
    id: 'haruka',
    choiceId: getStoryChoices(state, 'haruka')[0].id,
    source: 'ai',
  });
  expect(storyThreadMessages('haruka', state)).toEqual(before);
});

it('이전 버전에서 보낸 문자 원문은 다음 선택과 재접속 뒤에도 남는다', async () => {
  const { initialDay, loadDay, dayReducer, getStoryChoices, DAY_STORAGE_KEY } =
    await import('../day/state');
  const old: Record<string, unknown> = {
    ...initialDay(),
    replies: ['daigo'],
    readThreads: ['daigo'],
  };
  delete old.legacyReplies;
  delete old.storyChoiceHistory;
  let state = loadDay({ getItem: () => JSON.stringify(old) }).state;
  expect(state.legacyReplies).toEqual(['daigo']);
  state = dayReducer(state, {
    type: 'story-choice',
    id: 'daigo',
    choiceId: getStoryChoices(state, 'daigo')[0].id,
  });
  for (let n = 0; n < 12; n++)
    state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: false });
  const persisted = JSON.stringify(state);
  state = loadDay({ getItem: (key) => (key === DAY_STORAGE_KEY ? persisted : null) }).state;
  const texts = storyThreadMessages('daigo', state).map((item) => item.text);
  expect(texts).toContain(legacyChoices.daigo!.text);
  expect(texts).toContain(legacyChoices.daigo!.response);
  expect(state.storyChoiceHistory.daigo).toHaveLength(1);
});

it('읽기 전용 연락처는 새로 정리한 내역만 표시하고 과거 저장 원본은 바꾸지 않는다', async () => {
  const { initialDay } = await import('../day/state');
  const state = initialDay();
  state.storyMessages.mine = [{ id: 'old', text: '이전 대본', outgoing: false, time: '16:40' }];
  expect(storyThreadMessages('mine', state)).toEqual(dayMessages.mine);
  expect(state.storyMessages.mine[0].text).toBe('이전 대본');
});
