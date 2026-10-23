export const savedSearches = [
  { query: '많은 인원 카레 재료', pageId: 'curry' },
  { query: '바느질 매듭 안 풀리게 하는 법', pageId: 'sewing' },
  { query: '도시락 예쁘게 담는 법', pageId: 'lunchbox' },
] as const;

export const savedArticles = {
  curry: {
    title: '많은 인원 카레 재료',
    intro: '오늘 저녁, 한 냄비에 넉넉하게.',
    sections: [
      {
        title: '장보기 전에',
        body: '감자, 양파, 고기, 카레를 적어 둔다. 당근은 냉장고에 있는 것부터 쓴다.',
      },
      {
        title: '아이들과 먹을 때',
        body: '카레는 순한맛으로. 감자와 고기는 한입 크기로 썰고 충분히 익힌다.',
      },
      {
        title: '마지막으로',
        body: '밥은 넉넉하게. 각자 먹을 만큼 먼저 담고, 더 먹고 싶은 아이에게 한 번 더.',
      },
    ],
  },
  sewing: {
    title: '바느질 매듭 안 풀리게 하는 법',
    intro: '체육복 이름표를 다시 달기 전에.',
    sections: [
      { title: '시작 매듭', body: '실 끝을 작게 두 번 묶고 천의 안쪽에서 바늘을 뺀다.' },
      {
        title: '모서리는 한 번 더',
        body: '이름표 모서리부터 작은 땀으로 고정한다. 실을 너무 세게 당기지 않는다.',
      },
      {
        title: '마무리',
        body: '마지막 땀 아래로 바늘을 통과시키고 작은 고리에 한 번 더 넣어 묶는다. 실 끝을 조금 남긴다.',
      },
    ],
  },
  lunchbox: {
    title: '도시락 예쁘게 담는 법',
    intro: '먹기 편하게. 남김없이 먹어 주면 더 좋고.',
    sections: [
      {
        title: '큰 것부터',
        body: '밥을 먼저 담고 반찬을 차례대로 놓는다. 작은 칸에는 달걀말이와 채소.',
      },
      { title: '색을 조금씩', body: '초록 채소와 붉은 토마토를 곁들이면 도시락이 환해진다.' },
      {
        title: '뚜껑을 닫기 전에',
        body: '따뜻한 음식은 충분히 식힌다. 뚜껑이 닫히는지 확인하고 젓가락도 챙긴다.',
      },
    ],
  },
} as const;

export const internalPages = [
  {
    id: 'curry',
    title: savedArticles.curry.title,
    url: 'https://yaku.test/curry',
    description: '순한 카레를 넉넉하게 만드는 저녁 준비.',
  },
  {
    id: 'sewing',
    title: savedArticles.sewing.title,
    url: 'https://yaku.test/sewing',
    description: '체육복 이름표를 단단하게 달아 두기.',
  },
  {
    id: 'lunchbox',
    title: savedArticles.lunchbox.title,
    url: 'https://yaku.test/lunchbox',
    description: '아이들의 도시락을 담는 작은 요령.',
  },
  {
    id: 'guide',
    title: '시작 안내',
    url: 'https://yaku.test/guide',
    description: '익숙한 동작으로 새로운 화면을 만나보세요.',
  },
  {
    id: 'example',
    title: '예제 페이지',
    url: 'https://yaku.test/example',
    description: '조용한 하루를 위한 작은 아이디어.',
  },
] as const;

export type InternalPageId = (typeof internalPages)[number]['id'];

export type SafariPage =
  | { kind: 'start' }
  | { kind: 'internal'; id: InternalPageId }
  | { kind: 'search'; query: string }
  | { kind: 'external'; url: string };

export function getInternalPage(id: InternalPageId) {
  return internalPages.find((page) => page.id === id)!;
}

export function pageTitle(page: SafariPage): string {
  switch (page.kind) {
    case 'start':
      return '시작 페이지';
    case 'internal':
      return getInternalPage(page.id).title;
    case 'search':
      return `${page.query} 검색 결과`;
    case 'external':
      return new URL(page.url).hostname;
  }
}

export function pageAddress(page: SafariPage): string {
  switch (page.kind) {
    case 'start':
      return '';
    case 'internal':
      return getInternalPage(page.id).url;
    case 'search':
      return page.query;
    case 'external':
      return page.url;
  }
}

export function searchPages(query: string) {
  const normalized = query.trim().toLocaleLowerCase('ko-KR');
  return internalPages.filter((page) => page.title.toLocaleLowerCase('ko-KR').includes(normalized));
}

export type AddressResult = { page: SafariPage; error?: never } | { error: string; page?: never };

export function resolveAddress(input: string): AddressResult {
  const text = input.trim();
  if (!text) return { page: { kind: 'start' } };
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(text)?.[1].toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return { error: 'http 또는 https로 시작하는 웹 주소를 입력해 주세요.' };
  }
  const looksLikeAddress = scheme || /^\/\//.test(text) || /^[^\s/]+\.[^\s]+$/.test(text);
  if (!looksLikeAddress) return { page: { kind: 'search', query: text } };

  let url: URL;
  try {
    url = new URL(scheme ? text : text.startsWith('//') ? `https:${text}` : `https://${text}`);
  } catch {
    return { error: '웹 주소를 확인하고 다시 입력해 주세요.' };
  }
  if (url.username || url.password) {
    return { error: '사용자 이름과 비밀번호가 포함되지 않은 웹 주소를 입력해 주세요.' };
  }
  if (url.hostname === 'yaku.test') {
    const match = internalPages.find(
      (page) => new URL(page.url).pathname === url.pathname.replace(/\/$/, ''),
    );
    if (!match || url.port || url.search || url.hash) {
      return {
        error: '저장된 페이지를 찾을 수 없습니다. 시작 페이지에서 검색 기록을 열어보세요.',
      };
    }
    return { page: { kind: 'internal', id: match.id } };
  }
  return { page: { kind: 'external', url: url.href } };
}
