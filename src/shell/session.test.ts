import { describe, expect, it } from 'vitest';
import { initialShellState, shellReducer } from './session';
import { homeDrag } from './homeGesture';

const open = {
  type: 'open' as const,
  app: 'settings' as const,
  origin: { x: 240, y: 300, width: 60, height: 60 },
};
describe('앱 세션과 홈 제스처', () => {
  it('잠긴 상태의 앱 실행을 막고 반복 실행으로 시작점을 바꾸지 않는다', () => {
    expect(shellReducer(initialShellState, open)).toBe(initialShellState);
    const active = shellReducer(shellReducer(initialShellState, { type: 'unlock' }), open);
    expect(active.locked).toBe(false);
    expect(active.activeApp).toBe('settings');
    expect(shellReducer(active, { ...open, app: 'safari' })).toBe(active);
  });
  it('홈 복귀와 재잠금은 방문한 앱과 실행 아이콘을 보존한다', () => {
    const active = shellReducer(shellReducer(initialShellState, { type: 'unlock' }), open);
    const home = shellReducer(active, { type: 'home' });
    expect(home.activeApp).toBeNull();
    expect(home.launcher).toBe('settings');
    const again = shellReducer(home, open);
    expect(again.visited).toEqual(['settings']);
    expect(shellReducer(again, { type: 'lock' })).toMatchObject({
      locked: true,
      activeApp: null,
      visited: ['settings'],
    });
  });
  it('짧은 이동·아래 방향은 취소하고 수평 우세는 홈으로 해석하지 않는다', () => {
    const start = { pointerId: 1, startX: 100, startY: 600 };
    expect(homeDrag(start, 100, 530).complete).toBe(false);
    expect(homeDrag(start, 100, 650).offset).toBe(0);
    expect(homeDrag(start, 230, 500)).toMatchObject({ cancelled: true, complete: false });
    expect(homeDrag(start, 105, 500)).toMatchObject({ cancelled: false, complete: true });
  });
});
