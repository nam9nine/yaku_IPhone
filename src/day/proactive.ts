import type { PhoneEventId } from './phoneEvents';

/** Authored IF messages, not fabricated model responses or canon quotes. One delivery each per reset. */
export const majimaCheckIns: { id: PhoneEventId; text: string }[] = [
  {
    id: 'majima-proactive-check-phone',
    text: '키류쨩! 폰은 살아 있나?',
  },
  {
    id: 'majima-proactive-challenge',
    text: '오늘은 내가 먼저 찾았다! 볼일 끝나면 연락해라.',
  },
  {
    id: 'majima-proactive-karaoke',
    text: '노래 한 곡 뽑고 싶은데, 니도 한 곡 할래?',
  },
  {
    id: 'majima-proactive-rematch',
    text: '니랑 한 판 겨룰 생각만 하면 몸이 근질근질하네.',
  },
  {
    id: 'majima-proactive-call-me',
    text: '문자로 하려니 답답하구마. 시간 나면 전화 걸어라.',
  },
  {
    id: 'majima-proactive-plans',
    text: '오늘 뭐 할 생각이고? 아직 안 정했으면 내 얘기도 들어 봐라.',
  },
  {
    id: 'majima-proactive-quiet',
    text: '조용하다 싶으면 니 생각이 난다. 너무 얌전하게 살지는 마라!',
  },
  {
    id: 'majima-proactive-hello',
    text: '키류쨩! 별일 없제? 나중에 얘기 좀 하자.',
  },
];
