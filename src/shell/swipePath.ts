export type SwipeAxis = 'x' | 'y' | null;
export interface SwipePoint {
  x: number;
  y: number;
}
export interface SwipePath {
  axis: SwipeAxis;
  points: SwipePoint[];
}

export const startSwipePath = (): SwipePath => ({ axis: null, points: [{ x: 0, y: 0 }] });

// Retain a distance-based tail so a thumb can begin sideways and turn upward.
// A held pointer keeps its direction; event frequency and elapsed time do not
// decide the axis. These distances are tuned for this web surface, not iOS API values.
export function moveSwipePath(path: SwipePath, x: number, y: number): SwipePath {
  const last = path.points.at(-1)!;
  if (last.x === x && last.y === y) return path;
  const points = [...path.points];
  const previous = points.at(-2);
  if (previous && Math.hypot(x - previous.x, y - previous.y) < 2) points.pop();
  points.push({ x, y });
  let distance = 0;
  for (let index = points.length - 1; index > 0; index--) {
    const current = points[index];
    const previous = points[index - 1];
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (distance + segment >= 48) {
      const fraction = (48 - distance) / segment;
      points.splice(0, index, {
        x: current.x + (previous.x - current.x) * fraction,
        y: current.y + (previous.y - current.y) * fraction,
      });
      break;
    }
    distance += segment;
  }
  const tail = points[0];
  const upward = -y;
  const tailUpward = tail.y - y;
  const rising =
    upward >= 8 &&
    (upward >= Math.abs(x) * 0.9 ||
      (upward >= 24 && tailUpward >= 20 && tailUpward >= Math.abs(x - tail.x) * 0.9));
  const axis = rising ? 'y' : Math.abs(x) >= 8 && Math.abs(x) > Math.abs(y) ? 'x' : null;
  return { axis, points };
}
