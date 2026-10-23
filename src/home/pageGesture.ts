export interface PageGesture {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export function isHorizontalGesture(gesture: PageGesture) {
  return Math.abs(gesture.x) > 8 && Math.abs(gesture.x) > Math.abs(gesture.y) * 1.35;
}

export function pageAfterGesture(
  page: number,
  pageCount: number,
  gesture: PageGesture,
  width: number,
  cancelled = false,
) {
  if (cancelled || !isHorizontalGesture(gesture)) return page;
  if (Math.abs(gesture.x) < Math.max(48, width * 0.18)) return page;
  return Math.max(0, Math.min(pageCount - 1, page + (gesture.x < 0 ? 1 : -1)));
}
