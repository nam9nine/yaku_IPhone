import { useLayoutEffect, useRef, useState } from 'react';
import { initialPasscodeState, passcodeReducer, type PasscodeAction } from './passcode';
import './passcode.css';
import { StatusBar } from '../components/StatusBar';
import type { DevicePreferences } from '../settings/preferences';

const keys = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['0', ''],
];

export function PasscodeScreen({
  onSuccess,
  onCancel,
  preferences,
}: {
  onSuccess: () => void;
  onCancel: () => void;
  preferences: DevicePreferences;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef(initialPasscodeState);
  const [state, setState] = useState(initialPasscodeState);

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLButtonElement>('[data-passcode-digit]')?.focus();
    return () => element.close();
  }, []);

  function transition(action: PasscodeAction) {
    const previous = current.current;
    const next = passcodeReducer(previous, action);
    if (previous === next) return;
    // A synchronous guard prevents batched input from delivering success twice.
    current.current = next;
    setState(next);
    if (next.status === 'unlocked') onSuccess();
    else if (next.status === 'cancelled') onCancel();
  }

  return (
    <dialog
      ref={dialog}
      className="passcode-screen"
      data-testid="passcode-screen"
      aria-labelledby="passcode-title"
      aria-describedby="passcode-feedback"
      onCancel={(event) => {
        event.preventDefault();
        transition({ type: 'cancel' });
      }}
      onKeyDown={(event) => {
        // Keep shell shortcuts behind the modal just like pointer input.
        event.stopPropagation();
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault();
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          return;
        }
        if (event.altKey || event.metaKey || event.ctrlKey || event.repeat) return;
        if (/^[0-9]$/.test(event.key)) {
          event.preventDefault();
          transition({ type: 'digit', digit: event.key });
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          transition({ type: 'delete' });
        } else if (event.key === 'Escape') {
          event.preventDefault();
          transition({ type: 'cancel' });
        }
      }}
    >
      <StatusBar preferences={preferences} appVisible={false} />
      <div className="passcode-content">
        <h1 id="passcode-title">암호 입력</h1>
        <div
          key={state.attempts}
          className={`passcode-dots${state.error ? ' passcode-error' : ''}`}
          role="img"
          aria-label={`암호 ${state.digits.length}자리 입력됨`}
        >
          {[0, 1, 2, 3].map((index) => (
            <span key={index} data-filled={index < state.digits.length} />
          ))}
        </div>
        <p id="passcode-feedback" className="passcode-feedback" role="status" aria-live="polite">
          {state.error ? '암호가 올바르지 않습니다.' : ''}
        </p>
        <div className="passcode-keypad" aria-label="암호 숫자판">
          {keys.map(([digit, letters]) => (
            <button
              key={digit}
              className="passcode-key"
              data-passcode-digit={digit}
              aria-label={digit}
              onClick={() => transition({ type: 'digit', digit })}
            >
              <span aria-hidden="true">{digit}</span>
              <small aria-hidden="true">{letters || '\u00a0'}</small>
            </button>
          ))}
        </div>
        <div className="passcode-actions">
          <button onClick={() => transition({ type: 'cancel' })}>취소</button>
          <button onClick={() => transition({ type: 'delete' })} aria-label="암호 한 자리 지우기">
            지우기
          </button>
        </div>
      </div>
    </dialog>
  );
}
