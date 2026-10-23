import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { AppIcon } from '../home/AppIcon';
import { useDisplayDate } from '../display/useDisplayDate';
import { type DevicePreferences } from '../settings/preferences';
import type { RunnableApp } from '../shell/session';
import { AppSnapshot } from './AppSnapshot';
import { SystemIcon } from './SystemIcon';
import { HomeIndicator } from './HomeIndicator';
import { ControlCenter, type ControlState } from './ControlCenter';
import { usePanelSwipe } from './usePanelSwipe';
import './system-panels.css';

export type SystemPanelKind = 'control' | 'switcher' | 'notifications' | 'search';
export interface SystemPanelsProps {
  controls: ControlState;
  onControls: (next: ControlState) => void;
  kind: SystemPanelKind;
  recent: RunnableApp[];
  activeApp: RunnableApp | null;
  preferences: DevicePreferences;
  onPreferences: (next: DevicePreferences) => void;
  onSelectApp: (app: RunnableApp) => void;
  onCloseApp: (app: RunnableApp) => void;
  onDismiss: () => void;
  getPreview: (app: RunnableApp) => HTMLElement | null;
  viewport: { width: number; height: number };
}

const titles: Record<SystemPanelKind, string> = {
  control: '제어 센터',
  switcher: '최근 앱',
  notifications: '알림 센터',
  search: '검색',
};
const appNames: Record<RunnableApp, string> = { settings: '설정', safari: 'Safari' };
const supportedApps: RunnableApp[] = ['settings', 'safari'];

function rootFontScale() {
  return (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
}

function subscribeRootFont(onChange: () => void) {
  // Observe rem itself, including browser text enlargement that does not change
  // the saved preference or the CSS viewport dimensions.
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-10000px',
    width: '1rem',
    height: '1rem',
    pointerEvents: 'none',
    contain: 'strict',
  });
  document.body.append(probe);
  const resize = new ResizeObserver(onChange);
  resize.observe(probe);
  const attributes = new MutationObserver(onChange);
  attributes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  return () => {
    resize.disconnect();
    attributes.disconnect();
    probe.remove();
  };
}

function isTextInput(element: Element | null) {
  return element?.matches('input, textarea, [contenteditable="true"]') ?? false;
}

function RecentApps({
  recent,
  onSelectApp,
  onCloseApp,
  getPreview,
  viewport,
}: Pick<SystemPanelsProps, 'recent' | 'onSelectApp' | 'onCloseApp' | 'getPreview' | 'viewport'>) {
  const [requestedIndex, setIndex] = useState(0);
  const [draggedApp, setDraggedApp] = useState<RunnableApp | null>(null);
  const index = Math.min(requestedIndex, Math.max(0, recent.length - 1));
  const move = (next: number) => setIndex(Math.max(0, Math.min(recent.length - 1, next)));
  const swipe = usePanelSwipe({
    horizontal: (direction) => move(index + direction),
    upward: () => {
      if (draggedApp) onCloseApp(draggedApp);
    },
  });
  return (
    <div className="recent-apps">
      {!recent.length && (
        <span className="system-sr-only" role="status">
          열린 앱이 없습니다.
        </span>
      )}
      <div
        className="recent-viewport"
        {...swipe.handlers}
        onPointerDown={(event) => {
          setDraggedApp(
            ((event.target as HTMLElement).closest<HTMLElement>('[data-recent-app]')?.dataset
              .recentApp as RunnableApp) ?? null,
          );
          swipe.handlers.onPointerDown(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            move(index + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
      >
        <div className="recent-track" data-dragging={swipe.offset.x !== 0}>
          {recent.map((application, position) => (
            <article
              key={application}
              className="recent-card"
              data-recent-app={application}
              data-active={position === index}
              data-dragging={draggedApp === application && swipe.offset.y !== 0}
              style={
                {
                  '--card-offset': position - index,
                  '--card-drag-x': `${swipe.offset.x * 0.6}px`,
                  '--card-drag-y': `${draggedApp === application ? swipe.offset.y : 0}px`,
                  '--card-scale': position === index ? 1 : 0.94,
                  zIndex: recent.length - Math.abs(position - index),
                  opacity: draggedApp === application ? Math.max(0, 1 + swipe.offset.y / 420) : 1,
                } as CSSProperties
              }
            >
              <header className="recent-card-title">
                <AppIcon id={application} day="" weekday="" />
                <span>{appNames[application]}</span>
                <button
                  type="button"
                  className="system-keyboard-control"
                  data-no-swipe
                  aria-label={`${appNames[application]} 앱 닫기`}
                  onClick={() => onCloseApp(application)}
                >
                  {appNames[application]} 앱 닫기
                </button>
              </header>
              <button
                type="button"
                className="recent-open"
                aria-label={`${appNames[application]} 앱으로 전환`}
                onClick={() => onSelectApp(application)}
              >
                <AppSnapshot app={application} getPreview={getPreview} viewport={viewport} />
              </button>
            </article>
          ))}
        </div>
      </div>
      <button
        className="system-keyboard-control"
        disabled={index === 0}
        onClick={() => move(index - 1)}
      >
        이전 최근 앱 페이지
      </button>
      <button
        className="system-keyboard-control"
        disabled={index === recent.length - 1 || !recent.length}
        onClick={() => move(index + 1)}
      >
        다음 최근 앱 페이지
      </button>
    </div>
  );
}

function Notifications() {
  const date = useDisplayDate();
  return (
    <div className="notification-center">
      <div className="notification-date">
        <time dateTime={date.isoDate}>{date.label}</time>
        <span aria-label={date.accessibleTime}>{date.clock}</span>
      </div>
      <p className="notification-empty">이전 알림 없음</p>
    </div>
  );
}

function AppSearch({ onSelectApp }: Pick<SystemPanelsProps, 'onSelectApp'>) {
  const [query, setQuery] = useState('');
  const matches = supportedApps.filter((app) =>
    appNames[app].toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')),
  );
  return (
    <div className="system-search">
      <label className="system-search-input">
        <SystemIcon name="search" />
        <input
          type="text"
          enterKeyHint="search"
          aria-label="앱 검색"
          placeholder="검색"
          value={query}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches.length === 1) {
              event.preventDefault();
              onSelectApp(matches[0]);
            }
          }}
        />
      </label>
      <div className="system-search-results" aria-label="검색 결과">
        {matches.length ? (
          matches.map((app) => (
            <button key={app} type="button" onClick={() => onSelectApp(app)}>
              <AppIcon id={app} day="" weekday="" />
              <span>{appNames[app]}</span>
            </button>
          ))
        ) : (
          <p className="system-note" role="status">
            일치하는 앱이 없어요.
          </p>
        )}
      </div>
    </div>
  );
}

export function SystemPanels(props: SystemPanelsProps) {
  const { kind, onDismiss, onSelectApp, viewport } = props;
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(true);
  const [previous] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const titleId = useId();
  const fontScale = useSyncExternalStore(subscribeRootFont, rootFontScale);
  const dismiss = useEffectEvent(onDismiss);
  const swipe = usePanelSwipe({ upward: onDismiss });

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    heading.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
      if (event.key !== 'Tab') return;
      const targets = [
        ...node.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'),
      ].filter(
        (element) =>
          !element.matches(':disabled, [tabindex="-1"]') &&
          !element.closest('[inert], [hidden]') &&
          element.getClientRects().length > 0,
      );
      const first = targets[0];
      const last = targets.at(-1);
      if (!first || !last) {
        event.preventDefault();
        heading.current?.focus();
        return;
      }
      event.preventDefault();
      const current = targets.indexOf(document.activeElement as HTMLElement);
      const next =
        current < 0
          ? event.shiftKey
            ? targets.length - 1
            : 0
          : (current + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
      targets[next].focus({ preventScroll: true });
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !node.contains(event.target))
        heading.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      if (!restoreFocus.current) return;
      requestAnimationFrame(() => {
        if (document.querySelector('.system-panel')) return;
        // Reopening an address/search field must not summon a keyboard after dismissal.
        const target = isTextInput(previous)
          ? previous?.closest('.app-window')?.querySelector<HTMLElement>('[data-app-title]')
          : previous;
        if (target?.isConnected && !target.closest('[hidden], [inert]'))
          target.focus({ preventScroll: true });
      });
    };
  }, [kind, previous]);

  const selectApp = (app: RunnableApp) => {
    restoreFocus.current = false;
    onSelectApp(app);
  };
  return (
    <div
      ref={panel}
      className={`system-panel system-panel--${kind}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={`system-${kind}`}
      data-compact={viewport.height < 620 * fontScale}
      data-tiny={viewport.height < 440 * fontScale}
      style={{ height: viewport.height, top: window.visualViewport?.offsetTop ?? 0 }}
    >
      <button
        type="button"
        className="system-panel-backdrop"
        aria-label={`${titles[kind]} 배경 닫기`}
        tabIndex={-1}
        onClick={onDismiss}
      />
      <div className="system-panel-content">
        <header className="system-panel-header">
          <h1 className="system-sr-only" id={titleId} ref={heading} tabIndex={-1}>
            {titles[kind]}
          </h1>
          <button
            type="button"
            className="system-keyboard-control"
            aria-label={`${titles[kind]} 닫기`}
            onClick={onDismiss}
          >
            {titles[kind]} 닫기
          </button>
        </header>
        <div
          className="system-panel-body"
          key={kind}
          onClick={(event) => {
            if (
              (event.target as HTMLElement).matches('.recent-viewport, .recent-track, .recent-apps')
            )
              onDismiss();
          }}
        >
          {kind === 'control' && (
            <ControlCenter
              controls={props.controls}
              onControls={props.onControls}
              preferences={props.preferences}
              onPreferences={props.onPreferences}
              viewport={viewport}
              fontScale={fontScale}
            />
          )}
          {kind === 'switcher' && (
            <RecentApps
              recent={props.recent}
              onSelectApp={selectApp}
              onCloseApp={props.onCloseApp}
              getPreview={props.getPreview}
              viewport={viewport}
            />
          )}
          {kind === 'notifications' && <Notifications />}
          {kind === 'search' && <AppSearch onSelectApp={selectApp} />}
        </div>
        <footer className="system-panel-footer">
          <div
            className="system-dismiss-gesture"
            data-testid="system-dismiss-gesture"
            aria-hidden="true"
            style={{ transform: `translateY(${Math.max(swipe.offset.y * 0.2, -36)}px)` }}
            {...swipe.handlers}
          >
            <HomeIndicator />
          </div>
        </footer>
      </div>
    </div>
  );
}
