import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react';
import {
  moveSystemGesture,
  resolveSystemGesture,
  type SystemGesture,
  type SystemGestureKind,
  type SystemGestureResult,
} from './systemGesture';

export function useSystemGesture(
  kind: SystemGestureKind,
  active: boolean,
  onComplete: (result: NonNullable<SystemGestureResult>, gesture: SystemGesture) => void,
) {
  const gesture = useRef<SystemGesture | null>(null);
  const surface = useRef<HTMLElement | null>(null);
  const dimensions = useRef('');
  const viewportKey = () =>
    `${window.innerWidth}:${window.innerHeight}:${window.visualViewport?.width}:${window.visualViewport?.height}`;
  const localY = (y: number) =>
    y - (surface.current?.closest('.mobile-shell')?.getBoundingClientRect().top ?? 0);
  const suppress = useRef(false);
  const frame = useRef<number | null>(null);
  const pending = useRef(0);
  const [drag, setDrag] = useState({ active, offset: 0 });
  if (drag.active !== active) setDrag({ active, offset: 0 });
  const setOffset = (offset: number) => setDrag({ active, offset });
  function queueOffset(offset: number) {
    pending.current = offset;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setOffset(pending.current);
    });
  }
  function clearInput() {
    const current = gesture.current;
    gesture.current = null;
    if (current && surface.current?.hasPointerCapture(current.pointerId))
      surface.current.releasePointerCapture(current.pointerId);
  }
  function cancel() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    clearInput();
    setOffset(0);
  }
  const cancelEvent = useEffectEvent(cancel);
  const clearEvent = useEffectEvent(clearInput);
  useEffect(() => {
    const cancelInput = () => cancelEvent();
    const hidden = () => {
      if (document.hidden) cancelEvent();
    };
    const second = (event: globalThis.PointerEvent) => {
      if (gesture.current && gesture.current.pointerId !== event.pointerId) cancelEvent();
    };
    window.addEventListener('pointerdown', second, true);
    window.addEventListener('blur', cancelInput);
    window.addEventListener('resize', cancelInput);
    window.visualViewport?.addEventListener('resize', cancelInput);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancelEvent();
      window.removeEventListener('pointerdown', second, true);
      window.removeEventListener('blur', cancelInput);
      window.removeEventListener('resize', cancelInput);
      window.visualViewport?.removeEventListener('resize', cancelInput);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    if (!active) clearEvent();
  }, [active]);
  function finish(event: PointerEvent<HTMLElement>, cancelled: boolean) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const final = moveSystemGesture(current, event.clientX, localY(event.clientY), event.timeStamp);
    suppress.current ||= Math.hypot(final.x, final.y) > 8;
    // Resize notifications can arrive after pointerup. Compare the viewport itself
    // so a release during that interval cannot complete an old gesture.
    const result =
      !cancelled && active && dimensions.current === viewportKey()
        ? resolveSystemGesture(kind, final, event.timeStamp)
        : null;
    // Let the consumer capture the presented geometry before clearing drag styles.
    if (result) onComplete(result, final);
    cancel();
  }
  return {
    offset: active ? drag.offset : 0,
    cancel,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!active || !event.isPrimary || event.button !== 0 || gesture.current) return;
        if ((event.target as HTMLElement).closest('button,input,a,select,textarea')) return;
        // This dedicated surface owns the gesture. Native mouse selection/dragging
        // must not take over when the pointer leaves it or capture is cancelled.
        event.preventDefault();
        suppress.current = false;
        surface.current = event.currentTarget;
        dimensions.current = viewportKey();
        gesture.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: localY(event.clientY),
          x: 0,
          y: 0,
          lastX: event.clientX,
          lastY: localY(event.clientY),
          movedAt: event.timeStamp,
          startedAt: event.timeStamp,
          motionStartedAt: null,
          samples: [{ y: localY(event.clientY), time: event.timeStamp }],
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (dimensions.current !== viewportKey()) {
          cancel();
          return;
        }
        event.preventDefault();
        const next = moveSystemGesture(
          current,
          event.clientX,
          localY(event.clientY),
          event.timeStamp,
        );
        gesture.current = next;
        if (Math.hypot(next.x, next.y) > 8) suppress.current = true;
        queueOffset(kind === 'bottom' ? Math.max(0, -next.y) : Math.max(0, next.y));
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        finish(event, false);
      },
      onPointerCancel(event: PointerEvent<HTMLElement>) {
        finish(event, true);
      },
      onLostPointerCapture(event: PointerEvent<HTMLElement>) {
        if (event.target === event.currentTarget) finish(event, true);
      },
      onClickCapture(event: React.MouseEvent<HTMLElement>) {
        if (suppress.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
        }
        suppress.current = false;
      },
    },
  };
}
