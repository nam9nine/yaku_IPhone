import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useDisplayDate } from '../display/useDisplayDate';
import { AppIcon } from './AppIcon';
import { dockApps, homePages, type HomeApp } from './apps';
import { isHorizontalGesture, pageAfterGesture, type PageGesture } from './pageGesture';
import './home.css';
import type { LaunchRect, RunnableApp } from '../shell/session';

export function HomeScreen({
  onLock,
  onOpenApp,
}: {
  onLock: () => void;
  onOpenApp?: (app: RunnableApp, origin: LaunchRect) => void;
}) {
  const date = useDisplayDate();
  const day = String(Number(date.isoDate.slice(-2)));
  const weekday = date.label.split(' ').at(-1) ?? '';
  const [page, setPage] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const gesture = useRef<PageGesture | null>(null);
  const suppressClick = useRef(false);
  const pagesRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (pagesRef.current) pagesRef.current.scrollTop = 0;
  }, [page]);

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
    window.addEventListener('blur', cancelGesture);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', cancelGesture);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  function moveGesture(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX - current.startX;
    current.y = event.clientY - current.startY;
    if (Math.hypot(current.x, current.y) > 8) suppressClick.current = true;
    if (!isHorizontalGesture(current)) {
      setDragX(0);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const atEdge =
      (page === 0 && current.x > 0) || (page === homePages.length - 1 && current.x < 0);
    setDragX(current.x * (atEdge ? 0.25 : 1));
  }

  function finishGesture(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX - current.startX;
    current.y = event.clientY - current.startY;
    if (Math.hypot(current.x, current.y) > 8) suppressClick.current = true;
    gesture.current = null;
    setPage(
      pageAfterGesture(page, homePages.length, current, event.currentTarget.clientWidth, cancelled),
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
            setPage((current) =>
              Math.max(
                0,
                Math.min(homePages.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)),
              ),
            );
          }
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || gesture.current) return;
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
          {homePages.map((apps, index) => (
            <div
              key={index}
              className="home-page"
              aria-label={`${index + 1}페이지`}
              aria-hidden={index !== page}
              inert={index !== page}
            >
              {index === 0 && (
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
        <nav className="home-page-control" aria-label="홈 화면 페이지">
          {homePages.map((_, index) => (
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
          ))}
        </nav>
        <span className="home-sr-only" aria-live="polite">
          {page + 1} / {homePages.length}페이지
        </span>
        <button className="home-lock-button" aria-label="다시 잠그기" tabIndex={0} onClick={onLock}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="10" width="12" height="10" rx="3" fill="currentColor" />
            <path
              d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
          </svg>
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
