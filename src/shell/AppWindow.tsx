import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { homeDrag, type HomeGesture } from './homeGesture';
import type { LaunchRect, RunnableApp } from './session';
import './shell.css';

interface Props {
  app: RunnableApp;
  active: boolean;
  origin: LaunchRect | null;
  onHome: () => void;
  children: ReactNode;
}

export function AppWindow({ app, active, origin, onHome, children }: Props) {
  const card = useRef<HTMLElement>(null);
  const gestureZone = useRef<HTMLDivElement>(null);
  const gesture = useRef<HomeGesture | null>(null);
  const animation = useRef<Animation | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);
  const [drag, setDrag] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight,
  }));
  const homeCallback = useRef(onHome);
  useEffect(() => {
    homeCallback.current = onHome;
  }, [onHome]);

  function cancelGesture() {
    const current = gesture.current;
    gesture.current = null;
    setDrag(0);
    if (current && gestureZone.current?.hasPointerCapture(current.pointerId)) {
      gestureZone.current.releasePointerCapture(current.pointerId);
    }
  }

  useEffect(() => {
    const resize = () => {
      cancelGesture();
      setViewport({
        top: window.visualViewport?.offsetTop ?? 0,
        height: window.visualViewport?.height ?? window.innerHeight,
      });
    };
    const hidden = () => {
      if (document.hidden) cancelGesture();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('blur', cancelGesture);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', cancelGesture);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  useEffect(() => {
    if (!active || !card.current) return;
    const node = card.current;
    closing.current = false;
    const bounds = node.getBoundingClientRect();
    const motion = getComputedStyle(node).getPropertyValue('--motion-settle').trim();
    if (origin && motion !== '0ms' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation.current = node.animate(
        [
          {
            transform: `translate(${origin.x - bounds.x}px, ${origin.y - bounds.y}px) scale(${origin.width / bounds.width}, ${origin.height / bounds.height})`,
            borderRadius: '28px',
            opacity: 0.4,
          },
          { transform: 'none', borderRadius: '0px', opacity: 1 },
        ],
        { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
    node.querySelector<HTMLElement>('[data-app-title]')?.focus({ preventScroll: true });
    return () => {
      animation.current?.cancel();
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [active, origin]);

  function returnHome() {
    if (!active || closing.current || !card.current) return;
    closing.current = true;
    cancelGesture();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    animation.current?.cancel();
    const node = card.current;
    const bounds = node.getBoundingClientRect();
    const launcher = document.querySelector(`[data-launch-app="${app}"] .app-icon`);
    const destination = launcher?.getBoundingClientRect() ?? origin;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      homeCallback.current();
    };
    const reduced =
      getComputedStyle(node).getPropertyValue('--motion-settle').trim() === '0ms' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!destination || reduced) {
      complete();
      return;
    }
    animation.current = node.animate(
      [
        { transform: 'none', opacity: 1, borderRadius: '0px' },
        {
          transform: `translate(${destination.x - bounds.x}px, ${destination.y - bounds.y}px) scale(${destination.width / bounds.width}, ${destination.height / bounds.height})`,
          opacity: 0,
          borderRadius: '28px',
        },
      ],
      { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' },
    );
    void animation.current.finished.then(complete, complete);
    // Input state must complete even if the browser suspends animation callbacks.
    closeTimer.current = setTimeout(complete, 320);
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const result = homeDrag(current, event.clientX, event.clientY);
    cancelGesture();
    if (!cancelled && !result.cancelled && result.complete) returnHome();
  }

  const keyboardHome = useEffectEvent(() => returnHome());
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === 'Home') {
        event.preventDefault();
        keyboardHome();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active]);

  return (
    <div
      className="app-host"
      hidden={!active}
      inert={!active}
      aria-hidden={!active}
      style={{ top: viewport.top, height: viewport.height }}
    >
      <section
        ref={card}
        className="app-window"
        aria-label={app === 'settings' ? '설정 앱' : 'Safari 앱'}
        data-testid={`${app}-app`}
        data-dragging={drag > 0}
        style={
          drag
            ? {
                transform: `translateY(${-drag * 0.25}px) scale(${1 - drag / 2000})`,
                borderRadius: 24,
              }
            : undefined
        }
      >
        <div className="app-body">{children}</div>
        <footer className="app-home-controls">
          <div
            ref={gestureZone}
            className="app-home-gesture"
            data-testid={`${app}-home-gesture`}
            aria-hidden="true"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0 || gesture.current || closing.current)
                return;
              animation.current?.cancel();
              gesture.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = gesture.current;
              if (!current || current.pointerId !== event.pointerId) return;
              const result = homeDrag(current, event.clientX, event.clientY);
              if (result.cancelled) cancelGesture();
              else setDrag(result.offset);
            }}
            onPointerUp={(event) => finish(event)}
            onPointerCancel={(event) => finish(event, true)}
            onLostPointerCapture={(event) => finish(event, true)}
          >
            <svg viewBox="0 0 20 20">
              <path d="m5 12 5-5 5 5" />
            </svg>
          </div>
          <button className="app-home-button" aria-label="홈으로 돌아가기" onClick={returnHome}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m3 11 9-8 9 8M5.5 9v11h5v-6h3v6h5V9" />
            </svg>
          </button>
        </footer>
      </section>
    </div>
  );
}
