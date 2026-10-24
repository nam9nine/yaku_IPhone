import { useEffect, useEffectEvent, useRef, type PointerEvent } from 'react';
import {
  horizontalResult,
  type HorizontalDirection,
  type HorizontalDrag,
} from './horizontalGesture';

export interface HorizontalFeedback {
  blocked: () => boolean;
  begin: (element: HTMLElement) => void;
  move: (offset: number) => void;
  release: (direction: HorizontalDirection | null) => void;
  cancel: (immediate: boolean) => void;
}

export function useHorizontalGesture({
  active,
  start,
  commit,
  feedback,
}: {
  active: boolean;
  start: (event: PointerEvent<HTMLElement>) => HorizontalDrag['allowed'] | null;
  commit: (direction: HorizontalDirection) => void;
  feedback?: HorizontalFeedback;
}) {
  const drag = useRef<HorizontalDrag | null>(null);
  const unowned = useRef<{ pointerId: number; x: number; y: number; slop: number } | null>(null);
  const captured = useRef<HTMLElement | null>(null);
  const suppressClick = useRef(false);
  const rejectedPointer = useRef<number | null>(null);
  const dimensions = useRef({ width: 0, height: 0 });

  function releasePointer() {
    const previous = drag.current;
    drag.current = null;
    if (previous && captured.current?.hasPointerCapture(previous.pointerId)) {
      captured.current.releasePointerCapture(previous.pointerId);
    }
    captured.current = null;
  }
  function cancel(immediate = false) {
    releasePointer();
    feedback?.cancel(immediate);
  }
  const cancelActive = useEffectEvent(() => {
    if (drag.current) suppressClick.current = true;
    rejectedPointer.current = null;
    unowned.current = null;
    cancel(true);
  });
  useEffect(() => {
    if (!active) cancelActive();
  }, [active]);
  useEffect(() => {
    const cancelInput = () => cancelActive();
    const hidden = () => {
      if (document.hidden) cancelActive();
    };
    const anotherPointer = (event: globalThis.PointerEvent) => {
      if (drag.current && event.pointerId !== drag.current.pointerId) {
        suppressClick.current = true;
        cancelActive();
      }
    };
    window.addEventListener('blur', cancelInput);
    window.addEventListener('resize', cancelInput);
    window.visualViewport?.addEventListener('resize', cancelInput);
    window.addEventListener('pointerdown', anotherPointer, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancelInput();
      window.removeEventListener('blur', cancelInput);
      window.removeEventListener('resize', cancelInput);
      window.visualViewport?.removeEventListener('resize', cancelInput);
      window.removeEventListener('pointerdown', anotherPointer, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      if (!active || !event.isPrimary || event.button !== 0 || drag.current) return;
      if (feedback?.blocked()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      suppressClick.current = false;
      rejectedPointer.current = null;
      unowned.current = null;
      if (!(event.target instanceof Element)) return;
      // A small drift inside a button remains a tap. A clear, longer edge swipe
      // may still begin on a full-width list row; content pagers keep their slop.
      const slop =
        feedback && event.target.closest('button,a,[role="button"],[role="link"]') ? 16 : 8;
      if (
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [data-no-page-gesture]',
        )
      )
        return;
      if (window.getSelection()?.isCollapsed === false) return;
      const allowed = start(event);
      if (!allowed) {
        // Observe an unowned drag only to avoid turning it into a button click.
        // Do not capture, prevent scrolling, or claim content pagination.
        if (feedback)
          unowned.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            slop,
          };
        return;
      }
      unowned.current = null;
      dimensions.current = { width: window.innerWidth, height: window.innerHeight };
      feedback?.begin(event.currentTarget);
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        allowed,
        slop,
      };
      // An outer edge gesture owns this pointer before the content pager can see it.
      event.stopPropagation();
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const ignored = unowned.current;
      if (
        ignored?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - ignored.x, event.clientY - ignored.y) >= ignored.slop
      )
        suppressClick.current = true;
      if (rejectedPointer.current === event.pointerId) {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        event.stopPropagation();
        return;
      }
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (
        dimensions.current.width !== window.innerWidth ||
        dimensions.current.height !== window.innerHeight
      ) {
        suppressClick.current = true;
        cancel(true);
        return;
      }
      const result = horizontalResult(current, event.clientX, event.clientY);
      if (result.moved) {
        suppressClick.current = true;
        // Do not leave a mouse-drag selection that blocks the next gesture.
        // A selection present before pointerdown was already excluded above.
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
      }
      if (result.cancelled) {
        rejectedPointer.current = event.pointerId;
        cancel();
        return;
      }
      if (result.moved) feedback?.move(event.clientX - current.x);
      if (result.moved && !captured.current) {
        captured.current = event.currentTarget;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          cancel();
        }
      }
      event.stopPropagation();
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      if (unowned.current?.pointerId === event.pointerId) unowned.current = null;
      if (rejectedPointer.current === event.pointerId) {
        rejectedPointer.current = null;
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        event.stopPropagation();
        return;
      }
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (
        dimensions.current.width !== window.innerWidth ||
        dimensions.current.height !== window.innerHeight
      ) {
        suppressClick.current = true;
        cancel(true);
        return;
      }
      const result = horizontalResult(current, event.clientX, event.clientY);
      if (result.moved) suppressClick.current = true;
      releasePointer();
      if (feedback) feedback.release(result.complete ? result.direction : null);
      else if (result.complete) commit(result.direction);
      event.stopPropagation();
    },
    onPointerCancelCapture(event: PointerEvent<HTMLElement>) {
      if (unowned.current?.pointerId === event.pointerId) unowned.current = null;
      if (rejectedPointer.current === event.pointerId) rejectedPointer.current = null;
      if (drag.current?.pointerId === event.pointerId) {
        suppressClick.current = true;
        cancel();
      }
    },
    onLostPointerCaptureCapture(event: PointerEvent<HTMLElement>) {
      if (event.target === event.currentTarget && drag.current?.pointerId === event.pointerId) {
        suppressClick.current = true;
        cancel();
      }
    },
    onClickCapture(event: React.MouseEvent<HTMLElement>) {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
