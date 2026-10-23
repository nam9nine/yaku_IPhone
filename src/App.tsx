import { useEffect, useReducer } from 'react';
import { MobileShell } from './components/MobileShell';
import { LockScreen } from './lock/LockScreen';
import { HomeScreen } from './home/HomeScreen';
import { AppWindow } from './shell/AppWindow';
import { initialShellState, shellReducer } from './shell/session';

export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  useEffect(() => {
    if (state.locked || state.activeApp) return;
    const frame = requestAnimationFrame(() => {
      const launcher = state.launcher
        ? document.querySelector<HTMLElement>(`[data-launch-app="${state.launcher}"]`)
        : null;
      const target =
        launcher && !launcher.closest('[inert], [hidden]')
          ? launcher
          : document.querySelector<HTMLElement>('[data-home-title]');
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.locked, state.activeApp, state.launcher]);
  return (
    <MobileShell foreground={state.locked}>
      {state.locked && (
        <LockScreen onUnlock={() => dispatch({ type: 'unlock' })} autoFocus={state.hasUnlocked} />
      )}
      {state.hasUnlocked && (
        <div
          hidden={state.locked}
          inert={state.locked || !!state.activeApp}
          aria-hidden={state.locked || !!state.activeApp}
        >
          <HomeScreen
            onLock={() => dispatch({ type: 'lock' })}
            onOpenApp={(app, origin) => dispatch({ type: 'open', app, origin })}
          />
        </div>
      )}
      {state.visited.map((app) => (
        <AppWindow
          key={app}
          app={app}
          active={!state.locked && state.activeApp === app}
          origin={state.activeApp === app ? state.origin : null}
          onHome={() => dispatch({ type: 'home' })}
        >
          <div className="app-preview">
            <h1 data-app-title tabIndex={-1}>
              {app === 'settings' ? '설정' : 'Safari'}
            </h1>
            <div className="app-preview-card">
              <p>
                {app === 'settings'
                  ? '설정 화면을 준비하고 있어요.'
                  : 'Safari 화면을 준비하고 있어요.'}
              </p>
              <p>아래에서 위로 밀면 홈으로 돌아갑니다.</p>
            </div>
          </div>
        </AppWindow>
      ))}
    </MobileShell>
  );
}
