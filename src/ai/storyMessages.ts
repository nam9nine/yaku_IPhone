import { dayMessages, replyChoices, type ContactId, type DayMessage } from '../day/content';
import { isAiCharacter } from './client';
import type { AiThread } from './messenger';

/** Story progress stays independent; connected AI conversations never add a canned answer. */
export function storyThreadMessages(
  id: ContactId,
  replied: boolean,
  connected = false,
  remote?: AiThread,
  repliedWithAi = false,
): DayMessage[] {
  const initial = dayMessages[id];
  // Real exchanges only come from the authenticated server history, even after disconnect.
  if (repliedWithAi) return initial;
  if (!replied) return initial;
  const reply = { id: `${id}-reply`, text: replyChoices[id].text, outgoing: true, time: '16:40' };
  if (connected && isAiCharacter(id)) {
    const remoteReply =
      remote?.pending?.message === reply.text ||
      remote?.failedMessage?.message === reply.text ||
      remote?.messages.some((message) => message.role === 'user' && message.content === reply.text);
    return remoteReply ? initial : [...initial, reply];
  }
  return [
    ...initial,
    reply,
    { id: `${id}-response`, text: replyChoices[id].response, outgoing: false, time: '16:40' },
  ];
}
