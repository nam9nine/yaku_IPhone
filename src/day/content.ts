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
  { id: 'uniform', title: '체육복 이름표 달기', detail: '풀린 실 다시 꿰매기' },
  { id: 'parcel', title: '택배 수령하기', detail: '다테 씨가 보낸 봉투 확인' },
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
  'ichiban',
] as const;
export type ContactId = (typeof contactIds)[number];
/** These contacts show an authored past conversation, with no new canned replies. */
export const historyOnlyContacts: readonly ContactId[] = [
  'date',
  'mine',
  'akiyama',
  'saejima',
  'ichiban',
];
export interface DayMessage {
  id: string;
  text: string;
  outgoing: boolean;
  time: string;
  noteId?: string;
  sequence?: number;
  /** Actual client event time; absent on the initial story and legacy rows. */
  createdAt?: number;
}
export interface StoryChoice {
  id: string;
  text: string;
  response: string;
  affinityDelta?: number;
  quest?: ReminderId;
}
export const dayMessages: Record<ContactId, DayMessage[]> = {
  haruka: [
    { id: 'h1', text: '아저씨, 오늘 저녁은 카레 어때요?', outgoing: false, time: '16:25' },
    { id: 'h2', text: '좋다. 장은 내가 봐 오겠다.', outgoing: true, time: '16:28' },
    {
      id: 'h-uniform',
      text: '아이들 체육복 이름표가 또 풀렸어요. 아저씨 메모에 적어뒀어요. 제가 정리하는 동안 조금만 도와주실래요?',
      outgoing: false,
      time: '16:30',
      noteId: 'gym',
    },
    {
      id: 'h-evening',
      text: '텃밭이랑 마메 밥은 미리 알림에 적어뒀어요. 한꺼번에 하지 말고 하나씩 해요.',
      outgoing: false,
      time: '16:32',
    },
    {
      id: 'h3',
      text: '아저씨, 카레 재료 메모에 적어뒀어요.\n당근은 아직 있어요!',
      outgoing: false,
      time: '16:40',
      noteId: 'curry',
    },
  ],
  majima: [
    { id: 'm1', text: '키류쨩! 폰은 들고 다니는 기 맞나?', outgoing: false, time: '어제' },
    {
      id: 'm2',
      text: '전화도 안 받고. 혼자 재밌는 거라도 찾았나 보네.',
      outgoing: false,
      time: '어제',
    },
    {
      id: 'm3',
      text: '못 봤다고 또 그러지 마라. 여기 남겨놓는다.',
      outgoing: false,
      time: '11:10',
    },
    {
      id: 'm4',
      text: '오늘은 한 판 받아줄 시간이 있겠제? 카무로쵸 올 거면 연락해라.',
      outgoing: false,
      time: '15:10',
      noteId: 'majima-meet',
    },
  ],
  daigo: [
    {
      id: 'd1',
      text: '키류 씨, 잠시 의견을 여쭙고 싶습니다. 제가 직접 확인해야 할 일 같아서요.',
      outgoing: false,
      time: '어제',
    },
    { id: 'd2', text: '네가 결정할 일이다. 다만 이야기는 듣겠다.', outgoing: true, time: '어제' },
    { id: 'd3', text: '네. …일이 없어도 연락드려도 되겠습니까?', outgoing: false, time: '어제' },
  ],
  saejima: [
    {
      id: 's1',
      text: '키류, 마지마가 또 니 찾더라. 이번엔 무슨 꿍꿍이인지 말을 안 하네.',
      outgoing: false,
      time: '어제',
    },
    { id: 's2', text: '형님답군. 사에지마, 너는 별일 없나?', outgoing: true, time: '어제' },
    { id: 's3', text: '나는 괜찮다. 니한테는 괜히 숨길 것도 없고.', outgoing: false, time: '어제' },
    {
      id: 's4',
      text: '…방금 말은 됐다. 마지마 만나면 연락이나 해라.',
      outgoing: false,
      time: '어제',
    },
  ],
  mine: [
    {
      id: 'n1',
      text: '키류 씨. 왜 다이고 씨가 당신을 그토록 신뢰하는지, 저는 아직 모르겠습니다.',
      outgoing: false,
      time: '어제',
    },
    {
      id: 'n2',
      text: '이해해 달라고 할 생각은 없다. 다이고의 뜻은 존중해 줘라.',
      outgoing: true,
      time: '어제',
    },
    {
      id: 'n3',
      text: '다이고 씨의 뜻이라면 따릅니다. 당신에게 동의했다는 뜻은 아닙니다.',
      outgoing: false,
      time: '어제',
    },
    {
      id: 'n4',
      text: '…다음에는 직접 이야기하시죠. 문자로 끝낼 이야기는 아닌 것 같군요.',
      outgoing: false,
      time: '어제',
    },
  ],
  date: [
    {
      id: 'date1',
      text: '키류, 문자 봤으면 연락 좀 해. 또 혼자 무슨 일 벌이는 건 아니지?',
      outgoing: false,
      time: '15:45',
    },
    {
      id: 'date2',
      text: '별일 없습니다, 다테 씨. 걱정 끼쳐서 죄송합니다.',
      outgoing: true,
      time: '15:48',
    },
    {
      id: 'date3',
      text: '그 말이 제일 걱정된다니까. …아무 일 없어도 가끔 얼굴은 비춰.',
      outgoing: false,
      time: '15:50',
    },
    {
      id: 'date-parcel',
      text: '맡아뒀던 네 물건, 봉투에 넣어 보냈다. 받으면 연락해.',
      outgoing: false,
      time: '16:10',
      noteId: 'parcel',
    },
  ],
  akiyama: [
    {
      id: 'akiyama1',
      text: '키류 씨, 커피 한 잔 하시죠. 일 얘기는 안 하셔도 됩니다.',
      outgoing: false,
      time: '14:30',
    },
    { id: 'akiyama2', text: '무슨 부탁이라도 있나?', outgoing: true, time: '14:32' },
    {
      id: 'akiyama3',
      text: '너무하시네. 그냥 키류 씨가 보고 싶을 수도 있잖아요.',
      outgoing: false,
      time: '14:33',
    },
    {
      id: 'akiyama4',
      text: '…직접 쓰니까 좀 쑥스럽군요. 커피는 제가 살게요.',
      outgoing: false,
      time: '14:34',
    },
  ],
  ichiban: [
    {
      id: 'ichiban1',
      text: '키류 씨! 이치반입니다. 번호 제대로 저장한 거 맞죠?',
      outgoing: false,
      time: '14:10',
    },
    { id: 'ichiban2', text: '그래, 카스가. 무슨 일이지?', outgoing: true, time: '14:12' },
    {
      id: 'ichiban3',
      text: '아뇨, 큰일은 없고요! 다음에 같이 밥이라도 먹으면 좋겠다 싶어서요.',
      outgoing: false,
      time: '14:13',
    },
    {
      id: 'ichiban4',
      text: '답장 한 통 왔다고 이렇게 좋아하는 건 좀 티 나네요. 하하… 아무튼, 제가 살게요!',
      outgoing: false,
      time: '14:14',
    },
  ],
};
/** Authored IF choices. Three short exchanges, not fabricated model output. */
export const storyRounds: Record<ContactId, StoryChoice[][]> = {
  daigo: [
    [
      {
        id: 'daigo-1a',
        text: '네가 직접 보고 판단해라. 이야기는 듣겠다.',
        response: '네. 먼저 제가 확인하겠습니다. 그 뒤에 말씀드리겠습니다.',
      },
      {
        id: 'daigo-1b',
        text: '지금 급한 일인가?',
        response: '당장 결론 낼 일은 아닙니다. 시간을 내 주실 때 말씀드리겠습니다.',
      },
    ],
    [
      {
        id: 'daigo-2a',
        text: '혼자 모든 걸 떠안을 필요는 없다.',
        response: '알고 있습니다. 맡길 일과 제가 해야 할 일을 나눠 보겠습니다.',
      },
      {
        id: 'daigo-2b',
        text: '확인하고 나서 다시 연락해라.',
        response: '네. 추측만으로 말씀드리지 않겠습니다.',
      },
    ],
    [
      {
        id: 'daigo-3a',
        text: '그래. 기다리마.',
        response: '감사합니다, 키류 씨. 정리되면 연락드리겠습니다.',
      },
      { id: 'daigo-3b', text: '무리하지 마라.', response: '키류 씨도요. 이따 뵙겠습니다.' },
    ],
  ],
  saejima: [
    [
      {
        id: 'saejima-1a',
        text: '마지마 형님이 또 뭘 꾸미시는 거지?',
        response: '나한테도 비밀이라더라. 니 만나면 다 티 날 기다.',
      },
      {
        id: 'saejima-1b',
        text: '지금은 할 일이 있다. 나중에 보자.',
        response: '볼일부터 봐라. 시간 나면 말하고.',
      },
    ],
    [
      {
        id: 'saejima-2a',
        text: '어디로 가고 싶나?',
        response: '마지마부터 찾아야지. 혼자 또 일을 벌이는 건 아닌가 모르겠다.',
      },
      {
        id: 'saejima-2b',
        text: '일 마치고 뭐라도 먹자.',
        response: '좋지. 니가 부르면 시간은 낼 수 있다.',
      },
    ],
    [
      { id: 'saejima-3a', text: '준비되면 연락하겠다.', response: '알았다. 기다리마.' },
      { id: 'saejima-3b', text: '다음에 내가 먼저 부르마.', response: '그래. 빈말로만 하지 말고.' },
    ],
  ],
  mine: [
    [
      {
        id: 'mine-1a',
        text: '고맙다. 다이고에게도 말해 두겠다.',
        response: '네. 서류는 제가 가지고 있겠습니다.',
      },
      {
        id: 'mine-1b',
        text: '다이고와 직접 시간을 맞춰 줘라.',
        response: '알겠습니다. 다이고 씨의 일정에 맞추겠습니다.',
      },
    ],
    [
      {
        id: 'mine-2a',
        text: '빠진 것은 없나?',
        response: '확인했습니다. 추가할 것이 생기면 별도로 말씀드리겠습니다.',
      },
      {
        id: 'mine-2b',
        text: '급하게 서두를 필요는 없다.',
        response: '네. 다만 전달이 늦어지지 않도록 준비해 두겠습니다.',
      },
    ],
    [
      { id: 'mine-3a', text: '알았다. 수고했다.', response: '당신을 위해서 한 일은 아닙니다.' },
      { id: 'mine-3b', text: '다이고를 잘 부탁한다.', response: '그럴 생각입니다, 키류 씨.' },
    ],
  ],
  date: [
    [
      {
        id: 'date-1a',
        text: '다테 씨, 무슨 일입니까?',
        response: '큰일은 아니야. 네가 또 혼자 나선 건 아닌지 물어보려고.',
      },
      {
        id: 'date-1b',
        text: '문자 봤습니다. 지금 말씀하시죠.',
        response: '이번에는 빨리 봤군. 별일 없는 거지?',
      },
    ],
    [
      {
        id: 'date-2a',
        text: '별일 없습니다. 걱정하지 마십시오.',
        response: '그 말이 제일 걱정된다니까. 무슨 일 있으면 먼저 말해.',
      },
      {
        id: 'date-2b',
        text: '일이 생기면 먼저 연락드리겠습니다.',
        response: '좋아. 혼자 다 끝내 놓고 연락하지 말고.',
      },
    ],
    [
      { id: 'date-3a', text: '알겠습니다, 다테 씨.', response: '그래. 나도 다시 연락할게.' },
      {
        id: 'date-3b',
        text: '다음에 식사라도 하시죠.',
        response: '그거 좋지. 날짜 잡히면 알려줘.',
      },
    ],
  ],
  akiyama: [
    [
      {
        id: 'akiyama-1a',
        text: '이번에는 늦지 마라.',
        response: '하하, 벌써 못 믿으시는 겁니까? 알겠습니다.',
      },
      {
        id: 'akiyama-1b',
        text: '좋다. 편한 때 연락해라.',
        response: '네. 일 마무리하고 연락드릴게요.',
      },
    ],
    [
      {
        id: 'akiyama-2a',
        text: '일은 잘 되어가나?',
        response: '쉽지는 않죠. 그래도 제가 벌인 일이니까 해봐야죠.',
      },
      {
        id: 'akiyama-2b',
        text: '커피는 내가 사마.',
        response: '그럼 다음 잔은 제가 사겠습니다. 한 잔으로 끝날지는 모르겠네요.',
      },
    ],
    [
      { id: 'akiyama-3a', text: '그럼 나중에 보자.', response: '네, 키류 씨. 연락드리겠습니다.' },
      {
        id: 'akiyama-3b',
        text: '알았다. 지각하면 먼저 마시고 있겠다.',
        response: '너무 오래 기다리게 하지는 않을게요.',
      },
    ],
  ],
  ichiban: [
    [
      {
        id: 'ichiban-1a',
        text: '카스가, 번호는 맞다.',
        response: '다행이네요! 인사도 제대로 못 할 뻔했습니다.',
      },
      {
        id: 'ichiban-1b',
        text: '지금은 바쁘다. 나중에 연락하마.',
        response: '네! 일부터 보세요. 기다리겠습니다.',
      },
    ],
    [
      {
        id: 'ichiban-2a',
        text: '밥은 챙겨 먹고 있나?',
        response: '그럼요! 키류 씨도 끼니 거르지 마세요.',
      },
      {
        id: 'ichiban-2b',
        text: '동료들도 잘 지내나?',
        response: '네. 다들 자기 자리에서 열심히 살고 있습니다.',
      },
    ],
    [
      {
        id: 'ichiban-3a',
        text: '다음에 밥 한 끼 하지.',
        response: '정말입니까? 제가 괜찮은 곳 찾아놓겠습니다!',
      },
      { id: 'ichiban-3b', text: '그래. 나중에 보자.', response: '네, 키류 씨! 연락 기다릴게요.' },
    ],
  ],
  haruka: [
    [
      {
        id: 'haruka-shopping',
        text: '메모에 적힌 카레 재료는 다 샀다.',
        response: '고마워요. 돌아오시면 같이 정리해요.',
        quest: 'shopping',
      },
    ],
    [
      {
        id: 'haruka-garden',
        text: '오늘 할 일에 적힌 텃밭 물 주기는 끝냈다.',
        response: '고마워요! 잎도 한 번 봐주세요. 저는 저녁 준비할게요.',
        quest: 'garden',
      },
    ],
    [
      {
        id: 'haruka-mame',
        text: '오늘 할 일에 적힌 마메 밥 주기도 끝냈다.',
        response: '마메가 신났겠네요. 이제 아저씨도 잠깐 쉬세요.',
        quest: 'mame',
      },
    ],
    [
      {
        id: 'haruka-uniform',
        text: '아이들 체육복에 풀린 이름표를 다시 달아뒀다.',
        response: '고마워요. 내일 헷갈리지 않게 각자 챙겨둘게요.',
        quest: 'uniform',
      },
    ],
  ],
  majima: [
    [
      {
        id: 'majima-1a',
        text: '형님, 시간 되면 한 판 하시죠.',
        response: '이제야 말이 통하네! 그 말, 잊어버렸다 카지 마라.',
        affinityDelta: 1,
      },
      {
        id: 'majima-1b',
        text: '오늘은 다른 볼일이 있습니다. 나중에 뵙죠.',
        response: '또 볼일이가. 좋다, 나중에는 니가 먼저 불러라.',
        affinityDelta: -1,
      },
    ],
    [
      {
        id: 'majima-2a',
        text: '약속은 기억하고 있습니다.',
        response: '말로만 하지 말고. 기다리는 것도 한두 번이제.',
        affinityDelta: 1,
      },
      {
        id: 'majima-2b',
        text: '형님과는 만나고 싶지 않습니다.',
        response: '그 정도로 싫다 이거제. 알았다. 더 안 붙잡는다.',
        affinityDelta: -2,
      },
    ],
    [
      {
        id: 'majima-3a',
        text: '연락 주셔서 고맙습니다, 형님.',
        response: '됐고, 시간 나면 연락이나 해라.',
        affinityDelta: 1,
      },
      {
        id: 'majima-3b',
        text: '이야기는 나중에 하시죠.',
        response: '그래. 니 볼일부터 봐라.',
        affinityDelta: -1,
      },
    ],
  ],
};
/** Compatibility for the one-choice story saved by earlier versions. */
export const replyChoices = Object.fromEntries(
  contactIds.map((id) => [id, storyRounds[id][0][0]]),
) as Record<ContactId, StoryChoice>;
export const questFollowups: Record<ReminderId, { character: ContactId; text: string }> = {
  shopping: {
    character: 'haruka',
    text: '목록 다 확인했어요? 빠진 게 없는지 한 번만 더 봐주세요.',
  },
  garden: { character: 'haruka', text: '텃밭 물 준 표시 봤어요. 저녁 전에 해주셔서 고마워요!' },
  mame: { character: 'haruka', text: '마메 밥 챙겨주셨네요. 물그릇도 제가 확인할게요.' },
  uniform: {
    character: 'haruka',
    text: '이름표는 제가 아이들별로 챙겨둘게요. 바늘은 상자에 넣어두셨죠?',
  },
  parcel: {
    character: 'date',
    text: '받았구나. 잘 챙겨 둬. 네 물건을 언제까지 내가 맡고 있을 수는 없잖아.',
  },
};
export const callScripts: Record<ContactId, string[]> = {
  majima: [
    '키류쨩!!!!!',
    '문자는 봤나? 니 얼굴 좀 보자고 전화했다.',
    '시간 나면 니가 먼저 연락해라. 내가 또 찾으러 가기 전에.',
  ],
  haruka: [
    '아저씨, 저예요.',
    '아까 적어둔 할 일은 천천히 하셔도 돼요. 어려운 건 같이 해요.',
    '끝나면 문자 주세요. 저도 제 할 일 하고 있을게요.',
  ],
  daigo: [
    '키류 씨, 잠깐 괜찮으십니까?',
    '말씀해 주신 건 제가 먼저 확인하겠습니다.',
    '정리가 되면 다시 연락드리겠습니다.',
  ],
  saejima: [
    '키류, 나다.',
    '마지마가 니한테 연락했나? 아까부터 폰만 보고 있더라.',
    '그래. 별일 없으면 됐다. 나중에 보자.',
  ],
  mine: [
    '키류 씨, 미네입니다.',
    '다이고 씨와 나눈 이야기를 확인하려고 연락했습니다.',
    '오늘은 이만하죠. 다음에는 직접 이야기하겠습니다.',
  ],
  date: [
    '키류, 전화는 받는군.',
    '별일 없는지 확인하려고. 일 생기면 혼자 나서지 말고 연락해.',
    '그래. 나중에 또 보자.',
  ],
  akiyama: [
    '키류 씨, 아키야마입니다.',
    '아까 커피 얘기요. 잊으신 건 아니죠?',
    '알겠습니다. 시간 맞춰서 연락드릴게요.',
  ],
  ichiban: [
    '키류 씨! 이치반입니다!',
    '아, 직접 목소리 들으니까 괜히 긴장되네요. 별일 있으신 건 아니죠?',
    '네! 다음에는 꼭 같이 밥 먹어요. 제가 연락드리겠습니다!',
  ],
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
    id: 'majima-meet',
    title: '형님과의 약속',
    body: '카무로쵸에 갈 때 형님에게 연락.\n택시에서 목적지를 정한 뒤 연락할 것.\n도착하기 전부터 도착했다고 말하지 말 것.',
    checklist: [],
    updatedAt: '2026-10-24T15:10:00+09:00',
  },
  {
    id: 'parcel',
    title: '다테 씨의 봉투',
    body: '다테 씨가 맡아둔 내 물건을 보내주셨다.\n택배를 받으면 미리 알림에 표시하고 연락드릴 것.\n봉투 내용부터 확인. 다른 사람에게 맡기지 말 것.',
    checklist: [],
    updatedAt: '2026-10-24T16:10:00+09:00',
  },
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
    body: '아이들 체육복 이름표 다시 달기.\n실이 쉽게 풀리지 않게 할 것.',
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
