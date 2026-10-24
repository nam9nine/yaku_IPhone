import { describe, expect, it } from 'vitest';
import { moveSystemGesture, resolveSystemGesture, type SystemGesture } from './systemGesture';
import { startSwipePath } from './swipePath';
const start: SystemGesture = {
  pointerId: 1,
  startX: 180,
  startY: 780,
  x: 0,
  y: 0,
  lastX: 180,
  lastY: 780,
  movedAt: 0,
  startedAt: 0,
  motionStartedAt: null,
  samples: [{ y: 780, time: 0 }],
  path: startSwipePath(),
};
describe('시스템 제스처 판정', () => {
  it('누른 채 기다린 시간은 느린 이동으로 세지 않고 대기 후 flick은 홈이다', () => {
    const heldThenFlick = moveSystemGesture(start, 180, 640, 500);
    expect(resolveSystemGesture('bottom', heldThenFlick, 520)).toBe('home');
    const pauseThenFlick = moveSystemGesture(heldThenFlick, 180, 520, 900);
    expect(resolveSystemGesture('bottom', pauseThenFlick, 920)).toBe('home');
  });
  it('빠른 상승과 이동 후 멈춤을 구별하고 작은 손 떨림은 멈춤을 깨지 않는다', () => {
    const up = moveSystemGesture(start, 180, 650, 100);
    expect(resolveSystemGesture('bottom', up, 150)).toBe('home');
    const held = moveSystemGesture(up, 181, 649, 350);
    expect(resolveSystemGesture('bottom', held, 350)).toBe('switcher');
    expect(resolveSystemGesture('bottom', moveSystemGesture(held, 181, 640, 360), 360)).toBe(
      'home',
    );
  });
  it('같은 거리도 천천히 연속해서 올리면 최근 앱, 마지막에 빠르게 올리면 홈이다', () => {
    let slow = start;
    for (let step = 1; step <= 10; step++)
      slow = moveSystemGesture(slow, 180, 780 - step * 14, step * 50);
    expect(resolveSystemGesture('bottom', slow, 500)).toBe('switcher');
    const flick = moveSystemGesture(slow, 180, 540, 530);
    expect(resolveSystemGesture('bottom', flick, 530)).toBe('home');
    expect(resolveSystemGesture('bottom', moveSystemGesture(start, 180, 640, 80), 80)).toBe('home');
  });
  it('중간에서 천천히 놓으면 최근 앱이지만 끝까지 올리면 속도와 관계없이 홈이다', () => {
    const middle = moveSystemGesture(start, 180, 400, 1000);
    expect(resolveSystemGesture('bottom', middle, 1250)).toBe('switcher');
    const top = moveSystemGesture(middle, 180, 100, 2000);
    expect(resolveSystemGesture('bottom', top, 2300)).toBe('home');
  });
  it('짧은 상승·옆으로 더 많이 이동한 직선·반대 방향은 실행하지 않는다', () => {
    for (const [x, y] of [
      [180, 755],
      [320, 670],
      [180, 900],
    ])
      expect(resolveSystemGesture('bottom', moveSystemGesture(start, x, y, 100), 500)).toBeNull();
  });
  it('왼쪽에서 옆으로 시작해 위로 휘면 빠른 종료는 홈, 멈추면 최근 앱이다', () => {
    let curve = moveSystemGesture(start, 70, 774, 40);
    curve = moveSystemGesture(curve, 30, 740, 80);
    curve = moveSystemGesture(curve, 30, 650, 120);
    expect(resolveSystemGesture('bottom', curve, 136)).toBe('home');
    expect(resolveSystemGesture('bottom', curve, 300)).toBe('switcher');
    expect(resolveSystemGesture('bottom', moveSystemGesture(curve, 30, 100, 1000), 1200)).toBe(
      'home',
    );
  });
  it('오른쪽으로 휘는 상향 동작도 유지하고 짧은 곡선과 원위치 복귀는 취소한다', () => {
    const diagonal = moveSystemGesture(start, 280, 630, 100);
    expect(resolveSystemGesture('bottom', diagonal, 116)).toBe('home');
    const sideways = moveSystemGesture(start, 80, 775, 40);
    const short = moveSystemGesture(sideways, 70, 740, 80);
    expect(resolveSystemGesture('bottom', short, 300)).toBeNull();
    const up = moveSystemGesture(short, 70, 650, 120);
    const returned = moveSystemGesture(up, 180, 770, 180);
    expect(resolveSystemGesture('bottom', returned, 400)).toBeNull();
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
