import { describe, expect, it } from 'vitest';
import { initialPasscodeState, passcodeReducer, type PasscodeState } from './passcode';

function enter(code: string, start: PasscodeState = initialPasscodeState) {
  return [...code].reduce(
    (state, digit) => passcodeReducer(state, { type: 'digit', digit }),
    start,
  );
}

describe('암호 입력 수명주기', () => {
  it('네 자리 모두 맞은 뒤에만 잠금 해제하며 반복 입력을 무시한다', () => {
    const partial = enter('122');
    expect(partial.status).toBe('entering');
    const complete = enter('5', partial);
    expect(complete.status).toBe('unlocked');
    expect(passcodeReducer(complete, { type: 'digit', digit: '5' })).toBe(complete);
    expect(passcodeReducer(complete, { type: 'cancel' })).toBe(complete);
  });

  it('틀린 네 자리 뒤에 입력을 비우고 새로운 정답을 허용한다', () => {
    const incorrect = enter('1234');
    expect(incorrect).toMatchObject({ digits: '', error: true, attempts: 1, status: 'entering' });
    expect(enter('1225', incorrect)).toMatchObject({ error: false, status: 'unlocked' });
  });

  it('삭제한 자리부터 다시 입력할 수 있다', () => {
    const corrected = passcodeReducer(enter('129'), { type: 'delete' });
    expect(corrected.digits).toBe('12');
    expect(enter('25', corrected).status).toBe('unlocked');
  });

  it('취소는 입력을 지우고 늦게 도착한 키 입력으로 해제되지 않는다', () => {
    const cancelled = passcodeReducer(enter('122'), { type: 'cancel' });
    expect(cancelled).toMatchObject({ digits: '', status: 'cancelled' });
    expect(enter('5', cancelled)).toBe(cancelled);
  });

  it('한 번에 여러 문자나 숫자가 아닌 입력은 받지 않는다', () => {
    for (const digit of ['12', 'a', '', '-1'])
      expect(passcodeReducer(initialPasscodeState, { type: 'digit', digit })).toBe(
        initialPasscodeState,
      );
  });
});
