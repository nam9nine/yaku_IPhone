import {
  dayMessages,
  historyOnlyContacts,
  replyChoices,
  type ContactId,
  type DayMessage,
} from '../day/content';
import type { DayState } from '../day/state';
import { isAiCharacter } from './client';

// Exact prior local replies, kept independently from newly authored choices.
export const legacyChoices: Partial<Record<ContactId, { text: string; response: string }>> = {
  akiyama: {
    text: '고맙다. 하루카에게 물어보고 알려 주겠다. 네 몫도 챙겨라.',
    response: '하하, 제 몫까지요? 알겠습니다. 연락 기다릴게요.',
  },
  date: {
    text: '다들 잘 지냅니다. 다음에 오시면 같이 식사하시죠.',
    response: '좋지. 하루카한테도 안부 전해 줘.',
  },
  daigo: {
    text: '다들 잘 지낸다. 너도 밥 잘 챙겨 먹어라.',
    response: '네. 키류 씨도 편안한 주말 보내십시오.',
  },
  saejima: { text: '알았다. 같이 먹으니 걱정 마라.', response: '그래. 그거면 됐다.' },
  mine: {
    text: '고맙다. 필요한 것이 있으면 연락하겠다.',
    response: '알겠습니다. 좋은 저녁 보내십시오.',
  },
};

/** Remote AI replies never get fabricated local substitutes. Authored event messages remain local. */
export function storyThreadMessages(id: ContactId, state: DayState | boolean): DayMessage[] {
  const initial = dayMessages[id];
  if ((historyOnlyContacts as readonly string[]).includes(id)) return [...initial];
  const replied = typeof state === 'boolean' ? state : state.legacyReplies.includes(id);
  const legacy =
    isAiCharacter(id) || !replied
      ? []
      : [
          {
            id: `${id}-reply`,
            text: (legacyChoices[id] ?? replyChoices[id]).text,
            outgoing: true,
            time: '16:40',
          },
          {
            id: `${id}-response`,
            text: (legacyChoices[id] ?? replyChoices[id]).response,
            outgoing: false,
            time: '16:40',
          },
        ];
  return [...initial, ...legacy, ...(typeof state === 'boolean' ? [] : state.storyMessages[id])];
}
