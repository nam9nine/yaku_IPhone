import { dayMessages, replyChoices, type ContactId, type DayMessage } from '../day/content';
import type { DayState } from '../day/state';
import { isAiCharacter } from './client';

/** Remote AI replies never get fabricated local substitutes. Authored event messages remain local. */
export function storyThreadMessages(id: ContactId, state: DayState | boolean): DayMessage[] {
  const initial = dayMessages[id];
  const replied =
    typeof state === 'boolean'
      ? state
      : state.replies.includes(id) && !state.storyChoiceHistory[id].length;
  const legacy =
    isAiCharacter(id) || !replied
      ? []
      : [
          { id: `${id}-reply`, text: replyChoices[id].text, outgoing: true, time: '16:40' },
          { id: `${id}-response`, text: replyChoices[id].response, outgoing: false, time: '16:40' },
        ];
  return [...initial, ...legacy, ...(typeof state === 'boolean' ? [] : state.storyMessages[id])];
}
