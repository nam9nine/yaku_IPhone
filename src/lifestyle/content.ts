/** Original everyday-life content for Kiryu's phone. */
export const destinations = [
  { id: 'market', name: '동네 마트', detail: '저녁 카레 재료 사러 가기', symbol: '▧' },
  { id: 'beach', name: '바닷가', detail: '아이들과 약속한 곳', symbol: '☀' },
  { id: 'town', name: '상점가', detail: '체육복 이름표와 실', symbol: '⌂' },
] as const;

export const recipes = [
  {
    id: 'curry',
    title: '드래곤 카레',
    subtitle: '아이들 몫은 순하게',
    time: '40분',
    ingredients: ['감자', '양파', '고기', '카레', '당근 — 냉장고에 있음'],
    steps: [
      '채소를 씻어 한입 크기로 썬다.',
      '냄비에 고기와 양파를 넣고 볶는다.',
      '감자와 당근, 물을 넣고 부드러워질 때까지 끓인다.',
      '불을 끄고 카레를 풀어 준다. 약한 불에서 저어가며 마무리한다.',
    ],
    memo: '이번에는 너무 맵지 않게.',
  },
  {
    id: 'lunch',
    title: '바다에 가져갈 도시락',
    subtitle: '먹기 편하게 조금씩',
    time: '30분',
    ingredients: ['밥', '김', '달걀', '채소'],
    steps: [
      '밥을 식힌 뒤 작은 주먹밥을 만든다.',
      '달걀말이를 익히고 한입 크기로 자른다.',
      '도시락이 식으면 뚜껑을 닫는다. 수건도 챙긴다.',
    ],
    memo: '같은 반찬만 넣지 말 것.',
  },
] as const;
