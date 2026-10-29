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
  'yuki',
] as const;
export type ContactId = (typeof contactIds)[number];
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
  ],
  saejima: [
    {
      id: 's1',
      text: '키류, 시간 있으면 한 바퀴 걷자. 오래 앉아 있었더니 몸이 굳었다.',
      outgoing: false,
      time: '어제',
    },
  ],
  mine: [
    {
      id: 'n1',
      text: '키류 씨. 도지마 씨께 전할 서류를 맡아 두었습니다. 전달할 시간이 정해지면 알려주십시오.',
      outgoing: false,
      time: '어제',
    },
  ],
  date: [
    {
      id: 'date1',
      text: '키류, 자네한테 확인할 게 있네. 문자 봤으면 연락 좀 주게.',
      outgoing: false,
      time: '15:45',
    },
    {
      id: 'date-parcel',
      text: '부탁 하나 하겠네. 예전에 맡아둔 자네 물건을 봉투에 넣어 보냈어. 받으면 내게 알려주게.',
      outgoing: false,
      time: '16:10',
      noteId: 'parcel',
    },
  ],
  akiyama: [
    {
      id: 'akiyama1',
      text: '키류 씨, 커피 한 잔 하시죠. 이번에는 제가 늦지 않겠습니다. 아마도요.',
      outgoing: false,
      time: '14:30',
    },
  ],
  yuki: [
    {
      id: 'yuki1',
      text: '점장님, 오늘은 언제 들르세요? 손님 오시기 전에 잠깐 봐주셨으면 해서요.',
      outgoing: false,
      time: '14:10',
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
        text: '좋다. 조금 걸을까.',
        response: '그래. 서두를 것 없으니 천천히 나오너라.',
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
        response: '사람 적은 길이면 된다. 바람이나 좀 쐬자.',
      },
      {
        id: 'saejima-2b',
        text: '걷고 나서 뭐라도 먹자.',
        response: '좋지. 배고프면 아무리 걸어도 성이 안 찬다.',
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
        response: '알겠습니다. 도지마 씨의 일정에 맞추겠습니다.',
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
      { id: 'mine-3a', text: '알았다. 수고했다.', response: '필요하신 일이 있으면 연락주십시오.' },
      { id: 'mine-3b', text: '다이고를 잘 부탁한다.', response: '그럴 생각입니다, 키류 씨.' },
    ],
  ],
  date: [
    [
      {
        id: 'date-1a',
        text: '다테 씨, 무슨 일입니까?',
        response: '큰일은 아니네. 자네가 또 혼자 나선 건 아닌지 물으려던 참이야.',
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
        response: '그 말이 제일 걱정된다니까. 무슨 일 있으면 먼저 말하게.',
      },
      {
        id: 'date-2b',
        text: '일이 생기면 먼저 연락드리겠습니다.',
        response: '좋아. 혼자 다 끝내 놓고 연락하지 말고.',
      },
    ],
    [
      { id: 'date-3a', text: '알겠습니다, 다테 씨.', response: '그래. 나도 다시 연락하겠네.' },
      {
        id: 'date-3b',
        text: '다음에 식사라도 하시죠.',
        response: '그거 좋지. 날짜 잡히면 알려주게.',
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
  yuki: [
    [
      {
        id: 'yuki-1a',
        text: '조금 있다 들르겠다. 무슨 일이지?',
        response: '자리 배치를 조금 바꿨거든요. 한 번만 봐주세요!',
      },
      {
        id: 'yuki-1b',
        text: '오늘은 늦을 것 같다. 먼저 준비해 줘.',
        response: '네. 급한 일은 아니니까 천천히 오세요.',
      },
    ],
    [
      {
        id: 'yuki-2a',
        text: '불편한 곳이 있으면 말해라.',
        response: '입구 쪽이 조금 좁아 보여요. 제가 옮겨보고 말씀드릴게요.',
      },
      {
        id: 'yuki-2b',
        text: '네가 편한 쪽으로 해도 된다.',
        response: '정말요? 그럼 제가 해볼게요. 나중에 꼭 봐주세요.',
      },
    ],
    [
      { id: 'yuki-3a', text: '수고했다. 도착하면 보마.', response: '네, 점장님. 기다릴게요!' },
      {
        id: 'yuki-3b',
        text: '무리해서 혼자 옮기지 마라.',
        response: '알겠어요. 무거운 건 남겨둘게요.',
      },
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
    text: '받았다고 표시했군. 잘 챙겨두게. 자네 물건을 언제까지 내가 맡고 있을 수는 없잖나.',
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
  saejima: ['키류, 나다.', '별일은 없고, 시간 나면 좀 걷자고.', '서두르지 마라. 준비되면 말해라.'],
  mine: [
    '키류 씨, 미네입니다.',
    '서류 전달 전에 일정만 확인하려고 연락드렸습니다.',
    '확인되면 문자 부탁드립니다.',
  ],
  date: [
    '키류, 전화는 받는군.',
    '별일 없는지 확인하려고 했네. 무슨 일 생기면 먼저 연락하게.',
    '그래. 나중에 또 보세.',
  ],
  akiyama: [
    '키류 씨, 아키야마입니다.',
    '아까 커피 얘기요. 잊으신 건 아니죠?',
    '알겠습니다. 시간 맞춰서 연락드릴게요.',
  ],
  yuki: [
    '점장님, 유키예요!',
    '자리 배치 바꿔 놓은 것만 잠깐 봐주셨으면 해서요.',
    '네, 그럼 오실 때 문자 주세요!',
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
