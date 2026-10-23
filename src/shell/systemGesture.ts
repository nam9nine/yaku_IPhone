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
  startedAt: number;
  motionStartedAt: number | null;
  samples: { y: number; time: number }[];
}
export type SystemGestureResult = 'home' | 'switcher' | 'previous' | 'next' | 'open' | null;
// Tuned for this web surface; these are not Apple's private recognizer constants.
export const gestureThresholds = { up: 96, down: 64, sideways: 80, pause: 140, slop: 4 };
export function upwardVelocity(g: SystemGesture, now: number) {
  const first = g.samples.find((sample) => sample.time >= now - 120) ?? g.samples.at(-1);
  return first ? Math.max(0, (first.y - g.lastY) / Math.max(1, now - first.time)) : 0;
}
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
    motionStartedAt:
      moved && (g.motionStartedAt === null || now - g.movedAt >= gestureThresholds.pause)
        ? now
        : g.motionStartedAt,
    samples: [...g.samples.filter((sample) => sample.time >= now - 160), { y, time: now }],
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
  // Continuing through the switcher preview toward the top commits Home,
  // even when the finger arrived slowly or pauses before release.
  if (-g.y >= Math.max(gestureThresholds.up + 64, g.startY * 0.75)) return 'home';
  const velocity = upwardVelocity(g, now);
  const slow = g.motionStartedAt !== null && now - g.motionStartedAt >= 240 && velocity < 0.55;
  return now - g.movedAt >= gestureThresholds.pause || slow ? 'switcher' : 'home';
}
