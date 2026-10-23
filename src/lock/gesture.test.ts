import { describe, expect, it } from 'vitest';
import {
  initialUnlockState,
  MAX_DRAG_OFFSET,
  movedBeyondTap,
  UNLOCK_DISTANCE,
  unlockReducer,
  type UnlockState,
} from './gesture';

const start = (state: UnlockState = initialUnlockState, pointerId = 1) =>
  unlockReducer(state, { type: 'start', pointerId, x: 100, y: 500, isPrimary: true, button: 0 });
const move = (state: UnlockState, x: number, y: number, pointerId = 1) =>
  unlockReducer(state, { type: 'move', pointerId, x, y });
const end = (state: UnlockState, x: number, y: number, pointerId = 1) =>
  unlockReducer(state, { type: 'end', pointerId, x, y });

describe('잠금 해제 제스처', () => {
  it('위로 충분히 밀어도 손을 놓기 전에는 해제하지 않는다', () => {
    const dragging = move(start(), 105, 500 - UNLOCK_DISTANCE);
    expect(dragging.status).toBe('dragging');
    expect(end(dragging, 105, 500 - UNLOCK_DISTANCE)).toEqual({ status: 'unlocked' });
  });

  it('마지막 pointerup 좌표를 반영하고 짧은 드래그를 되돌린다', () => {
    expect(end(start(), 100, 500 - UNLOCK_DISTANCE)).toEqual({ status: 'unlocked' });
    expect(end(move(start(), 100, 460), 100, 500 - UNLOCK_DISTANCE + 1)).toEqual(
      initialUnlockState,
    );
  });

  it('길게 밀었다가 시작점으로 돌아오면 해제하지 않는다', () => {
    expect(end(move(start(), 100, 300), 100, 490)).toEqual(initialUnlockState);
  });

  it('아래 방향 이동은 화면을 끌어올리거나 해제하지 않는다', () => {
    expect(move(start(), 100, 620)).toMatchObject({ status: 'dragging', offset: 0 });
    expect(end(start(), 100, 620)).toEqual(initialUnlockState);
  });

  it('아주 긴 이동의 표시 거리를 제한해도 해제는 가능하다', () => {
    const dragging = move(start(), 100, -100);
    expect(dragging).toMatchObject({ offset: MAX_DRAG_OFFSET });
    expect(end(dragging, 100, -100)).toEqual({ status: 'unlocked' });
  });

  it('가로 우세 이동은 취소하고 이후 세로 이동에도 다시 시작하지 않는다', () => {
    const cancelled = move(start(), 140, 490);
    expect(cancelled).toEqual(initialUnlockState);
    expect(end(move(cancelled, 140, 250), 140, 250)).toEqual(initialUnlockState);
    expect(end(start(cancelled, 2), 100, 350, 2)).toEqual({ status: 'unlocked' });
  });

  it('처음 손가락의 작은 가로 흔들림은 허용하지만 최종 가로 우세는 거부한다', () => {
    const wobble = move(start(), 106, 499);
    expect(wobble.status).toBe('dragging');
    expect(end(wobble, 108, 350)).toEqual({ status: 'unlocked' });
    expect(end(start(), 300, 350)).toEqual(initialUnlockState);
  });

  it('다른 손가락의 시작·이동·종료·취소는 활성 입력을 바꾸지 않는다', () => {
    const dragging = move(start(), 100, 460);
    expect(start(dragging, 2)).toBe(dragging);
    expect(move(dragging, 100, 200, 2)).toBe(dragging);
    expect(end(dragging, 100, 200, 2)).toBe(dragging);
    expect(unlockReducer(dragging, { type: 'cancel', pointerId: 2 })).toBe(dragging);
    expect(end(dragging, 100, 350)).toEqual({ status: 'unlocked' });
  });

  it('primary가 아닌 입력과 보조 마우스 버튼은 시작하지 않는다', () => {
    const input = { type: 'start' as const, pointerId: 1, x: 100, y: 500 };
    expect(unlockReducer(initialUnlockState, { ...input, isPrimary: false, button: 0 })).toBe(
      initialUnlockState,
    );
    expect(unlockReducer(initialUnlockState, { ...input, isPrimary: true, button: 2 })).toBe(
      initialUnlockState,
    );
  });

  it('pointercancel과 캡처 손실은 충분히 이동했어도 취소하고 다음 입력을 허용한다', () => {
    const cancelled = unlockReducer(move(start(), 100, 300), { type: 'cancel', pointerId: 1 });
    expect(cancelled).toEqual(initialUnlockState);
    expect(end(cancelled, 100, 300)).toBe(cancelled);
    expect(end(start(cancelled, 2), 100, 350, 2)).toEqual({ status: 'unlocked' });
  });

  it('브라우저 포커스 손실처럼 pointerId 없는 취소도 초기화한다', () => {
    expect(unlockReducer(move(start(), 100, 300), { type: 'cancel' })).toEqual(initialUnlockState);
  });

  it('키보드와 포인터 해제 이후 반복 입력은 같은 완료 상태를 유지한다', () => {
    const unlocked = unlockReducer(move(start(), 100, 400), { type: 'unlock' });
    expect(unlocked).toEqual({ status: 'unlocked' });
    expect(unlockReducer(unlocked, { type: 'unlock' })).toBe(unlocked);
    expect(end(unlocked, 100, 300)).toBe(unlocked);
    expect(start(unlocked, 2)).toBe(unlocked);
    expect(unlockReducer(unlocked, { type: 'cancel' })).toBe(unlocked);
  });
});

describe('잠금 해제 안내 버튼의 드래그와 탭 구분', () => {
  it('작은 흔들림은 탭으로 남기고 8px 이동부터 후속 클릭을 막는다', () => {
    const dragging = start();
    expect(movedBeyondTap(dragging, { pointerId: 1, x: 100, y: 493 })).toBe(false);
    expect(movedBeyondTap(dragging, { pointerId: 1, x: 100, y: 492 })).toBe(true);
  });

  it('수평·아래·대각선 드래그도 잠금 해제 버튼 탭으로 처리하지 않는다', () => {
    const dragging = start();
    expect(movedBeyondTap(dragging, { pointerId: 1, x: 108, y: 500 })).toBe(true);
    expect(movedBeyondTap(dragging, { pointerId: 1, x: 100, y: 508 })).toBe(true);
    expect(movedBeyondTap(dragging, { pointerId: 1, x: 106, y: 506 })).toBe(true);
  });

  it('다른 포인터 또는 시작하지 않은 이동은 현재 탭을 취소하지 않는다', () => {
    expect(movedBeyondTap(start(), { pointerId: 2, x: 100, y: 300 })).toBe(false);
    expect(movedBeyondTap(initialUnlockState, { pointerId: 1, x: 100, y: 300 })).toBe(false);
  });
});
