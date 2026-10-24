/** Original fan fiction for this website. Not official dialogue or a canonical timeline. */
export const demoDay = {
  date: '2026-10-24',
  timestamp: '2026-10-24T16:40:00+09:00',
  time: '16:40',
  dateLabel: '10월 24일 토요일',
  temperature: '27°',
} as const;

export const ingredients = [
  { id: 'potato', text: '감자' },
  { id: 'onion', text: '양파' },
  { id: 'meat', text: '고기' },
  { id: 'curry', text: '카레' },
] as const;
export type IngredientId = (typeof ingredients)[number]['id'];
export const reminders = [
  { id: 'shopping', title: '저녁 장보기', detail: '17:00 · 저녁 카레 재료' },
  { id: 'garden', title: '텃밭 물 주기', detail: '해가 기울면' },
  { id: 'mame', title: '마메 밥 주기', detail: '저녁 먹기 전에' },
] as const;
export type ReminderId = (typeof reminders)[number]['id'];
export const contactIds = [
  'haruka',
  'majima',
  'daigo',
  'saejima',
  'mine',
  'date',
  'akiyama',
  'nishiki',
] as const;
export type ContactId = (typeof contactIds)[number];
export interface DayMessage {
  id: string;
  text: string;
  outgoing: boolean;
  time: string;
  noteId?: string;
}
export const dayMessages: Record<ContactId, DayMessage[]> = {
  akiyama: [
    {
      id: 'akiyama1',
      text: '키류 씨, 다음에 갈 때 아이들 간식 좀 사 갈게요. 몇 명 몫이면 될까요?',
      outgoing: false,
      time: '14:30',
    },
  ],
  nishiki: [
    {
      id: 'nishiki1',
      text: '키류, 오늘도 카레냐? 네 몫도 넉넉히 해 둬. 애들 챙기다 다 식겠다.',
      outgoing: false,
      time: '14:10',
    },
  ],
  date: [
    {
      id: 'date1',
      text: '키류, 아이들은 잘 지내나? 너도 끼니 거르지 말고.',
      outgoing: false,
      time: '15:45',
    },
  ],
  haruka: [
    { id: 'h1', text: '아저씨, 오늘 저녁은 카레 어때요?', outgoing: false, time: '16:25' },
    { id: 'h2', text: '좋다. 장은 내가 봐 오겠다.', outgoing: true, time: '16:28' },
    {
      id: 'h3',
      text: '아저씨, 카레 재료 메모에 적어뒀어요.\n당근은 아직 있어요!',
      outgoing: false,
      time: '16:40',
      noteId: 'curry',
    },
  ],
  majima: [
    {
      id: 'm1',
      text: '키류 짱! 오늘 저녁 뭐 묵노? 애들한테 안부 전해라!',
      outgoing: false,
      time: '15:10',
    },
  ],
  daigo: [
    {
      id: 'd1',
      text: '키류 씨, 아이들은 잘 지내나요? 오키나와의 바다가 생각납니다.',
      outgoing: false,
      time: '어제',
    },
  ],
  saejima: [
    {
      id: 's1',
      text: '잘 지내나. 애들 챙기느라 네 밥 거르지 마라.',
      outgoing: false,
      time: '어제',
    },
  ],
  mine: [
    {
      id: 'n1',
      text: '아이들이 쓸 공책이 더 필요하면 말씀해 주십시오.',
      outgoing: false,
      time: '어제',
    },
  ],
};
export const replyChoices: Record<ContactId, { text: string; response: string }> = {
  akiyama: {
    text: '고맙다. 하루카에게 물어보고 알려 주겠다. 네 몫도 챙겨라.',
    response: '하하, 제 몫까지요? 알겠습니다. 연락 기다릴게요.',
  },
  nishiki: {
    text: '알았다. 너도 와라. 같이 먹으면 된다.',
    response: '좋지. 설거지는 같이 해 줄 테니까 남겨 둬.',
  },
  date: {
    text: '다들 잘 지냅니다. 다음에 오시면 같이 식사하시죠.',
    response: '좋지. 하루카한테도 안부 전해 줘.',
  },
  haruka: { text: '다 샀다.', response: '고마워요. 밥은 해둘게요.' },
  majima: {
    text: '오늘은 카레입니다. 아이들은 잘 지냅니다.',
    response: '카레 좋제! 다음에는 내 것도 남겨 놔라!',
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
export interface DayNote {
  id: string;
  title: string;
  body: string;
  checklist: { id: string; text: string; done: boolean }[];
  updatedAt: string;
  author?: string;
}
export const dayNotes: DayNote[] = [
  {
    id: 'curry',
    title: '오늘 저녁 카레',
    body: '이번에는 너무 맵지 않게.',
    checklist: [],
    updatedAt: demoDay.timestamp,
  },
  {
    id: 'gym',
    title: '체육복',
    body: '이름표 다시 달기.\n실이 쉽게 풀리지 않게 할 것.',
    checklist: [],
    updatedAt: '2026-10-24T10:12:00+09:00',
  },
  {
    id: 'phone-help',
    title: '아저씨, 이것만 기억하세요',
    body: '사진은 사진 앱에서 봐요.\n잘못 눌러도 고장 나지 않아요.\n모르면 저한테 물어보세요.',
    author: '하루카',
    checklist: [],
    updatedAt: '2026-10-23T19:30:00+09:00',
  },
  {
    id: 'weekend',
    title: '주말',
    body: '아이들과 바다에 가기.\n수건 챙기기.\n돌아와서 빨래.',
    checklist: [],
    updatedAt: '2026-10-22T20:10:00+09:00',
  },
];
export const shoppingEvent = {
  title: '저녁 장보기',
  time: '17:00',
  location: '동네 마트',
  notes: '저녁 카레 재료\n당근은 냉장고에 있다.',
  noteId: 'curry',
} as const;
