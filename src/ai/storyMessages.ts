import { dayMessages, replyChoices, type ContactId, type DayMessage } from '../day/content';
import { isAiCharacter } from './client';

/** AI contacts keep the initial story, but all subsequent replies come from the server. */
export function storyThreadMessages(id: ContactId, replied: boolean): DayMessage[] {
  const initial = dayMessages[id];
  if (isAiCharacter(id) || !replied) return initial;
  return [
    ...initial,
    { id: `${id}-reply`, text: replyChoices[id].text, outgoing: true, time: '16:40' },
    { id: `${id}-response`, text: replyChoices[id].response, outgoing: false, time: '16:40' },
  ];
}
