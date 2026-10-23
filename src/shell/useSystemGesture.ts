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
  onComplete: (result: NonNullable<SystemGestureResult>) => void,
) {
  const gesture = useRef<SystemGesture | null>(null);
  const surface = useRef<HTMLElement | null>(null);
  const suppress = useRef(false);
  const [drag, setDrag] = useState({ active, offset: 0 });
  if (drag.active !== active) setDrag({ active, offset: 0 });
  const setOffset = (offset: number) => setDrag({ active, offset });
  function clearInput() {
    const current = gesture.current;
    gesture.current = null;
    if (current && surface.current?.hasPointerCapture(current.pointerId))
      surface.current.releasePointerCapture(current.pointerId);
  }
  function cancel() {
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
    const final = moveSystemGesture(current, event.clientX, event.clientY, event.timeStamp);
    suppress.current ||= Math.hypot(final.x, final.y) > 8;
    const result = !cancelled && active ? resolveSystemGesture(kind, final, event.timeStamp) : null;
    cancel();
    if (result) onComplete(result);
  }
  return {
    offset: active ? drag.offset : 0,
    cancel,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!active || !event.isPrimary || event.button !== 0 || gesture.current) return;
        if ((event.target as HTMLElement).closest('button,input,a,select,textarea')) return;
        suppress.current = false;
        surface.current = event.currentTarget;
        gesture.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: 0,
          y: 0,
          lastX: event.clientX,
          lastY: event.clientY,
          movedAt: event.timeStamp,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const next = moveSystemGesture(current, event.clientX, event.clientY, event.timeStamp);
        gesture.current = next;
        if (Math.hypot(next.x, next.y) > 8) suppress.current = true;
        setOffset(kind === 'bottom' ? Math.max(0, -next.y) : Math.max(0, next.y));
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
