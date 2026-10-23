import { describe, expect, it } from 'vitest';
import { initialShellState, shellReducer } from './session';

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
    expect(shellReducer(active, open)).toBe(active);
    expect(shellReducer(active, { ...open, app: 'safari' }).visited).toEqual([
      'safari',
      'settings',
    ]);
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
});

it('최근 앱의 양방향 빠른 전환은 MRU 갱신과 관계없이 같은 순서를 따른다', () => {
  const unlocked = shellReducer(initialShellState, { type: 'unlock' });
  const settings = shellReducer(unlocked, open);
  const safari = shellReducer(settings, { ...open, app: 'safari' });
  const previous = shellReducer(safari, { type: 'quick-switch', direction: 'previous' });
  expect(previous.activeApp).toBe('settings');
  expect(previous.visited).toEqual(['settings', 'safari']);
  expect(shellReducer(previous, { type: 'quick-switch', direction: 'previous' })).toBe(previous);
  expect(shellReducer(previous, { type: 'quick-switch', direction: 'next' }).activeApp).toBe(
    'safari',
  );
});
it('최근 앱에서 닫기는 해당 세션만 제거하고 잠긴 상태의 최근 앱은 열지 않는다', () => {
  const active = shellReducer(shellReducer(initialShellState, { type: 'unlock' }), open);
  const panel = shellReducer(active, { type: 'panel', panel: 'switcher' });
  expect(shellReducer(panel, { type: 'close-app', app: 'settings' })).toMatchObject({
    visited: [],
    activeApp: null,
    panel: 'switcher',
  });
  expect(shellReducer(initialShellState, { type: 'panel', panel: 'switcher' })).toBe(
    initialShellState,
  );
  expect(shellReducer(initialShellState, { type: 'panel', panel: 'control' }).panel).toBe(
    'control',
  );
  expect(shellReducer(panel, { type: 'quick-switch', direction: 'previous' })).toBe(panel);
});
