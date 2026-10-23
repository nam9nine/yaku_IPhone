export type SystemGestureKind = 'bottom' | 'top';
export interface SystemGesture {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  movedAt: number;
}
export type SystemGestureResult = 'home' | 'switcher' | 'previous' | 'next' | 'open' | null;
export const gestureThresholds = { up: 96, down: 64, sideways: 80, pause: 220, slop: 4 };
export function moveSystemGesture(
  g: SystemGesture,
  x: number,
  y: number,
  now: number,
): SystemGesture {
  const moved = Math.hypot(x - g.lastX, y - g.lastY) >= gestureThresholds.slop;
  return {
    ...g,
    x: x - g.startX,
    y: y - g.startY,
    lastX: moved ? x : g.lastX,
    lastY: moved ? y : g.lastY,
    movedAt: moved ? now : g.movedAt,
  };
}
export function resolveSystemGesture(
  kind: SystemGestureKind,
  g: SystemGesture,
  now: number,
): SystemGestureResult {
  if (kind === 'top')
    return g.y >= gestureThresholds.down && Math.abs(g.x) < g.y * 0.55 ? 'open' : null;
  if (Math.abs(g.x) >= gestureThresholds.sideways && Math.abs(g.y) < 30)
    return g.x > 0 ? 'previous' : 'next';
  if (-g.y < gestureThresholds.up || Math.abs(g.x) > -g.y * 0.55) return null;
  return now - g.movedAt >= gestureThresholds.pause ? 'switcher' : 'home';
}
