import { describe, expect, it } from 'vitest';
import { edgeDirection, horizontalResult, type HorizontalDrag } from './horizontalGesture';

const drag: HorizontalDrag = { pointerId: 1, x: 20, y: 100, allowed: 'previous' };
describe('horizontal navigation intent', () => {
  it('commits one horizontal direction only after sufficient travel', () => {
    expect(horizontalResult(drag, 100, 105)).toMatchObject({
      complete: true,
      direction: 'previous',
    });
    expect(horizontalResult(drag, 65, 100).complete).toBe(false);
    expect(horizontalResult(drag, -60, 100)).toMatchObject({ complete: false, cancelled: true });
  });
  it('does not turn vertical motion or a returned drag into navigation', () => {
    expect(horizontalResult(drag, 30, 200)).toMatchObject({ complete: false, cancelled: true });
    expect(horizontalResult(drag, 100, 170).complete).toBe(false);
    expect(horizontalResult(drag, 23, 100).complete).toBe(false);
  });
  it('suppresses click-sized movement separately from navigation', () => {
    expect(horizontalResult(drag, 26, 100).moved).toBe(false);
    expect(horizontalResult(drag, 30, 100)).toMatchObject({ moved: true, complete: false });
  });
});
describe('inset edge ownership', () => {
  it('separates history edges from center pagination and shell areas', () => {
    expect(edgeDirection(20, 100, 390, 800, true, true)).toBe('previous');
    expect(edgeDirection(370, 100, 390, 800, true, true)).toBe('next');
    for (const [x, y] of [
      [3, 100],
      [190, 100],
      [20, 10],
      [20, 780],
    ])
      expect(edgeDirection(x, y, 390, 800, true, true)).toBeNull();
  });
  it('does not manufacture back history at an app root', () => {
    expect(edgeDirection(20, 100, 390, 800, false, true)).toBeNull();
    expect(edgeDirection(370, 100, 390, 800, true, false)).toBeNull();
  });
});
