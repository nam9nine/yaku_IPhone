import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { useSystemGesture } from './useSystemGesture';
import { useViewport } from './useViewport';
import { appNames, type LaunchRect, type RunnableApp } from './session';
import './shell.css';
import { HomeIndicator } from '../system/HomeIndicator';

interface Props {
  app: RunnableApp;
  active: boolean;
  interactive?: boolean;
  onSwitcher: () => void;
  onControl: () => void;
  onQuickSwitch: (direction: 'previous' | 'next') => void;
  origin: LaunchRect | null;
  onHome: () => void;
  children: ReactNode;
}

export function AppWindow({
  app,
  active,
  interactive = active,
  origin,
  onHome,
  onSwitcher,
  onControl,
  onQuickSwitch,
  children,
}: Props) {
  const card = useRef<HTMLElement>(null);
  const animation = useRef<Animation | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);
  const generation = useRef(0);
  const bottom = useSystemGesture('bottom', interactive, (result) => {
    if (result === 'home' || result === 'switcher') onSwitcher();
    else if (result === 'previous' || result === 'next') onQuickSwitch(result);
  });
  const drag = bottom.offset;
  const cancelGesture = bottom.cancel;
  const viewport = useViewport();
  const homeCallback = useRef(onHome);
  useEffect(() => {
    homeCallback.current = onHome;
  }, [onHome]);

  const cancelClosing = useEffectEvent(() => {
    if (!closing.current) return;
    generation.current += 1;
    closing.current = false;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    animation.current?.cancel();
  });
  useEffect(() => {
    if (!interactive) cancelClosing();
  }, [interactive]);

  useEffect(() => {
    if (!active || !card.current) return;
    const node = card.current;
    closing.current = false;
    const bounds = node.getBoundingClientRect();
    const motion = getComputedStyle(node).getPropertyValue('--motion-settle').trim();
    if (
      origin &&
      parseFloat(motion) !== 0 &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
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
      generation.current += 1;
      closing.current = false;
      animation.current?.cancel();
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [active, origin]);

  function returnHome() {
    if (!interactive || closing.current || !card.current) return;
    closing.current = true;
    cancelGesture();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    animation.current?.cancel();
    const node = card.current;
    const bounds = node.getBoundingClientRect();
    const launcher = document.querySelector(`[data-launch-app="${app}"] .app-icon`);
    const destination = launcher?.getBoundingClientRect() ?? origin;
    const token = ++generation.current;
    let completed = false;
    const complete = () => {
      if (
        completed ||
        token !== generation.current ||
        !node.isConnected ||
        node.closest('[hidden], [inert]')
      )
        return;
      completed = true;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      homeCallback.current();
    };
    const reduced =
      parseFloat(getComputedStyle(node).getPropertyValue('--motion-settle')) === 0 ||
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

  const keyboardHome = useEffectEvent(() => returnHome());
  useEffect(() => {
    if (!interactive) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === 'Home') {
        event.preventDefault();
        keyboardHome();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [interactive]);

  return (
    <div
      className="app-host"
      hidden={!active}
      inert={!interactive}
      aria-hidden={!interactive}
      style={{ top: viewport.top, height: viewport.height }}
    >
      <section
        ref={card}
        className="app-window"
        data-app-window={app}
        aria-label={`${appNames[app]} 앱`}
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
          <button
            tabIndex={0}
            className="system-keyboard-control"
            aria-label="제어 센터 열기"
            onClick={onControl}
          >
            제어 센터 열기
          </button>
          <div
            className="app-home-gesture"
            data-testid={`${app}-home-gesture`}
            aria-hidden="true"
            {...bottom.handlers}
          >
            <HomeIndicator />
          </div>
          <button
            tabIndex={0}
            className="system-keyboard-control"
            aria-label="최근 앱 열기"
            onClick={onSwitcher}
          >
            최근 앱 열기
          </button>
          <button
            tabIndex={0}
            className="system-keyboard-control"
            aria-label="홈으로 돌아가기"
            onClick={returnHome}
          >
            홈으로 돌아가기
          </button>
        </footer>
      </section>
    </div>
  );
}
