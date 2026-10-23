import { describe, expect, it } from 'vitest';
import {
  currentEntry,
  initialSafariState,
  safariReducer,
  type NavigationOperation,
  type SafariState,
} from './navigation';
import { resolveAddress, searchPages, type SafariPage } from './pages';

const guide: SafariPage = { kind: 'internal', id: 'guide' };
const example: SafariPage = { kind: 'internal', id: 'example' };
const activeTab = (state: SafariState) => state.tabs.find((tab) => tab.id === state.activeTabId)!;
const navigate = (state: SafariState, operation: NavigationOperation, online = true) =>
  safariReducer(state, { type: 'navigate', tabId: state.activeTabId, operation, online });
const visit = (state: SafariState, page: SafariPage, online = true) =>
  navigate(state, { kind: 'visit', page }, online);

describe('Safari 주소 입력', () => {
  it('정확한 내부 주소와 스킴을 생략한 내부 주소를 같은 페이지로 해석한다', () => {
    expect(resolveAddress('https://yaku.test/guide')).toEqual({ page: guide });
    expect(resolveAddress(' yaku.test/example ')).toEqual({ page: example });
    expect(resolveAddress('https://yaku.test/guide/')).toEqual({ page: guide });
  });
  it('두 내부 페이지의 제목만 검색한다', () => {
    expect(resolveAddress('시작 안내')).toEqual({ page: { kind: 'search', query: '시작 안내' } });
    expect(searchPages('안내').map((page) => page.id)).toEqual(['guide']);
    expect(searchPages('예제').map((page) => page.id)).toEqual(['example']);
    expect(searchPages('조용한')).toEqual([]);
  });
  it('외부 http(s) 주소는 자동 실행하지 않고 외부 안내 대상 URL로 반환한다', () => {
    expect(resolveAddress('example.com/path?q=1')).toEqual({
      page: { kind: 'external', url: 'https://example.com/path?q=1' },
    });
    expect(resolveAddress('http://example.com')).toEqual({
      page: { kind: 'external', url: 'http://example.com/' },
    });
    expect(resolveAddress('//example.com')).toEqual({
      page: { kind: 'external', url: 'https://example.com/' },
    });
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///etc/passwd',
    'mailto:a@example.com',
    'tel:123',
  ])('%s 프로토콜을 탐색 대상으로 만들지 않는다', (input) => {
    expect(resolveAddress(input)).toHaveProperty('error');
  });
  it('잘못된 URL·인증정보·없는 내부 페이지는 주소 오류로 처리한다', () => {
    for (const input of [
      'https://',
      'https://example.com:wrong',
      'https://user:pass@example.com',
      'https://yaku.test/missing',
      'https://yaku.test/guide?unknown=1',
    ]) {
      expect(resolveAddress(input)).toHaveProperty('error');
    }
  });
});

describe('Safari 탭별 탐색', () => {
  it('뒤로 간 뒤 새 주소로 이동하면 해당 탭의 앞으로 기록을 대체한다', () => {
    let state = visit(visit(initialSafariState(), guide), example);
    state = navigate(state, { kind: 'back' });
    state = visit(state, { kind: 'search', query: '안내' });
    expect(activeTab(state).entries.map((entry) => entry.page)).toEqual([
      { kind: 'start' },
      guide,
      { kind: 'search', query: '안내' },
    ]);
    expect(navigate(state, { kind: 'forward' })).toBe(state);
  });
  it('탭을 바꾸어도 각 탭의 현재 페이지와 뒤로/앞으로 위치를 유지한다', () => {
    let state = visit(initialSafariState(), guide);
    const firstId = state.activeTabId;
    state = safariReducer(state, { type: 'new-tab' });
    state = visit(state, example);
    const secondId = state.activeTabId;
    state = safariReducer(state, { type: 'select-tab', tabId: firstId });
    expect(currentEntry(activeTab(state)).page).toEqual(guide);
    state = navigate(state, { kind: 'back' });
    state = safariReducer(state, { type: 'select-tab', tabId: secondId });
    expect(currentEntry(activeTab(state)).page).toEqual(example);
    expect(state.tabs.find((tab) => tab.id === firstId)!.index).toBe(0);
  });
  it('선택한 탭을 닫으면 남은 탭을 열고 마지막 탭을 닫으면 빈 시작 탭을 만든다', () => {
    let state = visit(initialSafariState(), guide);
    const firstId = state.activeTabId;
    state = safariReducer(state, { type: 'new-tab' });
    state = safariReducer(state, { type: 'close-tab', tabId: state.activeTabId });
    expect(state.activeTabId).toBe(firstId);
    expect(currentEntry(activeTab(state)).page).toEqual(guide);
    state = safariReducer(state, { type: 'close-tab', tabId: firstId });
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).not.toBe(firstId);
    expect(activeTab(state).entries.map((entry) => entry.page)).toEqual([{ kind: 'start' }]);
  });
  it('비활성 탭 닫기는 현재 탭의 위치를 바꾸지 않는다', () => {
    let state = visit(initialSafariState(), guide);
    const firstId = state.activeTabId;
    state = safariReducer(state, { type: 'new-tab' });
    const secondId = state.activeTabId;
    state = safariReducer(state, { type: 'close-tab', tabId: firstId });
    expect(state.activeTabId).toBe(secondId);
  });
  it('기록의 스크롤 위치를 탭별로 유지하고 새 탐색은 맨 위에서 시작한다', () => {
    let state = visit(initialSafariState(), guide);
    state = safariReducer(state, {
      type: 'page-position',
      tabId: state.activeTabId,
      entryId: currentEntry(activeTab(state)).id,
      pageIndex: 3,
    });
    state = visit(state, example);
    expect(currentEntry(activeTab(state)).pageIndex).toBe(0);
    state = navigate(state, { kind: 'back' });
    expect(currentEntry(activeTab(state)).pageIndex).toBe(3);
  });
  it('새로고침은 현재 기록을 중복 추가하지 않는다', () => {
    let state = visit(initialSafariState(), guide);
    state = navigate(state, { kind: 'reload' });
    expect(activeTab(state).entries).toHaveLength(2);
    expect(currentEntry(activeTab(state)).page).toEqual(guide);
    expect(activeTab(state).revision).toBe(1);
  });
  it('없어진 탭을 향한 늦은 이벤트는 무시한다', () => {
    const state = initialSafariState();
    expect(
      safariReducer(state, { type: 'page-position', tabId: 99, entryId: 1, pageIndex: 2 }),
    ).toBe(state);
    expect(safariReducer(state, { type: 'select-tab', tabId: 99 })).toBe(state);
  });
});

describe('Safari 연결 오류와 재시도', () => {
  it('실패한 신규 이동은 현재 페이지와 기록을 보존하고 연결 복구 후 한 번만 추가한다', () => {
    let state = visit(initialSafariState(), guide);
    const entries = activeTab(state).entries;
    state = visit(state, example, false);
    expect(activeTab(state).entries).toBe(entries);
    expect(currentEntry(activeTab(state)).page).toEqual(guide);
    state = safariReducer(state, { type: 'retry', tabId: state.activeTabId, online: false });
    expect(activeTab(state).entries).toBe(entries);
    state = safariReducer(state, { type: 'retry', tabId: state.activeTabId, online: true });
    expect(currentEntry(activeTab(state)).page).toEqual(example);
    expect(activeTab(state).entries).toHaveLength(3);
    expect(safariReducer(state, { type: 'retry', tabId: state.activeTabId, online: true })).toBe(
      state,
    );
  });
  it.each(['back', 'forward', 'reload'] as const)(
    '오프라인 %s의 목적을 유지하고 재시도 때 해당 동작을 수행한다',
    (kind) => {
      let state = visit(visit(initialSafariState(), guide), example);
      if (kind === 'forward') state = navigate(state, { kind: 'back' });
      const index = activeTab(state).index;
      const length = activeTab(state).entries.length;
      state = navigate(state, { kind }, false);
      expect(activeTab(state).index).toBe(index);
      expect(activeTab(state).entries).toHaveLength(length);
      state = safariReducer(state, { type: 'retry', tabId: state.activeTabId, online: true });
      expect(activeTab(state).index).toBe(
        index + (kind === 'back' ? -1 : kind === 'forward' ? 1 : 0),
      );
      expect(activeTab(state).entries).toHaveLength(length);
      expect(activeTab(state).error).toBeNull();
    },
  );
  it('다른 탭으로 이동해도 실패한 탭의 재시도 대상은 바뀌지 않는다', () => {
    let state = visit(initialSafariState(), guide);
    const firstId = state.activeTabId;
    state = visit(state, example, false);
    state = safariReducer(state, { type: 'new-tab' });
    state = safariReducer(state, { type: 'select-tab', tabId: firstId });
    expect(currentEntry(activeTab(state)).page).toEqual(guide);
    expect(activeTab(state).error?.pending).toEqual({ kind: 'visit', page: example });
  });
  it('오류 닫기와 잘못된 주소 입력은 숨겨진 탐색을 실행하지 않는다', () => {
    let state = visit(initialSafariState(), guide);
    state = visit(state, example, false);
    state = safariReducer(state, { type: 'dismiss-error', tabId: state.activeTabId });
    expect(safariReducer(state, { type: 'retry', tabId: state.activeTabId, online: true })).toBe(
      state,
    );
    state = safariReducer(state, {
      type: 'address-error',
      tabId: state.activeTabId,
      message: '주소 오류',
    });
    expect(activeTab(state).error?.pending).toBeNull();
    expect(currentEntry(activeTab(state)).page).toEqual(guide);
    expect(activeTab(state).entries).toHaveLength(2);
  });
});
