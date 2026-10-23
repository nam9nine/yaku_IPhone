import { describe, expect, it } from 'vitest';
import { moveSystemGesture, resolveSystemGesture, type SystemGesture } from './systemGesture';
const start: SystemGesture = {
  pointerId: 1,
  startX: 180,
  startY: 780,
  x: 0,
  y: 0,
  lastX: 180,
  lastY: 780,
  movedAt: 0,
};
describe('시스템 제스처 판정', () => {
  it('빠른 상승과 이동 후 멈춤을 구별하고 작은 손 떨림은 멈춤을 깨지 않는다', () => {
    const up = moveSystemGesture(start, 180, 650, 100);
    expect(resolveSystemGesture('bottom', up, 150)).toBe('home');
    const held = moveSystemGesture(up, 181, 649, 350);
    expect(resolveSystemGesture('bottom', held, 350)).toBe('switcher');
    expect(resolveSystemGesture('bottom', moveSystemGesture(held, 181, 640, 360), 360)).toBe(
      'home',
    );
  });
  it('짧은 상승·대각선·반대 방향은 실행하지 않는다', () => {
    for (const [x, y] of [
      [180, 730],
      [310, 650],
      [180, 900],
    ])
      expect(resolveSystemGesture('bottom', moveSystemGesture(start, x, y, 100), 500)).toBeNull();
  });
  it('하단의 수평 이동은 방향별 앱 전환이며 상단에서는 아래 방향만 실행한다', () => {
    expect(resolveSystemGesture('bottom', moveSystemGesture(start, 280, 780, 100), 120)).toBe(
      'previous',
    );
    expect(resolveSystemGesture('bottom', moveSystemGesture(start, 80, 780, 100), 120)).toBe(
      'next',
    );
    expect(resolveSystemGesture('top', moveSystemGesture(start, 180, 850, 100), 120)).toBe('open');
    expect(resolveSystemGesture('top', moveSystemGesture(start, 280, 850, 100), 120)).toBeNull();
    expect(resolveSystemGesture('top', moveSystemGesture(start, 180, 650, 100), 120)).toBeNull();
  });
});
