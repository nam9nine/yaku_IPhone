import { useEffect, useEffectEvent } from 'react';
export type TopPanel = 'control' | 'notifications';
// Inside the web viewport, below the native top edge and the status row.
export const TOP_PULL_START = 40;
export const TOP_PULL_END = 112;
export function useTopPull(
  active: boolean,
  onPreview: (kind: TopPanel | null) => void,
  onOpen: (kind: TopPanel) => void,
) {
  const preview = useEffectEvent(onPreview);
  const open = useEffectEvent(onOpen);
  useEffect(() => {
    if (!active) return;
    let input: {
      id: number;
      x: number;
      y: number;
      root: HTMLElement;
      kind: TopPanel;
      dragging: boolean;
      progress: number;
    } | null = null;
    let frame = 0;
    let timer = 0;
    let suppress = false;
    let settling = false;
    function clearCapture() {
      const old = input;
      input = null;
      if (old?.root.hasPointerCapture(old.id)) old.root.releasePointerCapture(old.id);
    }
    function finish(commit = false, immediate = false) {
      const old = input;
      if (!old) return;
      cancelAnimationFrame(frame);
      frame = 0;
      clearCapture();
      if (!old.dragging) return;
      old.root.dataset.topSettling = 'true';
      old.root.style.setProperty('--top-pull-progress', commit ? '1' : '0');
      if (commit) {
        open(old.kind);
        return;
      }
      settling = true;
      timer = window.setTimeout(
        () => {
          settling = false;
          preview(null);
          delete old.root.dataset.topSettling;
        },
        immediate ? 0 : 260,
      );
    }
    function down(event: PointerEvent) {
      if (!input) suppress = false;
      if (input) {
        if (event.pointerId !== input.id) finish(false);
        return;
      }
      if (settling || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element))
        return;
      const root = event.target.closest<HTMLElement>('.mobile-shell');
      if (!root) return;
      if (
        event.target.closest(
          'button,a,[role="button"],[role="link"],input,textarea,select,label,[contenteditable="true"],.social-scroll,.settings-content,.phone-history,.phone-keypad,.day-call,dialog[open]',
        )
      )
        return;
      const box = root.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = event.clientY - box.top;
      const safe = parseFloat(getComputedStyle(root).getPropertyValue('--safe-area-top')) || 0;
      // The visible status row is also a start target. Keep the larger, lowered
      // 40–112px band so users need not touch the device's native top edge.
      const statusRow = y >= safe + 5 && y <= safe + 31;
      if (
        (!statusRow && (y < TOP_PULL_START + safe || y > TOP_PULL_END + safe)) ||
        (x > 0.35 && x < 0.65)
      )
        return;
      input = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        root,
        kind: x >= 0.65 ? 'control' : 'notifications',
        dragging: false,
        progress: 0,
      };
      suppress = false;
    }
    function move(event: PointerEvent) {
      const current = input;
      if (!current || event.pointerId !== current.id) return;
      const dy = event.clientY - current.y,
        dx = event.clientX - current.x;
      if (!current.dragging) {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
          finish();
          return;
        }
        if (dy < -10) {
          finish();
          return;
        }
        if (dy < 8) return;
        current.dragging = true;
        current.root.setPointerCapture(current.id);
        delete current.root.dataset.topSettling;
        current.root.style.setProperty('--top-pull-progress', '0');
        preview(current.kind);
      }
      event.preventDefault();
      suppress = true;
      current.progress = Math.max(0, Math.min(1, dy / (current.root.clientHeight * 0.65)));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        current.root.style.setProperty('--top-pull-progress', String(current.progress));
      });
    }
    function up(event: PointerEvent) {
      if (input?.id !== event.pointerId) return;
      const dy = event.clientY - input.y,
        dx = event.clientX - input.x;
      finish(dy >= 64 && Math.abs(dx) < dy * 0.55);
    }
    function cancelled(event: PointerEvent) {
      if (input?.id === event.pointerId) finish(false);
    }
    function lostCapture(event: PointerEvent) {
      // Touch starts with implicit capture on the child. Taking capture on the
      // shell releases that child; only losing our own capture cancels the pull.
      if (event.target === input?.root) cancelled(event);
    }
    function reset() {
      finish(false, true);
    }
    function hidden() {
      if (document.hidden) reset();
    }
    function click(event: MouseEvent) {
      if (suppress && event.detail !== 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      suppress = false;
    }
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancelled, true);
    window.addEventListener('lostpointercapture', lostCapture, true);
    window.addEventListener('click', click, true);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    window.visualViewport?.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      clearCapture();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancelled, true);
      window.removeEventListener('lostpointercapture', lostCapture, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      window.visualViewport?.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [active]);
}
