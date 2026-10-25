import { expect, it } from 'vitest';
import { dayMessages, replyChoices } from '../day/content';
import { storyThreadMessages } from './storyMessages';

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
  expect(storyThreadMessages('daigo', true).at(-1)?.text).toBe(replyChoices.daigo.response);
  expect(storyThreadMessages('daigo', false)).toEqual(dayMessages.daigo);
});
