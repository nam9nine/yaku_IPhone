export type HorizontalDirection = 'previous' | 'next';
export interface HorizontalDrag {
  pointerId: number;
  x: number;
  y: number;
  allowed: 'both' | HorizontalDirection;
  slop?: number;
}

export function horizontalResult(drag: HorizontalDrag, x: number, y: number) {
  const dx = x - drag.x;
  const dy = y - drag.y;
  const moved = Math.hypot(dx, dy) >= (drag.slop ?? 8);
  const direction: HorizontalDirection = dx > 0 ? 'previous' : 'next';
  const cancelled =
    moved &&
    ((Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) ||
      (Math.abs(dx) > 10 && drag.allowed !== 'both' && drag.allowed !== direction));
  return {
    moved,
    cancelled,
    direction,
    complete: !cancelled && Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.4,
  };
}

export function edgeDirection(
  x: number,
  y: number,
  width: number,
  height: number,
  canBack: boolean,
  canForward: boolean,
): HorizontalDirection | null {
  if (y < 28 || y > height - 44) return null;
  // An inset content region, not a replacement for iOS's physical screen edge.
  if (canBack && x >= 8 && x <= 32) return 'previous';
  if (canForward && x >= width - 32 && x <= width - 8) return 'next';
  return null;
}
