import type { PhoneEventId } from './phoneEvents';

/** Authored IF messages, not fabricated model responses or canon quotes. One delivery each per reset. */
export const majimaCheckIns: { id: PhoneEventId; text: string }[] = [
  {
    id: 'majima-proactive-check-phone',
    text: '키류쨩! 폰은 살아 있나?',
  },
  {
    id: 'majima-proactive-challenge',
    text: '오늘은 무슨 핑계로 니 불러낼까 고민 중이다. 볼일 끝나면 연락해라!',
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
    id: 'majima-proactive-bowling',
    text: '싸우는 건 싫다 카면 볼링은 어떻노? 니랑 승부할 건 얼마든지 있다!',
  },
  {
    id: 'majima-proactive-darts',
    text: '키류쨩, 다트 한 판 하자. 이번엔 내가 니보다 먼저 맞힌다!',
  },
  {
    id: 'majima-proactive-pocket',
    text: '포켓 서킷 얘기만 나오면 눈빛 달라지더라. 내하고도 한 번 달려 볼래?',
  },
  {
    id: 'majima-proactive-hello',
    text: '키류쨩! 별일 없제? 나중에 얘기 좀 하자.',
  },
];
