import type { SafariPage } from './pages';

export type NavigationOperation =
  { kind: 'visit'; page: SafariPage } | { kind: 'back' } | { kind: 'forward' } | { kind: 'reload' };

export interface NavigationEntry {
  id: number;
  page: SafariPage;
  pageIndex: number;
}

export interface SafariTab {
  id: number;
  entries: NavigationEntry[];
  index: number;
  revision: number;
  error: { message: string; pending: NavigationOperation | null } | null;
}

export interface SafariState {
  tabs: SafariTab[];
  activeTabId: number;
  nextTabId: number;
  nextEntryId: number;
}

export type SafariAction =
  | { type: 'navigate'; tabId: number; operation: NavigationOperation; online: boolean }
  | { type: 'retry'; tabId: number; online: boolean }
  | { type: 'address-error'; tabId: number; message: string }
  | { type: 'dismiss-error'; tabId: number }
  | { type: 'new-tab' }
  | { type: 'select-tab'; tabId: number }
  | { type: 'close-tab'; tabId: number }
  | { type: 'page-position'; tabId: number; entryId: number; pageIndex: number };

function blankTab(id: number, entryId: number): SafariTab {
  return {
    id,
    entries: [{ id: entryId, page: { kind: 'start' }, pageIndex: 0 }],
    index: 0,
    revision: 0,
    error: null,
  };
}

export function initialSafariState(): SafariState {
  return { tabs: [blankTab(1, 1)], activeTabId: 1, nextTabId: 2, nextEntryId: 2 };
}

export function currentEntry(tab: SafariTab) {
  return tab.entries[tab.index];
}

function replaceTab(state: SafariState, tab: SafariTab): SafariState {
  return {
    ...state,
    tabs: state.tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate)),
  };
}

function navigate(
  state: SafariState,
  tab: SafariTab,
  operation: NavigationOperation,
  online: boolean,
): SafariState {
  if (operation.kind === 'back' && tab.index === 0) return state;
  if (operation.kind === 'forward' && tab.index === tab.entries.length - 1) return state;
  if (!online) {
    return replaceTab(state, {
      ...tab,
      error: { message: '인터넷 연결을 확인하고 다시 시도해 주세요.', pending: operation },
    });
  }
  if (operation.kind === 'visit') {
    return {
      ...replaceTab(state, {
        ...tab,
        entries: [
          ...tab.entries.slice(0, tab.index + 1),
          { id: state.nextEntryId, page: operation.page, pageIndex: 0 },
        ],
        index: tab.index + 1,
        error: null,
      }),
      nextEntryId: state.nextEntryId + 1,
    };
  }
  return replaceTab(state, {
    ...tab,
    index: tab.index + (operation.kind === 'back' ? -1 : operation.kind === 'forward' ? 1 : 0),
    revision: tab.revision + (operation.kind === 'reload' ? 1 : 0),
    error: null,
  });
}

export function safariReducer(state: SafariState, action: SafariAction): SafariState {
  if (action.type === 'new-tab') {
    return {
      ...state,
      tabs: [...state.tabs, blankTab(state.nextTabId, state.nextEntryId)],
      activeTabId: state.nextTabId,
      nextTabId: state.nextTabId + 1,
      nextEntryId: state.nextEntryId + 1,
    };
  }
  const tab = state.tabs.find((candidate) => candidate.id === action.tabId);
  if (!tab) return state;

  switch (action.type) {
    case 'navigate':
      return navigate(state, tab, action.operation, action.online);
    case 'retry':
      return tab.error?.pending ? navigate(state, tab, tab.error.pending, action.online) : state;
    case 'address-error':
      return replaceTab(state, { ...tab, error: { message: action.message, pending: null } });
    case 'dismiss-error':
      return tab.error ? replaceTab(state, { ...tab, error: null }) : state;
    case 'select-tab':
      return state.activeTabId === tab.id ? state : { ...state, activeTabId: tab.id };
    case 'close-tab': {
      if (state.tabs.length === 1) {
        return {
          tabs: [blankTab(state.nextTabId, state.nextEntryId)],
          activeTabId: state.nextTabId,
          nextTabId: state.nextTabId + 1,
          nextEntryId: state.nextEntryId + 1,
        };
      }
      const index = state.tabs.indexOf(tab);
      const tabs = state.tabs.filter((candidate) => candidate.id !== tab.id);
      return {
        ...state,
        tabs,
        activeTabId:
          state.activeTabId === tab.id
            ? tabs[Math.min(index, tabs.length - 1)].id
            : state.activeTabId,
      };
    }
    case 'page-position': {
      const pageIndex = Math.max(0, Math.floor(action.pageIndex));
      const entry = tab.entries.find((candidate) => candidate.id === action.entryId);
      if (!entry || entry.pageIndex === pageIndex || !Number.isFinite(pageIndex)) return state;
      return replaceTab(state, {
        ...tab,
        entries: tab.entries.map((candidate) =>
          candidate.id === entry.id ? { ...candidate, pageIndex } : candidate,
        ),
      });
    }
  }
}
