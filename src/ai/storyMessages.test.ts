import { expect, it } from 'vitest';
import { dayMessages, replyChoices } from '../day/content';
import type { AiThread } from './messenger';
import { storyThreadMessages } from './storyMessages';

const thread = (updates: Partial<AiThread> = {}): AiThread => ({
  messages: [],
  pending: null,
  failedMessage: null,
  loaded: true,
  loading: false,
  error: null,
  ...updates,
});

it('연결 전 장보기 답장과 다른 연락처의 스토리 응답은 유지한다', () => {
  expect(storyThreadMessages('haruka', true).at(-1)?.text).toBe(replyChoices.haruka.response);
  expect(storyThreadMessages('daigo', true, true).at(-1)?.text).toBe(replyChoices.daigo.response);
  expect(storyThreadMessages('haruka', false, true)).toEqual(dayMessages.haruka);
});

it('연결된 대화는 이전 스토리 진행 상태가 있어도 canned 응답을 추가하지 않는다', () => {
  const result = storyThreadMessages('haruka', true, true, thread());
  expect(result.at(-1)?.text).toBe(replyChoices.haruka.text);
  expect(result.some((message) => message.text === replyChoices.haruka.response)).toBe(false);
});

it('실제 모델에 보내는 스토리 답장은 pending·실패·복구 기록에서 중복하지 않는다', () => {
  const text = replyChoices.majima.text;
  const cases = [
    thread({
      pending: {
        requestId: 'request',
        message: text,
        time: '17:00',
        jobId: null,
        phase: 'submitting',
      },
    }),
    thread({ failedMessage: { message: text, time: '17:00', reason: 'reply' }, error: 'failed' }),
    thread({ messages: [{ id: 'user-1', role: 'user', content: text, time: '17:00' }] }),
  ];
  for (const remote of cases)
    expect(storyThreadMessages('majima', true, true, remote)).toEqual(dayMessages.majima);
});

it('모델 요청 오류에도 고정 답변으로 대체하지 않는다', () => {
  const remote = thread({
    error: 'Mac에 연결할 수 없습니다.',
    pending: {
      requestId: 'request',
      message: replyChoices.haruka.text,
      time: '17:00',
      jobId: null,
      phase: 'failed',
    },
  });
  const result = storyThreadMessages('haruka', true, true, remote);
  expect(result).toEqual(dayMessages.haruka);
  expect(result.some((message) => message.id === 'haruka-response')).toBe(false);
});

it('실제 AI 답장은 연결 해제 뒤에도 데모의 전송·고정 응답으로 바뀌지 않는다', () => {
  expect(storyThreadMessages('haruka', true, false, undefined, true)).toEqual(dayMessages.haruka);
});
