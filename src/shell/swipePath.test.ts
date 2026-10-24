import { describe, expect, it } from 'vitest';
import { moveSwipePath, startSwipePath } from './swipePath';
import { draggedRect } from './motion';

describe('손가락의 곡선 경로와 수평 탐색 분리', () => {
  it('처음 수평인 경로도 충분히 위로 돌아오면 상향으로 재판정한다', () => {
    const sideways = moveSwipePath(startSwipePath(), -150, -4);
    expect(sideways.axis).toBe('x');
    const curve = moveSwipePath(sideways, -160, -110);
    expect(curve.axis).toBe('y');
    expect(moveSwipePath(curve, -160, -110)).toBe(curve);
  });
  it('처음 위쪽, 끝 옆쪽인 quarter arc도 누적 상승을 잃지 않는다', () => {
    for (const steps of [4, 12, 60]) {
      let path = startSwipePath();
      for (let step = 1; step <= steps; step++) {
        const angle = (Math.PI / 2) * (step / steps);
        path = moveSwipePath(path, 120 * (1 - Math.cos(angle)), -120 * Math.sin(angle));
      }
      expect(path.axis).toBe('y');
    }
  });
  it('옆 넘기기의 작은 상하 흔들림과 상승하지 않는 이동은 삭제 의도가 아니다', () => {
    let path = startSwipePath();
    for (const [x, y] of [
      [-15, -3],
      [-40, -8],
      [-80, -12],
      [-130, -5],
    ])
      path = moveSwipePath(path, x, y);
    expect(path.axis).toBe('x');
    expect(moveSwipePath(startSwipePath(), 0, 100).axis).toBeNull();
    expect(moveSwipePath(startSwipePath(), 3, -3).axis).toBeNull();
  });
  it('아주 촘촘한 입력도 궤적 보관량을 늘리지 않고 원위치에서는 판정을 해제한다', () => {
    let path = startSwipePath();
    for (let step = 1; step <= 5000; step++) path = moveSwipePath(path, -20, -step / 50);
    expect(path.axis).toBe('y');
    expect(path.points.length).toBeLessThan(32);
    expect(moveSwipePath(path, 0, 0).axis).toBeNull();
  });
});

describe('짧은 상승의 연속적인 카드 미리보기', () => {
  it.each([800, 844, 932])(
    '%i 높이에서 작은 상승부터 줄어들고 위로 계속 가도 커지지 않는다',
    (height) => {
      const base = { x: 0, y: 0, width: 390, height };
      expect(draggedRect(base, 0)).toEqual(base);
      expect(draggedRect(base, 48).width).toBeLessThan(base.width * 0.85);
      let previous = base.width;
      for (let distance = 1; distance <= height; distance++) {
        const card = draggedRect(base, distance);
        expect(card.width).toBeLessThanOrEqual(previous);
        expect(card.width).toBeGreaterThanOrEqual(base.width * 0.12);
        previous = card.width;
      }
    },
  );
});
