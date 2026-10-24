export interface PasscodeState {
  digits: string;
  attempts: number;
  status: 'entering' | 'unlocked' | 'cancelled';
  error: boolean;
}

export type PasscodeAction =
  { type: 'digit'; digit: string } | { type: 'delete' } | { type: 'cancel' };

export const initialPasscodeState: PasscodeState = {
  digits: '',
  attempts: 0,
  status: 'entering',
  error: false,
};

// This is the phone experience's fixed code, not an authentication boundary.
export function passcodeReducer(state: PasscodeState, action: PasscodeAction): PasscodeState {
  if (state.status !== 'entering') return state;
  if (action.type === 'cancel') return { ...state, digits: '', status: 'cancelled' };
  if (action.type === 'delete')
    return { ...state, digits: state.digits.slice(0, -1), error: false };
  if (!/^[0-9]$/.test(action.digit)) return state;
  const digits = state.digits + action.digit;
  if (digits.length < 4) return { ...state, digits, error: false };
  return digits === '1225'
    ? { ...state, digits, status: 'unlocked', error: false }
    : { ...state, digits: '', attempts: state.attempts + 1, error: true };
}
