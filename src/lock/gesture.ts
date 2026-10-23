export const UNLOCK_DISTANCE = 96;
export const MAX_DRAG_OFFSET = 180;
const DIRECTION_SLOP = 12;
const TAP_MOVEMENT_LIMIT = 8;

export type UnlockState =
  | { status: 'locked' }
  | {
      status: 'dragging';
      pointerId: number;
      startX: number;
      startY: number;
      offset: number;
    }
  | { status: 'unlocked' };

export type UnlockAction =
  | {
      type: 'start';
      pointerId: number;
      x: number;
      y: number;
      isPrimary: boolean;
      button: number;
    }
  | { type: 'move' | 'end'; pointerId: number; x: number; y: number }
  | { type: 'cancel'; pointerId?: number }
  | { type: 'unlock' };

export const initialUnlockState: UnlockState = { status: 'locked' };

export function movedBeyondTap(
  state: UnlockState,
  point: { pointerId: number; x: number; y: number },
): boolean {
  return (
    state.status === 'dragging' &&
    state.pointerId === point.pointerId &&
    Math.hypot(point.x - state.startX, point.y - state.startY) >= TAP_MOVEMENT_LIMIT
  );
}

export function unlockReducer(state: UnlockState, action: UnlockAction): UnlockState {
  // The mounted lock screen may finish only once, including mixed pointer/keyboard input.
  if (state.status === 'unlocked') return state;
  if (action.type === 'unlock') return { status: 'unlocked' };

  if (action.type === 'start') {
    if (state.status !== 'locked' || !action.isPrimary || action.button !== 0) return state;
    return {
      status: 'dragging',
      pointerId: action.pointerId,
      startX: action.x,
      startY: action.y,
      offset: 0,
    };
  }

  if (state.status !== 'dragging') return state;
  if (action.pointerId !== undefined && action.pointerId !== state.pointerId) return state;
  if (action.type === 'cancel') return initialUnlockState;

  const horizontal = Math.abs(action.x - state.startX);
  const upward = state.startY - action.y;
  if (horizontal >= DIRECTION_SLOP && horizontal > Math.abs(upward)) {
    return initialUnlockState;
  }

  if (action.type === 'end') {
    return upward >= UNLOCK_DISTANCE && upward >= horizontal
      ? { status: 'unlocked' }
      : initialUnlockState;
  }

  return { ...state, offset: Math.min(MAX_DRAG_OFFSET, Math.max(0, upward)) };
}
