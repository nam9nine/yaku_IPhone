import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

type Axis = 'x' | 'y';
interface Drag {
  id: number;
  x: number;
  y: number;
  axis: Axis | null;
  surface: HTMLElement;
  viewport: string;
}
const viewportKey = () =>
  `${window.innerWidth}:${window.innerHeight}:${window.visualViewport?.width}:${window.visualViewport?.height}`;

/** A captured drag never becomes a click; interruption always returns to rest. */
export function usePanelSwipe({
  horizontal,
  upward,
}: {
  horizontal?: (direction: -1 | 1) => void;
  upward?: () => void;
}) {
  const drag = useRef<Drag | null>(null);
  const blockedClick = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  function reset(blockClick = false) {
    const current = drag.current;
    drag.current = null;
    blockedClick.current ||= blockClick;
    setOffset({ x: 0, y: 0 });
    if (current?.surface.hasPointerCapture(current.id)) {
      current.surface.releasePointerCapture(current.id);
    }
  }

  useEffect(() => {
    const cancel = () => reset(!!drag.current);
    const hidden = () => {
      if (document.hidden) cancel();
    };
    const additionalPointer = (event: globalThis.PointerEvent) => {
      if (drag.current && event.pointerId !== drag.current.id) cancel();
    };
    const releasedOutside = (event: globalThis.PointerEvent) => {
      const current = drag.current;
      if (
        current?.id === event.pointerId &&
        event.target instanceof Node &&
        !current.surface.contains(event.target)
      )
        reset(true);
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.visualViewport?.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pointerdown', additionalPointer, true);
    window.addEventListener('pointerup', releasedOutside, true);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.visualViewport?.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pointerdown', additionalPointer, true);
      window.removeEventListener('pointerup', releasedOutside, true);
      const current = drag.current;
      drag.current = null;
      if (current?.surface.hasPointerCapture(current.id)) {
        current.surface.releasePointerCapture(current.id);
      }
    };
  }, []);

  return {
    offset,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!event.isPrimary || event.button !== 0 || drag.current) {
          reset(true);
          return;
        }
        blockedClick.current = false;
        if ((event.target as HTMLElement).closest('input, textarea, [data-no-swipe]')) return;
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          axis: null,
          surface: event.currentTarget,
          viewport: viewportKey(),
        };
        // A dedicated handle must keep a release that leaves its narrow bounds.
        // Buttons defer capture so an ordinary card tap retains its click target.
        if (!(event.target as HTMLElement).closest('button, a')) {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        if (current.viewport !== viewportKey()) {
          reset(true);
          return;
        }
        const x = event.clientX - current.x;
        const y = event.clientY - current.y;
        if (!current.axis && Math.max(Math.abs(x), Math.abs(y)) >= 8) {
          current.axis = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
          blockedClick.current = true;
          if ((current.axis === 'x' && !horizontal) || (current.axis === 'y' && !upward)) {
            reset(true);
            return;
          }
          current.surface.setPointerCapture(current.id);
        }
        if (current.axis) {
          event.preventDefault();
          setOffset({
            x: current.axis === 'x' ? x : 0,
            y: current.axis === 'y' ? Math.min(0, y) : 0,
          });
        }
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const x = event.clientX - current.x;
        const y = event.clientY - current.y;
        const axis = current.axis;
        reset(axis !== null);
        if (current.viewport !== viewportKey()) return;
        if (axis === 'x' && Math.abs(x) >= 48 && Math.abs(x) > Math.abs(y)) {
          horizontal?.(x < 0 ? 1 : -1);
        } else if (axis === 'y' && y <= -96 && -y > Math.abs(x)) {
          upward?.();
        }
      },
      onPointerCancel(event: PointerEvent<HTMLElement>) {
        if (drag.current?.id === event.pointerId) reset(true);
      },
      onLostPointerCapture(event: PointerEvent<HTMLElement>) {
        // A child's implicit touch capture can be handed to this surface. Its
        // bubbling lost-capture event must not cancel the new parent capture.
        if (event.target === event.currentTarget && drag.current?.id === event.pointerId)
          reset(true);
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (!blockedClick.current || event.detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
        blockedClick.current = false;
      },
    },
  };
}
