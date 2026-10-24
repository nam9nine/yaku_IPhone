const asset = (path: string) => `${import.meta.env.BASE_URL}story/${path}`;
export const contacts = [
  {
    id: 'nishiki',
    name: '니시키야마 아키라',
    shortName: '니시키',
    relation: '오랜 친구',
    about: '어릴 때부터 함께한 친구. 다음에는 느긋하게 밥이나 먹자.',
    portrait: `${import.meta.env.BASE_URL}story/nishiki.jpg`,
  },
  {
    id: 'date',
    name: '다테 마코토',
    shortName: '다테 형사',
    relation: '다테 형사',
    about: '오래 신세를 진 사람. 다음에 오면 같이 밥을 먹자.',
    portrait: `${import.meta.env.BASE_URL}story/date.jpg`,
  },
  {
    id: 'daigo',
    name: '도지마 다이고',
    shortName: '다이고',
    relation: '동성회 6대 회장',
    about: '동성회를 맡긴 사람. 혼자 짐을 짊어지지 않았으면 한다.',
    portrait: `${import.meta.env.BASE_URL}story/daigo.jpg`,
  },
  {
    id: 'majima',
    name: '마지마 고로',
    shortName: '마지마',
    relation: '마지마 형님',
    about: '시마노의 광견. 어디서든 나를 찾아내는 사람.',
    portrait: `${import.meta.env.BASE_URL}story/majima.jpg`,
  },
  {
    id: 'mine',
    name: '미네 요시타카',
    shortName: '미네',
    relation: '백봉회 회장',
    about: '다이고를 지탱하는 사람. 말보다 행동을 지켜보자.',
    portrait: `${import.meta.env.BASE_URL}story/mine.jpg`,
  },
  {
    id: 'saejima',
    name: '사에지마 타이가',
    shortName: '사에지마',
    relation: '사에지마조 조장',
    about: '의리를 잊지 않는 사나이. 마지마 형님의 형제.',
    portrait: `${import.meta.env.BASE_URL}story/saejima.png`,
  },
  {
    id: 'akiyama',
    name: '아키야마 슌',
    shortName: '아키야마',
    relation: '스카이 파이낸스',
    about: '여러모로 신세를 졌다. 아이들 간식까지 챙겨 주는 사람.',
    portrait: `${import.meta.env.BASE_URL}story/akiyama.jpg`,
  },
  {
    id: 'haruka',
    name: '사와무라 하루카',
    shortName: '하루카',
    relation: '나팔꽃 · 가족',
    about: '언제나 아이들을 챙겨 준다. 고맙다는 말을 더 해야겠다.',
    portrait: `${import.meta.env.BASE_URL}story/haruka.jpg`,
  },
] as const;
export interface StoryMessage {
  id: string;
  text: string;
  outgoing: boolean;
  time: string;
}
export const initialMessages: Record<string, StoryMessage[]> = {
  haruka: [
    {
      id: 'h1',
      text: '아저씨, 장 보러 가기 전에 메모 확인해 줘. 냉장고에 달걀이 거의 없어.',
      outgoing: false,
      time: '09:12',
    },
    { id: 'h2', text: '알았다. 이번에는 메모를 보고 사겠다.', outgoing: true, time: '09:14' },
  ],
  majima: [
    {
      id: 'm1',
      text: '키류 짱! 이제 문자도 되는기가? 답장 기다린다!',
      outgoing: false,
      time: '어제',
    },
  ],
  daigo: [
    {
      id: 'd1',
      text: '키류 씨, 오키나와는 어떻습니까? 아이들에게도 안부 전해 주십시오.',
      outgoing: false,
      time: '어제',
    },
  ],
  saejima: [
    {
      id: 's1',
      text: '잘 지내나. 아이들 밥 챙기느라 네 밥 거르지 마라.',
      outgoing: false,
      time: '월요일',
    },
  ],
  mine: [
    {
      id: 'y1',
      text: '키류 씨. 다음에 뵐 때 나팔꽃에 필요한 것이 있는지 알려 주십시오.',
      outgoing: false,
      time: '월요일',
    },
  ],
};
export interface StoryNote {
  id: string;
  title: string;
  body: string;
  checklist: { id: string; text: string; done: boolean }[];
  updatedAt: string;
}
export const initialNotes: StoryNote[] = [
  {
    id: 'shopping',
    title: '나팔꽃 장보기',
    body: '저녁은 카레. 아이들 몫까지 넉넉하게.\n매운 것은 사지 말 것. 냉장고부터 확인한다.\n우유는 하루카에게 물어보고 사자.',
    checklist: [
      { id: 'rice', text: '쌀 5kg — 남은 양 확인', done: true },
      { id: 'egg', text: '달걀 두 팩', done: false },
      { id: 'veg', text: '감자, 당근, 양파', done: false },
      { id: 'meat', text: '카레용 돼지고기', done: false },
      { id: 'curry', text: '순한 카레', done: false },
      { id: 'milk', text: '우유와 내일 아침 빵', done: false },
    ],
    updatedAt: '2026-10-24T09:20:00+09:00',
  },
  {
    id: 'cooking',
    title: '아이들 저녁 준비',
    body: '1. 밥부터 안친다.\n2. 채소는 아이들이 먹기 좋게 작게 썬다.\n3. 고기와 채소를 볶고 물을 넣는다.\n4. 푹 익으면 불을 끄고 카레를 푼다.\n5. 다시 약한 불. 바닥에 붙지 않게 젓는다.\n\n타이치에게는 맛보는 것만 부탁하자.\n리오나 몫은 너무 뜨겁지 않게.\n설거지는 내가 한다. 하루카도 좀 쉬어야 한다.',
    checklist: [],
    updatedAt: '2026-10-23T18:00:00+09:00',
  },
  {
    id: 'phone-help',
    title: '휴대폰 쓰는 법',
    body: '하루카에게 배운 것. 잊지 말 것.\n\n문자 보내기\n연락처에서 이름을 누른다. 메시지를 누른다. 글자를 쓰고 위쪽 화살표를 누른다. 세게 누를 필요는 없다.\n\n한 칸 뒤로\n화면 왼쪽 끝에서 오른쪽으로 민다.\n\n앱 바꾸기\n맨 아래 막대를 위로 올린다. 나오는 카드에서 고른다.\n\n홈으로\n아래 막대를 올린 뒤, 카드가 없는 빈 곳을 누른다.\n\n사진은 사진 앱에 있다. 화면을 손으로 닦는다고 사진이 지워지지는 않는다.\n\n마지마 형님의 문자는 급한 일인지 먼저 읽어 볼 것.',
    checklist: [],
    updatedAt: '2026-10-22T20:10:00+09:00',
  },
];
export const photos: { id: string; src: string; title: string; date: string }[] = [
  ...contacts.map((contact) => ({
    id: contact.id,
    src: contact.portrait,
    title: contact.name,
    date: '2026년 10월 24일',
  })),
  ...[
    { id: 'morning-glory', title: '나팔꽃에서' },
    { id: 'family-time', title: '함께 먹는 저녁' },
    { id: 'sewing', title: '재봉 시간' },
    { id: 'okinawa', title: '오키나와 류큐 거리' },
  ].map(({ id, title }) => ({ id, title, src: asset(`${id}.jpg`), date: '2026년 10월 23일' })),
];
