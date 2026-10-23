export const internalPages = [
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
        error: '이 주소의 예제 페이지를 찾을 수 없습니다. 시작 안내나 예제 페이지를 열어보세요.',
      };
    }
    return { page: { kind: 'internal', id: match.id } };
  }
  return { page: { kind: 'external', url: url.href } };
}
