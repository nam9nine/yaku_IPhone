import { expect, it } from 'vitest';
import { conversationRestDeadline } from './chatPacing';
it('authored choices ending still leaves periodic breaks after successful exchanges', () => {
  const messages = Array.from({ length: 12 }, (_, i) => [
    { role: 'user', status: 'complete', time: new Date(i * 1000).toISOString() },
    {
      role: 'assistant',
      status: 'complete',
      time: new Date(i * 1000 + 100).toISOString(),
      displayedAt: i * 1000 + 500,
    },
  ]).flat();
  expect(conversationRestDeadline(messages)).toBe(56500);
  expect(
    conversationRestDeadline([...messages, { role: 'user', status: 'error', time: null }]),
  ).toBe(56500);
  expect(
    conversationRestDeadline([...messages, { role: 'user', status: 'complete', time: null }]),
  ).toBe(0);
});
