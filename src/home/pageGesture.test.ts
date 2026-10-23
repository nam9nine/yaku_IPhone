import { describe, expect, it } from 'vitest';
import { pageAfterGesture, type PageGesture } from './pageGesture';

const gesture = (x: number, y = 0): PageGesture => ({
  pointerId: 1,
  startX: 200,
  startY: 300,
  x,
  y,
});

describe('home page gestures', () => {
  it('changes one page after a deliberate horizontal swipe', () => {
    expect(pageAfterGesture(0, 2, gesture(-90), 390)).toBe(1);
    expect(pageAfterGesture(1, 2, gesture(90), 390)).toBe(0);
  });

  it('returns short and vertical drags to the current page', () => {
    expect(pageAfterGesture(0, 2, gesture(-30), 390)).toBe(0);
    expect(pageAfterGesture(0, 2, gesture(-90, 100), 390)).toBe(0);
  });

  it('does not navigate when a gesture is cancelled', () => {
    expect(pageAfterGesture(0, 2, gesture(-150), 390, true)).toBe(0);
  });

  it('keeps the first and last page within the available range', () => {
    expect(pageAfterGesture(0, 2, gesture(180), 390)).toBe(0);
    expect(pageAfterGesture(1, 2, gesture(-180), 390)).toBe(1);
  });
});
