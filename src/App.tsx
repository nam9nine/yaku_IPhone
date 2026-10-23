import { useEffect, useReducer } from 'react';
import { MobileShell } from './components/MobileShell';
import { LockScreen } from './lock/LockScreen';
import { HomeScreen } from './home/HomeScreen';
import { AppWindow } from './shell/AppWindow';
import { initialShellState, shellReducer } from './shell/session';
import { SettingsApp } from './settings/SettingsApp';
import { useDevicePreferences } from './settings/useDevicePreferences';
import { useAppearance } from './shell/useAppearance';
import { SafariApp } from './safari/SafariApp';
import { isOnline } from './settings/preferences';
import './shell/appearance.css';

export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const { preferences, setPreferences, storageUnavailable } = useDevicePreferences();
  const appearance = useAppearance(preferences);
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
    <MobileShell foreground={state.locked} preferences={preferences} appearance={appearance}>
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
          {app === 'settings' ? (
            <SettingsApp
              preferences={preferences}
              onChange={setPreferences}
              active={!state.locked && state.activeApp === app}
              storageUnavailable={storageUnavailable}
            />
          ) : (
            <SafariApp
              online={isOnline(preferences)}
              active={!state.locked && state.activeApp === app}
            />
          )}
        </AppWindow>
      ))}
    </MobileShell>
  );
}
