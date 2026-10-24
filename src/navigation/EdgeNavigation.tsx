import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { edgeDirection, type HorizontalDirection } from './horizontalGesture';
import { useHorizontalGesture } from './useHorizontalGesture';
import './navigation.css';

function viewportSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    visualWidth: window.visualViewport?.width ?? null,
    visualHeight: window.visualViewport?.height ?? null,
  };
}

interface EdgeMotion {
  node: HTMLElement;
  width: number;
  viewport: ReturnType<typeof viewportSize>;
  offset: number;
  targets: { node: HTMLElement; translate: string; opacity: string }[];
  animations: Animation[];
  timer: ReturnType<typeof setTimeout> | null;
  phase: 'dragging' | 'returning' | 'leaving' | 'arriving';
}

export function useEdgeNavigation({
  active,
  onBack,
  onForward,
}: {
  active: boolean;
  onBack?: () => void;
  onForward?: () => void;
}) {
  const motion = useRef<EdgeMotion | null>(null);
  const generation = useRef(0);
  const latest = useRef({ active, onBack, onForward });
  useLayoutEffect(() => {
    latest.current = { active, onBack, onForward };
    if (!active) reset();
  });

  function reset() {
    generation.current += 1;
    const current = motion.current;
    motion.current = null;
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    restore(current);
    delete current.node.dataset.edgeMotion;
  }

  function collect(node: HTMLElement) {
    return Array.from(node.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .map((child) => ({
        node: child,
        translate: child.style.translate,
        opacity: child.style.opacity,
      }));
  }

  function restore(current: EdgeMotion) {
    current.animations.forEach((animation) => animation.cancel());
    current.animations = [];
    for (const target of current.targets) {
      target.node.style.translate = target.translate;
      target.node.style.opacity = target.opacity;
    }
  }

  function reduced(node: HTMLElement) {
    return (
      !!node.closest('[data-reduced-motion="true"]') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function viewportUnchanged(current: EdgeMotion) {
    const viewport = viewportSize();
    return (
      current.viewport.width === viewport.width &&
      current.viewport.height === viewport.height &&
      current.viewport.visualWidth === viewport.visualWidth &&
      current.viewport.visualHeight === viewport.visualHeight
    );
  }

  function settle(current: EdgeMotion, frames: Keyframe[], duration: number, complete: () => void) {
    const token = ++generation.current;
    let finished = false;
    const finish = () => {
      if (finished || token !== generation.current || motion.current !== current) return;
      // Geometry can change before the browser delivers its resize event. A
      // stale animation or fallback timer must not commit that gesture's history.
      if (!viewportUnchanged(current)) {
        reset();
        return;
      }
      finished = true;
      if (current.timer) clearTimeout(current.timer);
      complete();
    };
    current.animations.forEach((animation) => animation.cancel());
    current.animations = current.targets.map(({ node }) =>
      node.animate(frames, {
        duration,
        easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)',
        fill: 'forwards',
      }),
    );
    void Promise.all(current.animations.map((animation) => animation.finished)).then(
      finish,
      () => undefined,
    );
    current.timer = setTimeout(finish, duration + 80);
  }

  function navigate(direction: HorizontalDirection) {
    if (!latest.current.active) return;
    if (direction === 'previous') latest.current.onBack?.();
    else latest.current.onForward?.();
  }

  function cancel(immediate: boolean) {
    const current = motion.current;
    if (!current) return;
    if (immediate || !current.offset || reduced(current.node)) {
      reset();
      return;
    }
    current.phase = 'returning';
    current.node.dataset.edgeMotion = 'returning';
    settle(current, [{ translate: `${current.offset}px 0` }, { translate: '0px 0' }], 190, reset);
  }

  const stop = useEffectEvent(() => reset());
  useEffect(() => {
    const homeGestureStarted = (event: PointerEvent) => {
      const current = motion.current;
      if (!current || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element))
        return;
      const app = current.node.closest('[data-app-window]');
      const gesture = event.target.closest('.app-home-gesture');
      if (app && gesture?.closest('[data-app-window]') === app) {
        // The shell remains active during its home animation. Cancel the pending
        // page pop at gesture start, without claiming or interrupting its pointer.
        stop();
      }
    };
    const keydown = (event: KeyboardEvent) => {
      const current = motion.current;
      if (!current) return;
      if (event.altKey && event.key === 'Home') {
        // Let the existing shell home shortcut run, after cancelling any pending pop.
        stop();
      } else if (
        current.phase === 'leaving' &&
        (event.key === 'Escape' ||
          (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')))
      ) {
        // Do not let an Escape or another shortcut pop history a second time mid-settle.
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        stop();
      }
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged = () => stop();
    media.addEventListener('change', preferenceChanged);
    window.addEventListener('pointerdown', homeGestureStarted, true);
    window.addEventListener('keydown', keydown, true);
    return () => {
      stop();
      window.removeEventListener('pointerdown', homeGestureStarted, true);
      window.removeEventListener('keydown', keydown, true);
      media.removeEventListener('change', preferenceChanged);
    };
  }, []);

  return useHorizontalGesture({
    active,
    start(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      return edgeDirection(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        !!onBack,
        !!onForward,
      );
    },
    commit() {
      // Edge navigation commits through the guarded animation completion below.
    },
    feedback: {
      blocked: () => motion.current?.phase === 'leaving',
      begin(node) {
        reset();
        motion.current = {
          node,
          width: node.clientWidth,
          viewport: viewportSize(),
          offset: 0,
          targets: collect(node),
          animations: [],
          timer: null,
          phase: 'dragging',
        };
      },
      move(offset) {
        const current = motion.current;
        if (!current || reduced(current.node)) return;
        current.offset = Math.max(-current.width, Math.min(current.width, offset));
        current.node.dataset.edgeMotion = 'dragging';
        for (const target of current.targets) target.node.style.translate = `${current.offset}px 0`;
      },
      release(direction) {
        const current = motion.current;
        if (!current) return;
        // Also cover visual-viewport changes before an immediate reduced-motion
        // transition, where no animation completion will recheck the geometry.
        if (!viewportUnchanged(current)) {
          reset();
          return;
        }
        if (!direction) {
          cancel(false);
          return;
        }
        if (reduced(current.node)) {
          reset();
          navigate(direction);
          return;
        }
        const sign = direction === 'previous' ? 1 : -1;
        current.phase = 'leaving';
        current.node.dataset.edgeMotion = 'leaving';
        settle(
          current,
          [
            { translate: `${current.offset}px 0`, opacity: 1 },
            { translate: `${sign * current.width}px 0`, opacity: 0.92 },
          ],
          220,
          () => {
            if (!current.node.isConnected || current.node.closest('[hidden], [inert]')) {
              reset();
              return;
            }
            // This is the real destination rendered by the app, never a fabricated
            // previous-page preview. Keep its arrival subtle until shared history
            // supplies an actual underlay for the interactive drag phase.
            restore(current);
            flushSync(() => navigate(direction));
            current.targets = collect(current.node);
            current.phase = 'arriving';
            current.node.dataset.edgeMotion = 'arriving';
            settle(
              current,
              [
                { translate: `${-sign * 12}px 0`, opacity: 0.88 },
                { translate: '0px 0', opacity: 1 },
              ],
              140,
              reset,
            );
          },
        );
      },
      cancel,
    },
  });
}
