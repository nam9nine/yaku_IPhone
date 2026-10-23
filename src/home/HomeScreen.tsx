import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useDisplayDate } from '../display/useDisplayDate';
import { AppIcon } from './AppIcon';
import { dockApps, type HomeApp } from './apps';
import { isHorizontalGesture, pageAfterGesture, type PageGesture } from './pageGesture';
import './home.css';
import { homeLayout } from './homeLayout';
import type { LaunchRect, RunnableApp } from '../shell/session';

export function HomeScreen({
  onLock,
  active = true,
  onOpenApp,
  onSearch,
  onControl,
  onSwitcher,
}: {
  onLock: () => void;
  active?: boolean;
  onSearch: () => void;
  onControl: () => void;
  onSwitcher: () => void;
  onOpenApp?: (app: RunnableApp, origin: LaunchRect) => void;
}) {
  const date = useDisplayDate();
  const day = String(Number(date.isoDate.slice(-2)));
  const weekday = date.label.split(' ').at(-1) ?? '';
  const [selectedPage, setPage] = useState(0);
  const [measure, setMeasure] = useState({ height: 0, row: 0, widget: 0 });
  const pages = homeLayout(measure.height, measure.row, measure.widget);
  const page = Math.min(selectedPage, pages.length - 1);
  const [dragX, setDragX] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setDragX(0);
  }
  const [notice, setNotice] = useState<string | null>(null);
  const gesture = useRef<PageGesture | null>(null);
  const suppressClick = useRef(false);
  const pagesRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (active) return;
    const current = gesture.current;
    gesture.current = null;
    suppressClick.current = true;
    if (current && pagesRef.current?.hasPointerCapture(current.pointerId))
      pagesRef.current.releasePointerCapture(current.pointerId);
  }, [active]);

  useLayoutEffect(() => {
    const element = pagesRef.current;
    if (!element) return;
    const measureLayout = () => {
      if (element.closest('[hidden]')) return;
      // Pagination uses layout dimensions, unaffected by the home entrance transform.
      const row = Math.max(
        ...[...element.querySelectorAll<HTMLElement>('.home-app')].map((el) => el.offsetHeight),
        0,
      );
      const widget =
        element.querySelector<HTMLElement>('.home-widgets')?.offsetHeight ?? measure.widget;
      const height = element.clientHeight;
      if (!height || !row) return;
      setMeasure((current) =>
        current.height === height && current.row === row && current.widget === widget
          ? current
          : { height, row, widget },
      );
    };
    const observer = new ResizeObserver(measureLayout);
    observer.observe(element);
    element.querySelectorAll('.home-app,.home-widgets').forEach((el) => observer.observe(el));
    measureLayout();
    return () => observer.disconnect();
  }, [pages.length, measure.widget]);

  useEffect(() => {
    const cancelGesture = () => {
      const current = gesture.current;
      if (!current) return;
      gesture.current = null;
      suppressClick.current = true;
      setDragX(0);
      if (pagesRef.current?.hasPointerCapture(current.pointerId)) {
        pagesRef.current.releasePointerCapture(current.pointerId);
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) cancelGesture();
    };
    const second = (event: globalThis.PointerEvent) => {
      if (gesture.current && gesture.current.pointerId !== event.pointerId) cancelGesture();
    };
    window.addEventListener('pointerdown', second, true);
    window.addEventListener('resize', cancelGesture);
    window.addEventListener('blur', cancelGesture);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointerdown', second, true);
      window.removeEventListener('resize', cancelGesture);
      window.removeEventListener('blur', cancelGesture);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  function moveGesture(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!active || !current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX - current.startX;
    current.y = event.clientY - current.startY;
    if (Math.hypot(current.x, current.y) > 8) suppressClick.current = true;
    if (!isHorizontalGesture(current)) {
      setDragX(0);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const atEdge = (page === 0 && current.x > 0) || (page === pages.length - 1 && current.x < 0);
    setDragX(current.x * (atEdge ? 0.25 : 1));
  }

  function finishGesture(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!active || !current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX - current.startX;
    current.y = event.clientY - current.startY;
    if (Math.hypot(current.x, current.y) > 8) suppressClick.current = true;
    gesture.current = null;
    if (!cancelled && current.y >= 80 && Math.abs(current.x) < current.y * 0.5) {
      setDragX(0);
      onSearch();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    setPage(
      pageAfterGesture(page, pages.length, current, event.currentTarget.clientWidth, cancelled),
    );
    setDragX(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function openApp(app: HomeApp, button: HTMLButtonElement) {
    if (onOpenApp && (app.id === 'settings' || app.id === 'safari')) {
      const bounds =
        button.querySelector('.app-icon')?.getBoundingClientRect() ??
        button.getBoundingClientRect();
      onOpenApp(app.id, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
      return;
    }
    setNotice(`${app.name} 앱은 곧 만나요`);
  }

  function appButton(app: HomeApp, inDock = false) {
    return (
      <button
        key={app.id}
        className={`home-app${inDock ? ' home-app--dock' : ''}`}
        aria-label={app.name}
        tabIndex={0}
        data-launch-app={app.id}
        onClick={(event) => openApp(app, event.currentTarget)}
      >
        <AppIcon id={app.id} day={day} weekday={weekday.replace('요일', '')} />
        {!inDock && <span className="home-app-label">{app.name}</span>}
      </button>
    );
  }

  return (
    <section className="home-screen screen-enter" aria-label="홈 화면" data-testid="home-screen">
      <h1 className="home-sr-only" ref={titleRef} tabIndex={-1} data-home-title>
        홈 화면
      </h1>
      <button
        className="home-sr-only system-keyboard-control"
        tabIndex={0}
        aria-label="홈 앱 검색"
        onClick={onSearch}
      >
        검색
      </button>
      <div
        className="home-pages"
        ref={pagesRef}
        data-testid="home-pages"
        data-page={page + 1}
        data-dragging={dragX !== 0}
        role="region"
        aria-label="앱 페이지, 좌우 화살표로 이동"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setPage(
              Math.max(0, Math.min(pages.length - 1, page + (event.key === 'ArrowRight' ? 1 : -1))),
            );
          }
        }}
        onPointerDown={(event) => {
          if (!active || !event.isPrimary || event.button !== 0 || gesture.current) return;
          suppressClick.current = false;
          gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: 0,
            y: 0,
          };
        }}
        onPointerMove={moveGesture}
        onPointerUp={(event) => finishGesture(event)}
        onPointerCancel={(event) => finishGesture(event, true)}
        onLostPointerCapture={(event) => {
          // Moving implicit touch capture from a child icon is not a cancelled page drag.
          if (event.target === event.currentTarget) finishGesture(event, true);
        }}
        onPointerLeave={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) finishGesture(event, true);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
          }
          suppressClick.current = false;
        }}
      >
        <div
          className="home-page-track"
          style={{ transform: `translateX(calc(${-page * 100}% + ${dragX}px))` }}
        >
          {pages.map(({ apps, widgets }, index) => (
            <div
              key={index}
              className="home-page"
              aria-label={`${index + 1}페이지`}
              aria-hidden={index !== page}
              inert={index !== page}
            >
              {widgets && (
                <div className="home-widgets">
                  <button
                    className="home-widget-button"
                    aria-label="사진 위젯"
                    tabIndex={0}
                    onClick={() => setNotice('사진 앱은 곧 만나요')}
                  >
                    <span className="home-widget home-photo-widget">
                      <img
                        src={`${import.meta.env.BASE_URL}widgets/mountain.png`}
                        alt="햇빛이 비치는 바위 능선과 멀리 펼쳐진 산"
                        width="1254"
                        height="1254"
                        draggable="false"
                      />
                    </span>
                    <span className="home-app-label">사진</span>
                  </button>
                  <button
                    className="home-widget-button"
                    aria-label={`캘린더 위젯, ${date.label}, 일정 없음`}
                    tabIndex={0}
                    onClick={() => setNotice('캘린더 앱은 곧 만나요')}
                  >
                    <span className="home-widget home-calendar-widget" aria-hidden="true">
                      <span className="home-calendar-weekday">{weekday}</span>
                      <span className="home-calendar-day">{day}</span>
                      <span className="home-calendar-empty">오늘은 일정이 없어요</span>
                    </span>
                    <span className="home-app-label">캘린더</span>
                  </button>
                </div>
              )}
              <div className="home-app-grid">{apps.map((app) => appButton(app))}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="home-bottom-controls">
        <button className="system-keyboard-control" onClick={onControl}>
          제어 센터 열기
        </button>
        <button className="system-keyboard-control" onClick={onSwitcher}>
          최근 앱 열기
        </button>
        <nav className="home-page-control" aria-label="홈 화면 페이지">
          {pages.length <= 3 ? (
            pages.map((_, index) => (
              <button
                key={index}
                type="button"
                tabIndex={0}
                aria-label={`${index + 1}페이지로 이동`}
                aria-current={index === page ? 'page' : undefined}
                onClick={() => setPage(index)}
              >
                <span aria-hidden="true" />
              </button>
            ))
          ) : (
            <>
              <button
                tabIndex={0}
                aria-label="이전 홈 페이지"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                ‹
              </button>
              <span className="home-page-count">
                {page + 1}/{pages.length}
              </span>
              <button
                tabIndex={0}
                aria-label="다음 홈 페이지"
                disabled={page === pages.length - 1}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
            </>
          )}
        </nav>
        <span className="home-sr-only" aria-live="polite">
          {page + 1} / {pages.length}페이지
        </span>
        <button className="system-keyboard-control" onClick={onLock}>
          다시 잠그기
        </button>
      </div>

      <nav className="home-dock" aria-label="Dock">
        {dockApps.map((app) => appButton(app, true))}
      </nav>

      {notice && (
        <div className="home-notice">
          <p role="status">{notice}</p>
          <button aria-label="앱 안내 닫기" tabIndex={0} onClick={() => setNotice(null)}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </section>
  );
}
