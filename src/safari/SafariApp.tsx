import { flushSync } from 'react-dom';
import { useEffect, useEffectEvent, useReducer, useRef, useState, type FormEvent } from 'react';
import {
  currentEntry,
  initialSafariState,
  safariReducer,
  type NavigationOperation,
  type SafariAction,
  type SafariTab,
} from './navigation';
import { pageAddress, pageTitle, resolveAddress, type SafariPage } from './pages';
import { SafariContent } from './SafariContent';
import { SafariIcon } from './SafariIcon';
import { PagedContent } from '../navigation/PagedContent';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import './safari.css';

function SafariDocument({
  tab,
  visible,
  active,
  online,
  dispatch,
}: {
  tab: SafariTab;
  visible: boolean;
  active: boolean;
  online: boolean;
  dispatch: React.Dispatch<SafariAction>;
}) {
  const entry = currentEntry(tab);
  const visit = (page: SafariPage) =>
    dispatch({ type: 'navigate', tabId: tab.id, operation: { kind: 'visit', page }, online });
  return (
    <div
      className="safari-document"
      hidden={!visible}
      inert={!active || Boolean(tab.error)}
      aria-label={pageTitle(entry.page)}
    >
      <PagedContent
        key={entry.id}
        label="Safari 본문"
        active={active && visible && !tab.error}
        page={entry.pageIndex}
        onPageChange={(pageIndex) =>
          dispatch({ type: 'page-position', tabId: tab.id, entryId: entry.id, pageIndex })
        }
      >
        <SafariContent
          page={entry.page}
          visit={visit}
          openExternal={(event) => {
            if (!online) {
              event.preventDefault();
              dispatch({ type: 'navigate', tabId: tab.id, operation: { kind: 'reload' }, online });
            }
          }}
        />
      </PagedContent>
    </div>
  );
}

export function SafariApp({ online, active }: { online: boolean; active: boolean }) {
  const [state, dispatch] = useReducer(safariReducer, undefined, initialSafariState);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tabsVisible, setTabsVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)!;
  const page = currentEntry(tab).page;

  useEffect(() => {
    if (active && menuOpen) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [active, menuOpen]);
  useEffect(() => {
    if (!active) input.current?.blur();
  }, [active]);

  function closeMenu() {
    flushSync(() => setMenuOpen(false));
    menuButton.current?.focus();
  }

  const dismissMenu = useEffectEvent(() => closeMenu());
  useEffect(() => {
    if (!active || !menuOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissMenu();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [active, menuOpen]);

  function navigate(operation: NavigationOperation) {
    dispatch({ type: 'navigate', tabId: tab.id, operation, online });
    setTabsVisible(false);
  }
  function editAddress() {
    // Keep focus in the initiating user event so iOS can show its software keyboard.
    flushSync(() => {
      setDraft(pageAddress(page));
      setEditing(true);
      setMenuOpen(false);
    });
    input.current?.focus();
    input.current?.select();
  }
  function submitAddress(event: FormEvent) {
    event.preventDefault();
    const result = resolveAddress(draft);
    if (result.error) dispatch({ type: 'address-error', tabId: tab.id, message: result.error });
    else if (result.page) navigate({ kind: 'visit', page: result.page });
    setEditing(false);
    input.current?.blur();
  }
  function newTab() {
    dispatch({ type: 'new-tab' });
    setTabsVisible(false);
    setMenuOpen(false);
    setEditing(false);
  }

  function back() {
    if (menuOpen) closeMenu();
    else if (editing) {
      setEditing(false);
      input.current?.blur();
    } else if (tabsVisible) setTabsVisible(false);
    else if (tab.error) dispatch({ type: 'dismiss-error', tabId: tab.id });
    else navigate({ kind: 'back' });
  }
  const edge = useEdgeNavigation({
    active,
    onBack: back,
    onForward:
      !menuOpen && !editing && !tabsVisible && !tab.error && tab.index < tab.entries.length - 1
        ? () => navigate({ kind: 'forward' })
        : undefined,
  });

  return (
    <section className="safari-app" aria-label="Safari" {...edge}>
      <h1 className="safari-visually-hidden" data-app-title tabIndex={-1}>
        Safari
      </h1>
      <div className="safari-viewport" inert={menuOpen}>
        {state.tabs.map((item) => (
          <SafariDocument
            key={item.id}
            tab={item}
            visible={!tabsVisible && item.id === tab.id}
            active={active && !menuOpen}
            online={online}
            dispatch={dispatch}
          />
        ))}
        {tabsVisible && (
          <section className="safari-tabs" aria-label="열린 탭">
            <header>
              <h2>탭 {state.tabs.length}개</h2>
              <button
                tabIndex={0}
                className="safari-icon-button"
                aria-label="새 탭"
                onClick={newTab}
              >
                <SafariIcon name="plus" />
              </button>
            </header>
            <PagedContent
              label="탭 목록"
              active={active && !menuOpen}
              contentClassName="safari-tab-grid"
            >
              {state.tabs.map((item) => {
                const itemPage = currentEntry(item).page;
                return (
                  <div
                    className={`safari-tab-card${item.id === tab.id ? ' safari-tab-selected' : ''}`}
                    key={item.id}
                  >
                    <button
                      tabIndex={0}
                      className="safari-tab-select"
                      aria-label={`${pageTitle(itemPage)} 탭 선택`}
                      onClick={() => {
                        dispatch({ type: 'select-tab', tabId: item.id });
                        setTabsVisible(false);
                      }}
                    >
                      <span className={`safari-tab-preview safari-tab-preview-${itemPage.kind}`}>
                        <SafariIcon
                          name={
                            itemPage.kind === 'start'
                              ? 'compass'
                              : itemPage.kind === 'search'
                                ? 'search'
                                : 'globe'
                          }
                        />
                        <strong>{pageTitle(itemPage)}</strong>
                        <span>
                          {itemPage.kind === 'start'
                            ? '새로운 페이지를 만나보세요'
                            : pageAddress(itemPage)}
                        </span>
                      </span>
                      <span className="safari-tab-caption">{pageTitle(itemPage)}</span>
                    </button>
                    <button
                      tabIndex={0}
                      className="safari-tab-close"
                      aria-label={`${pageTitle(itemPage)} 탭 닫기`}
                      onClick={() => {
                        dispatch({ type: 'close-tab', tabId: item.id });
                        if (state.tabs.length === 1) setTabsVisible(false);
                      }}
                    >
                      <SafariIcon name="close" />
                    </button>
                  </div>
                );
              })}
            </PagedContent>
          </section>
        )}
        {!tabsVisible && tab.error && (
          <div className="safari-error-layer">
            <PagedContent
              label="오류 안내"
              active={active && !menuOpen}
              contentClassName="safari-error"
            >
              <section role="alert">
                <SafariIcon name="globe" />
                <h2>{tab.error.pending ? '연결할 수 없습니다' : '주소를 열 수 없습니다'}</h2>
                <p>{tab.error.message}</p>
                {tab.error.pending && (
                  <button
                    tabIndex={0}
                    className="safari-primary-button"
                    onClick={() => dispatch({ type: 'retry', tabId: tab.id, online })}
                  >
                    다시 시도
                  </button>
                )}
                <button
                  tabIndex={0}
                  className="safari-text-link"
                  onClick={() => dispatch({ type: 'dismiss-error', tabId: tab.id })}
                >
                  닫기
                </button>
              </section>
            </PagedContent>
          </div>
        )}
      </div>
      <div className="safari-bottom-bar" inert={menuOpen}>
        {!online && (
          <p className="safari-offline-label" role="status">
            오프라인
          </p>
        )}
        {tabsVisible ? (
          <div className="safari-tabs-toolbar">
            <button tabIndex={0} className="safari-icon-button" aria-label="새 탭" onClick={newTab}>
              <SafariIcon name="plus" />
            </button>
            <span>탭 {state.tabs.length}개</span>
            <button tabIndex={0} className="safari-done" onClick={() => setTabsVisible(false)}>
              완료
            </button>
          </div>
        ) : (
          <form className="safari-toolbar" onSubmit={submitAddress}>
            {!editing && (
              <button
                tabIndex={0}
                type="button"
                className="safari-icon-button safari-round-button"
                aria-label="뒤로"
                disabled={tab.index === 0 && !tab.error}
                onClick={back}
              >
                <SafariIcon name="back" />
              </button>
            )}
            <div className={`safari-address-capsule${editing ? ' safari-address-editing' : ''}`}>
              {!editing && (
                <button
                  tabIndex={0}
                  type="button"
                  className="safari-icon-button"
                  aria-label="페이지 메뉴"
                  ref={menuButton}
                  onClick={() => setMenuOpen(true)}
                >
                  <SafariIcon name="menu" />
                </button>
              )}
              {editing ? (
                <input
                  tabIndex={0}
                  ref={input}
                  aria-label="주소 또는 검색어"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setEditing(false);
                      input.current?.blur();
                    }
                  }}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="go"
                />
              ) : (
                <button
                  tabIndex={0}
                  className="safari-address-display"
                  type="button"
                  aria-label="주소 또는 검색어 입력"
                  onClick={editAddress}
                >
                  {page.kind === 'start' ? (
                    <>
                      <SafariIcon name="search" />
                      <span>검색 또는 웹 사이트 이름</span>
                    </>
                  ) : (
                    <span>
                      {page.kind === 'internal'
                        ? `yaku.test/${page.id}`
                        : page.kind === 'external'
                          ? new URL(page.url).hostname
                          : page.query}
                    </span>
                  )}
                </button>
              )}
              {editing ? (
                <button tabIndex={0} className="safari-icon-button" type="submit" aria-label="이동">
                  <SafariIcon name="arrow" />
                </button>
              ) : (
                <button
                  tabIndex={0}
                  className="safari-icon-button"
                  type="button"
                  aria-label="새로 고침"
                  onClick={() => navigate({ kind: 'reload' })}
                >
                  <SafariIcon name="reload" />
                </button>
              )}
            </div>
            {editing ? (
              <button
                tabIndex={0}
                className="safari-cancel"
                type="button"
                onClick={() => {
                  setEditing(false);
                  input.current?.blur();
                }}
              >
                취소
              </button>
            ) : (
              <button
                tabIndex={0}
                className="safari-icon-button safari-round-button"
                type="button"
                aria-label={`탭 보기, ${state.tabs.length}개`}
                onClick={() => setTabsVisible(true)}
              >
                <SafariIcon name="tabs" />
              </button>
            )}
          </form>
        )}
      </div>
      {menuOpen && (
        <div
          className="safari-menu-layer"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeMenu();
          }}
        >
          <div
            ref={dialog}
            className="safari-menu"
            role="dialog"
            aria-modal={false}
            aria-labelledby="safari-menu-title"
          >
            <header>
              <h2 id="safari-menu-title">페이지 메뉴</h2>
              <button
                tabIndex={0}
                className="safari-icon-button"
                aria-label="페이지 메뉴 닫기"
                onClick={closeMenu}
              >
                <SafariIcon name="close" />
              </button>
            </header>
            <PagedContent label="페이지 메뉴" active={active}>
              <div className="safari-page-info">
                <strong>{pageTitle(page)}</strong>
                <span>{pageAddress(page) || '시작 페이지'}</span>
              </div>
              <button tabIndex={0} className="safari-menu-row" onClick={editAddress}>
                <SafariIcon name="search" />
                주소 편집
              </button>
              <button
                tabIndex={0}
                className="safari-menu-row"
                disabled={tab.index === tab.entries.length - 1}
                onClick={() => {
                  navigate({ kind: 'forward' });
                  setMenuOpen(false);
                }}
              >
                <SafariIcon name="forward" />
                앞으로
              </button>
              <button
                tabIndex={0}
                className="safari-menu-row"
                onClick={() => {
                  navigate({ kind: 'visit', page: { kind: 'start' } });
                  setMenuOpen(false);
                }}
              >
                <SafariIcon name="compass" />
                시작 페이지
              </button>
              <button tabIndex={0} className="safari-menu-row" onClick={newTab}>
                <SafariIcon name="plus" />새 탭
              </button>
            </PagedContent>
          </div>
        </div>
      )}
    </section>
  );
}
