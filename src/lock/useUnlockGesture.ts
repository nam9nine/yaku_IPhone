import {
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
} from 'react';
import { initialUnlockState, movedBeyondTap, unlockReducer, type UnlockAction } from './gesture';

const INTERACTIVE_TARGET =
  'button, a[href], input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"]), [data-unlock-ignore]';

type PointerHandlers = {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onLostPointerCapture: PointerEventHandler<HTMLElement>;
  onClickCapture: MouseEventHandler<HTMLElement>;
};

export function useUnlockGesture({ onUnlock }: { onUnlock: () => void }) {
  const current = useRef(initialUnlockState);
  const suppressPointerClick = useRef(false);
  const [state, setState] = useState(initialUnlockState);

  function transition(action: UnlockAction) {
    const previous = current.current;
    if (action.type === 'move' || action.type === 'end') {
      suppressPointerClick.current ||= movedBeyondTap(previous, action);
    }
    const next = unlockReducer(previous, action);
    if (next === previous) return;
    // Update synchronously before notifying the parent: batched events cannot unlock twice.
    current.current = next;
    setState(next);
    if (next.status === 'unlocked') onUnlock();
  }

  useEffect(() => {
    const cancel = () => {
      const next = unlockReducer(current.current, { type: 'cancel' });
      if (next !== current.current) {
        current.current = next;
        setState(next);
      }
    };
    const visibilityChanged = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  const bind: PointerHandlers = {
    onPointerDown(event) {
      if (current.current.status !== 'locked' || !event.isPrimary || event.button !== 0) return;
      suppressPointerClick.current = false;
      const target = event.target instanceof Element ? event.target : null;
      const interactive = target?.closest(INTERACTIVE_TARGET);
      const handle = target?.closest('[data-unlock-handle]');
      if (interactive && interactive !== handle) return;
      transition({
        type: 'start',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        isPrimary: event.isPrimary,
        button: event.button,
      });
      try {
        // Keep a handle tap targeted at its button while receiving the entire drag there.
        const captureTarget = handle instanceof HTMLElement ? handle : event.currentTarget;
        captureTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        // Capture can disappear when the OS interrupts or ends the pointer first.
        transition({ type: 'cancel', pointerId: event.pointerId });
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
    },
    onPointerMove(event) {
      transition({
        type: 'move',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      });
    },
    onPointerUp(event) {
      transition({
        type: 'end',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      });
      // Native pointerup releases capture; no timer or animation event owns completion.
    },
    onPointerCancel(event) {
      transition({ type: 'cancel', pointerId: event.pointerId });
    },
    onLostPointerCapture(event) {
      transition({ type: 'cancel', pointerId: event.pointerId });
    },
    onClickCapture(event) {
      // Keyboard/assistive activation has detail=0 and remains available after a cancelled drag.
      if (event.detail > 0 && suppressPointerClick.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };

  return {
    offset: state.status === 'dragging' ? state.offset : 0,
    dragging: state.status === 'dragging',
    bind,
    unlock: () => transition({ type: 'unlock' }),
  };
}
