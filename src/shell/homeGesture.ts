export interface HomeGesture {
  pointerId: number;
  startX: number;
  startY: number;
}
export function homeDrag(gesture: HomeGesture, x: number, y: number) {
  const horizontal = Math.abs(x - gesture.startX);
  const upward = gesture.startY - y;
  return {
    cancelled: horizontal > 12 && horizontal > Math.abs(upward),
    offset: Math.min(180, Math.max(0, upward)),
    complete: upward >= 96 && upward >= horizontal,
  };
}
