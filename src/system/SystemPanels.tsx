import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { AppIcon } from '../home/AppIcon';
import { useDisplayDate } from '../display/useDisplayDate';
import { setAirplaneMode, type DevicePreferences } from '../settings/preferences';
import type { RunnableApp } from '../shell/session';
import { AppSnapshot } from './AppSnapshot';
import { SystemIcon, type SystemIconName } from './SystemIcon';
import { usePanelSwipe } from './usePanelSwipe';
import './system-panels.css';

export type SystemPanelKind = 'control' | 'switcher' | 'notifications' | 'search';
export interface SystemPanelsProps {
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

function PageButtons({
  index,
  count,
  onChange,
  label,
}: {
  index: number;
  count: number;
  onChange: (index: number) => void;
  label: string;
}) {
  if (count < 2) return null;
  return (
    <nav className="system-pages" aria-label={`${label} 페이지`} data-no-swipe>
      <button
        type="button"
        aria-label={`이전 ${label} 페이지`}
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
      >
        <SystemIcon name="left" />
      </button>
      <span className="system-page-dots">
        {Array.from({ length: count }, (_, page) => (
          <button
            key={page}
            type="button"
            aria-label={`${label} ${page + 1}페이지`}
            aria-current={page === index ? 'page' : undefined}
            onClick={() => onChange(page)}
          >
            <i />
          </button>
        ))}
      </span>
      <button
        type="button"
        aria-label={`다음 ${label} 페이지`}
        disabled={index === count - 1}
        onClick={() => onChange(index + 1)}
      >
        <SystemIcon name="right" />
      </button>
    </nav>
  );
}

function HorizontalPages({ pages, label }: { pages: ReactNode[]; label: string }) {
  const [requestedIndex, setIndex] = useState(0);
  const index = Math.min(requestedIndex, pages.length - 1);
  const move = (next: number) => setIndex(Math.max(0, Math.min(pages.length - 1, next)));
  const swipe = usePanelSwipe({ horizontal: (direction) => move(index + direction) });
  return (
    <div className="system-pager">
      <div
        className="system-pages-viewport"
        {...swipe.handlers}
        onKeyDown={(event) => {
          if (isTextInput(event.target as Element)) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            move(index + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
      >
        <div
          className="system-pages-track"
          data-dragging={swipe.offset.x !== 0}
          style={{ transform: `translateX(calc(${-index * 100}% + ${swipe.offset.x * 0.45}px))` }}
        >
          {pages.map((page, position) => (
            <div
              key={position}
              className="system-slide"
              inert={position !== index}
              aria-hidden={position !== index}
            >
              {page}
            </div>
          ))}
        </div>
      </div>
      <PageButtons index={index} count={pages.length} onChange={move} label={label} />
    </div>
  );
}

function ControlCenter({
  preferences,
  onPreferences,
  viewport,
  fontScale,
}: Pick<SystemPanelsProps, 'preferences' | 'onPreferences' | 'viewport'> & { fontScale: number }) {
  const dark =
    preferences.theme === 'dark' ||
    (preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const controls: {
    icon: SystemIconName;
    label: string;
    checked: boolean;
    disabled?: boolean;
    change: () => void;
  }[] = [
    {
      icon: 'airplane',
      label: '에어플레인 모드',
      checked: preferences.airplane,
      change: () => onPreferences(setAirplaneMode(preferences, !preferences.airplane)),
    },
    {
      icon: 'wifi',
      label: 'Wi-Fi',
      checked: preferences.wifi,
      change: () => onPreferences({ ...preferences, wifi: !preferences.wifi }),
    },
    {
      icon: 'cellular',
      label: '셀룰러 데이터',
      checked: !preferences.airplane && preferences.cellular,
      disabled: preferences.airplane,
      change: () => onPreferences({ ...preferences, cellular: !preferences.cellular }),
    },
    {
      icon: 'bluetooth',
      label: 'Bluetooth',
      checked: preferences.bluetooth,
      change: () => onPreferences({ ...preferences, bluetooth: !preferences.bluetooth }),
    },
  ];
  const tiles = controls.map((control) => (
    <button
      key={control.icon}
      type="button"
      role="switch"
      aria-label={control.label}
      aria-checked={control.checked}
      disabled={control.disabled}
      className={`control-tile control-tile--${control.icon}`}
      onClick={control.change}
    >
      <span className="control-symbol">
        <SystemIcon name={control.icon} />
      </span>
      <span className="control-label">{control.label}</span>
      <span className="control-state">
        {control.disabled ? '비행기 모드' : control.checked ? '켬' : '끔'}
      </span>
    </button>
  ));
  const brightness = (
    <div className="control-brightness" key="brightness" data-no-swipe>
      <label htmlFor="system-brightness">
        <SystemIcon name="sun" />
        <span>밝기</span>
        <output>{preferences.brightness}%</output>
      </label>
      <input
        id="system-brightness"
        aria-label="화면 밝기"
        type="range"
        min={50}
        max={100}
        step={1}
        value={preferences.brightness}
        onChange={(event) =>
          onPreferences({ ...preferences, brightness: Number(event.target.value) })
        }
      />
    </div>
  );
  const theme = (
    <button
      key="theme"
      type="button"
      role="switch"
      aria-label="다크 모드"
      aria-checked={dark}
      className="control-tile control-tile--dark"
      onClick={() => onPreferences({ ...preferences, theme: dark ? 'light' : 'dark' })}
    >
      <span className="control-symbol">
        <SystemIcon name="dark" />
      </span>
      <span className="control-label">다크 모드</span>
      <span className="control-state">{dark ? '켬' : '끔'}</span>
    </button>
  );
  const scale = fontScale;
  const tiny = viewport.height < 440 * scale;
  const short = viewport.height < 560 * scale;
  const compact = viewport.height < 710 * scale;
  const note = (
    <p className="system-note">
      이 웹 체험의 가상 연결입니다.
      <br />
      Wi-Fi·Bluetooth는 일시 해제가 아닌 켜기·끄기로 동작합니다.
    </p>
  );
  const pages = tiny
    ? [...tiles, brightness, theme].map((tile) => (
        <div className="control-page control-page--single">{tile}</div>
      ))
    : short
      ? [
          <div className="control-page control-page--pair">{tiles.slice(0, 2)}</div>,
          <div className="control-page control-page--pair">{tiles.slice(2, 4)}</div>,
          <div className="control-page control-page--single">{brightness}</div>,
          <div className="control-page control-page--single">{theme}</div>,
        ]
      : compact
        ? [
            <div className="control-page control-page--connections">{tiles}</div>,
            <div className="control-page control-page--display">
              {brightness}
              {theme}
            </div>,
          ]
        : [
            <div className="control-page control-page--all">
              {tiles}
              {brightness}
              {theme}
            </div>,
          ];
  if (short) {
    pages.push(
      <div className="control-connection-note">
        <h2>가상 연결 안내</h2>
        {note}
      </div>,
    );
  }
  return (
    <div className="control-center">
      <HorizontalPages label="제어 센터" pages={pages} />
      {!short && note}
    </div>
  );
}

function RecentApps({
  recent,
  activeApp,
  onSelectApp,
  onCloseApp,
  getPreview,
  viewport,
}: Pick<
  SystemPanelsProps,
  'recent' | 'activeApp' | 'onSelectApp' | 'onCloseApp' | 'getPreview' | 'viewport'
>) {
  const [requestedIndex, setIndex] = useState(0);
  const index = Math.min(requestedIndex, Math.max(0, recent.length - 1));
  const move = (next: number) => setIndex(Math.max(0, Math.min(recent.length - 1, next)));
  const swipe = usePanelSwipe({
    horizontal: (direction) => move(index + direction),
    upward: () => {
      if (recent[index]) onCloseApp(recent[index]);
    },
  });
  if (!recent.length)
    return (
      <div className="system-empty">
        <SystemIcon name="cards" />
        <h2>열린 앱이 없어요</h2>
        <p>홈에서 앱을 열면 여기에 표시됩니다.</p>
      </div>
    );
  return (
    <div className="recent-apps">
      <div
        className="recent-viewport"
        {...swipe.handlers}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            move(index + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
      >
        <div
          className="recent-track"
          data-dragging={swipe.offset.x !== 0}
          style={
            {
              '--recent-index': index,
              '--recent-drag': `${swipe.offset.x * 0.6}px`,
            } as CSSProperties
          }
        >
          {recent.map((application, position) => (
            <article
              key={application}
              className="recent-card"
              inert={position !== index}
              aria-hidden={position !== index}
              data-active={position === index}
              data-dragging={position === index && swipe.offset.y !== 0}
              style={{
                transform: position === index ? `translateY(${swipe.offset.y}px)` : undefined,
                opacity: position === index ? Math.max(0.3, 1 + swipe.offset.y / 420) : 0.65,
              }}
            >
              <header className="recent-card-title">
                <AppIcon id={application} day="" weekday="" />
                <span>
                  {appNames[application]}
                  {activeApp === application && <small>사용 중</small>}
                </span>
                <button
                  type="button"
                  data-no-swipe
                  aria-label={`${appNames[application]} 앱 닫기`}
                  onClick={() => onCloseApp(application)}
                >
                  <SystemIcon name="close" />
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
      <p className="system-note">앱을 누르면 열리고, 위로 밀면 닫힙니다.</p>
      <PageButtons index={index} count={recent.length} onChange={move} label="최근 앱" />
    </div>
  );
}

function Notifications({ paged }: { paged: boolean }) {
  const date = useDisplayDate();
  const clock = (
    <div className="notification-date">
      <time dateTime={date.isoDate}>{date.label}</time>
      <span aria-label={date.accessibleTime}>{date.clock}</span>
    </div>
  );
  const empty = (
    <div className="system-empty">
      <SystemIcon name="bell" />
      <h2>알림이 없어요</h2>
      <p>현재 이 웹 체험에서 받은 알림이 없습니다.</p>
    </div>
  );
  return (
    <div className="notification-center">
      {paged ? (
        <HorizontalPages label="알림 센터" pages={[clock, empty]} />
      ) : (
        <>
          {clock}
          {empty}
        </>
      )}
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
          placeholder="앱 검색"
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
              <SystemIcon name="right" />
            </button>
          ))
        ) : (
          <p className="system-note" role="status">
            일치하는 앱이 없어요.
          </p>
        )}
      </div>
      <p className="system-note">설정과 Safari를 검색할 수 있어요.</p>
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
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
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
          <h1 id={titleId} ref={heading} tabIndex={-1}>
            {titles[kind]}
          </h1>
          <button
            type="button"
            className="system-close"
            aria-label={`${titles[kind]} 닫기`}
            onClick={onDismiss}
          >
            <SystemIcon name="close" />
          </button>
        </header>
        <div
          className="system-panel-body"
          key={kind}
          onClick={(event) => {
            if (
              (event.target as HTMLElement).matches(
                '.control-page, .recent-viewport, .system-pages-viewport',
              )
            )
              onDismiss();
          }}
        >
          {kind === 'control' && (
            <ControlCenter
              preferences={props.preferences}
              onPreferences={props.onPreferences}
              viewport={viewport}
              fontScale={fontScale}
            />
          )}
          {kind === 'switcher' && (
            <RecentApps
              recent={props.recent}
              activeApp={props.activeApp}
              onSelectApp={selectApp}
              onCloseApp={props.onCloseApp}
              getPreview={props.getPreview}
              viewport={viewport}
            />
          )}
          {kind === 'notifications' && <Notifications paged={viewport.height / fontScale < 330} />}
          {kind === 'search' && <AppSearch onSelectApp={selectApp} />}
        </div>
        <footer className="system-panel-footer">
          <div
            className="system-dismiss-gesture"
            data-testid="system-dismiss-gesture"
            aria-hidden="true"
            {...swipe.handlers}
          >
            <SystemIcon name="up" />
            <span>위로 밀어 닫기</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
