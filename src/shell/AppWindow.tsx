import { useEffect, useEffectEvent, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useSystemGesture } from './useSystemGesture';
import { useViewport } from './useViewport';
import { appNames, type LaunchRect, type RunnableApp } from './session';
import './shell.css';
import { draggedRect, dragMotion, motion, rectFrames, rectOf, reducedMotion } from './motion';
import { upwardVelocity, type SystemGesture } from './systemGesture';
import { AppSnapshot } from '../system/AppSnapshot';
import { AppIcon } from '../home/AppIcon';
import type { CSSProperties } from 'react';

const previewFor = (app: RunnableApp) =>
  document.querySelector<HTMLElement>(`[data-app-window="${app}"]`);

interface Props {
  app: RunnableApp;
  active: boolean;
  interactive?: boolean;
  onSwitcher: (entry?: LaunchRect) => void;
  parked?: boolean;
  previousApp?: RunnableApp;
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
  parked = false,
  previousApp,
  children,
}: Props) {
  const card = useRef<HTMLElement>(null);
  const animation = useRef<Animation | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);
  const generation = useRef(0);
  const hasPresented = useRef(false);
  const bottom = useSystemGesture('bottom', interactive, (result, gesture) => {
    if (result === 'home') returnHome(gesture);
    else if (result === 'switcher') onSwitcher(card.current ? rectOf(card.current) : undefined);
    else if (result === 'previous' || result === 'next') onQuickSwitch(result);
  });
  const drag = bottom.offset;
  const cancelGesture = bottom.cancel;
  const viewport = useViewport();
  const width = Math.min(478, viewport.width);
  const pose = draggedRect({ x: 0, y: 0, width, height: viewport.height }, drag);
  const returnProgress = Math.max(0, Math.min(1, (drag / viewport.height - 0.4) / 0.35));
  const stageOpacity = Math.min(1, drag / dragMotion.stage) * (1 - returnProgress);
  const previewOpacity =
    Math.max(0, Math.min(1, (drag - dragMotion.previewStart) / dragMotion.previewDistance)) *
    (1 - returnProgress);
  const homeCallback = useRef(onHome);
  useEffect(() => {
    homeCallback.current = onHome;
  }, [onHome]);

  useLayoutEffect(() => {
    if (!active) return;
    const shell = card.current?.closest<HTMLElement>('.mobile-shell');
    // Blur the real home layers. Nested backdrop-filter loses the backdrop in WebKit.
    shell?.style.setProperty(
      '--gesture-blur',
      stageOpacity ? `blur(${stageOpacity * 20}px)` : 'none',
    );
    return () => {
      shell?.style.removeProperty('--gesture-blur');
    };
  }, [active, stageOpacity]);

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

  useLayoutEffect(() => {
    if (!active || !card.current) return;
    const node = card.current;
    closing.current = false;
    const bounds = baseRect(node);
    if (origin && !reducedMotion(node)) {
      animation.current = node.animate(rectFrames(origin, bounds, bounds, [28, 0]), {
        duration: motion.settle,
        easing: 'linear',
      });
    } else if (!hasPresented.current && !reducedMotion(node)) {
      animation.current = node.animate(
        [
          { transform: 'translateY(18px) scale(0.98)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: motion.settle, easing: 'ease-out' },
      );
    }
    hasPresented.current = true;
    node.querySelector<HTMLElement>('[data-app-title]')?.focus({ preventScroll: true });
    return () => {
      generation.current += 1;
      closing.current = false;
      animation.current?.cancel();
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [active, origin]);

  function baseRect(node: HTMLElement): LaunchRect {
    const host = node.parentElement!.getBoundingClientRect();
    return {
      x: host.x + node.offsetLeft,
      y: host.y + node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
  }

  function returnHome(gesture?: SystemGesture) {
    if (!interactive || closing.current || !card.current) return;
    closing.current = true;
    const node = card.current;
    const presented = rectOf(node);
    const radius = parseFloat(getComputedStyle(node).borderRadius) || 0;
    cancelGesture();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    animation.current?.cancel();
    const bounds = baseRect(node);
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
    if (!destination || reducedMotion(node)) {
      complete();
      return;
    }
    const velocity = gesture ? upwardVelocity(gesture, gesture.samples.at(-1)!.time) : 0;
    const duration = motion.home - Math.min(80, velocity * 30);
    animation.current = node.animate(
      rectFrames(presented, destination, bounds, [radius, 28], true),
      {
        duration,
        easing: 'linear',
        fill: 'forwards',
      },
    );
    void animation.current.finished.then(complete, () => {});
    closeTimer.current = setTimeout(complete, duration + 80);
  }

  const keyboardHome = useEffectEvent(() => returnHome());
  useEffect(() => {
    if (!interactive) return;
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('.day-call[open]')) return;
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
      data-parked={parked}
      inert={!interactive}
      aria-hidden={!interactive}
      style={{
        top: viewport.top,
        left: viewport.left,
        right: 'auto',
        width: viewport.width,
        height: viewport.height,
      }}
    >
      {active && (drag > 0 || closing.current) && (
        <div className="gesture-stage" aria-hidden="true" inert style={{ width }}>
          <div className="gesture-stage-backdrop" style={{ opacity: stageOpacity }} />
          {previousApp && previewOpacity > 0 && (
            <article
              className="recent-card gesture-previous-card"
              style={
                {
                  '--card-offset': -1,
                  '--card-drag-x': '0px',
                  '--card-drag-y': '0px',
                  '--card-scale': 0.94,
                  opacity: previewOpacity,
                } as CSSProperties
              }
            >
              <header className="recent-card-title">
                <AppIcon id={previousApp} day="" weekday="" />
                <span>{appNames[previousApp]}</span>
              </header>
              <div className="recent-open">
                <AppSnapshot app={previousApp} getPreview={previewFor} viewport={viewport} />
              </div>
            </article>
          )}
          <header
            className="recent-card-title gesture-current-title"
            style={{
              left: pose.x + 7,
              top: Math.max(4, pose.y - 38),
              opacity: previewOpacity * Math.min(1, Math.max(0, (pose.y - 12) / 30)),
            }}
          >
            <AppIcon id={app} day="" weekday="" />
            <span>{appNames[app]}</span>
          </header>
        </div>
      )}
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
                transform: `translate(${pose.x}px, ${pose.y}px) scale(${pose.width / width})`,
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
          />
          <button
            tabIndex={0}
            className="system-keyboard-control"
            aria-label="최근 앱 열기"
            onClick={() => onSwitcher(card.current ? rectOf(card.current) : undefined)}
          >
            최근 앱 열기
          </button>
          <button
            tabIndex={0}
            className="system-keyboard-control"
            aria-label="홈으로 돌아가기"
            onClick={() => returnHome()}
          >
            홈으로 돌아가기
          </button>
        </footer>
      </section>
    </div>
  );
}
