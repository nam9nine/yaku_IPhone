import { useEffect, useReducer } from 'react';
import { MobileShell } from './components/MobileShell';
import { LockScreen } from './lock/LockScreen';
import { HomeScreen } from './home/HomeScreen';
import { AppWindow } from './shell/AppWindow';
import {
  initialShellState,
  shellReducer,
  type RunnableApp,
  type SystemPanel,
} from './shell/session';
import { SettingsApp } from './settings/SettingsApp';
import { useDevicePreferences } from './settings/useDevicePreferences';
import { useAppearance } from './shell/useAppearance';
import { useViewport } from './shell/useViewport';
import { SafariApp } from './safari/SafariApp';
import { isOnline } from './settings/preferences';
import { SystemEdges, HomeGestures } from './system/SystemEdges';
import { SystemPanels } from './system/SystemPanels';
import './shell/appearance.css';

export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const { preferences, setPreferences, storageUnavailable } = useDevicePreferences();
  const appearance = useAppearance(preferences);
  const viewport = useViewport();
  const showPanel = (panel: SystemPanel) => dispatch({ type: 'panel', panel });
  function openApp(app: RunnableApp) {
    const rect = document
      .querySelector(`[data-launch-app="${app}"] .app-icon`)
      ?.getBoundingClientRect();
    dispatch({
      type: 'open',
      app,
      origin: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    });
  }
  useEffect(() => {
    if (state.locked || state.activeApp || state.panel) return;
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
  }, [state.locked, state.activeApp, state.launcher, state.panel]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (state.panel) return;
      if (event.altKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        dispatch({ type: 'panel', panel: 'control' });
      }
      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        dispatch({ type: 'panel', panel: 'notifications' });
      }
      if (!state.locked && !state.activeApp && event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        dispatch({ type: 'panel', panel: 'search' });
      }
      if (!state.locked && event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        dispatch({ type: 'panel', panel: 'switcher' });
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [state.locked, state.panel, state.activeApp]);
  return (
    <MobileShell foreground={state.locked} preferences={preferences} appearance={appearance}>
      <div className="base-screens" inert={Boolean(state.panel)} aria-hidden={Boolean(state.panel)}>
        {state.locked && (
          <LockScreen
            active={!state.panel}
            onUnlock={() => dispatch({ type: 'unlock' })}
            autoFocus={state.hasUnlocked}
          />
        )}
        {state.hasUnlocked && (
          <div
            className="home-layer"
            hidden={state.locked}
            inert={state.locked || !!state.activeApp}
            aria-hidden={state.locked || !!state.activeApp}
          >
            <HomeScreen
              active={!state.locked && !state.activeApp && !state.panel}
              onLock={() => dispatch({ type: 'lock' })}
              onOpenApp={(app, origin) => dispatch({ type: 'open', app, origin })}
              onSearch={() => showPanel('search')}
              onControl={() => showPanel('control')}
              onSwitcher={() => showPanel('switcher')}
            />
            <HomeGestures
              active={!state.locked && !state.activeApp && !state.panel}
              onHome={() => dispatch({ type: 'home' })}
              onSwitcher={() => showPanel('switcher')}
              onQuickSwitch={(direction) => dispatch({ type: 'quick-switch', direction })}
            />
          </div>
        )}
      </div>
      {state.visited.map((app) => (
        <AppWindow
          key={app}
          app={app}
          active={!state.locked && state.activeApp === app}
          interactive={!state.locked && state.activeApp === app && !state.panel}
          origin={state.activeApp === app ? state.origin : null}
          onHome={() => dispatch({ type: 'home' })}
          onControl={() => showPanel('control')}
          onSwitcher={() => showPanel('switcher')}
          onQuickSwitch={(direction) => dispatch({ type: 'quick-switch', direction })}
        >
          {app === 'settings' ? (
            <SettingsApp
              preferences={preferences}
              onChange={setPreferences}
              active={!state.locked && state.activeApp === app && !state.panel}
              storageUnavailable={storageUnavailable}
            />
          ) : (
            <SafariApp
              online={isOnline(preferences)}
              active={!state.locked && state.activeApp === app && !state.panel}
            />
          )}
        </AppWindow>
      ))}
      {!state.panel && (
        <SystemEdges
          active
          onControl={() => showPanel('control')}
          onNotifications={() => showPanel('notifications')}
        />
      )}
      {state.panel && (
        <SystemPanels
          kind={state.panel}
          recent={state.visited}
          activeApp={state.activeApp}
          preferences={preferences}
          onPreferences={setPreferences}
          onSelectApp={openApp}
          onCloseApp={(app) => dispatch({ type: 'close-app', app })}
          onDismiss={() => dispatch({ type: 'dismiss-panel' })}
          getPreview={(app) => document.querySelector<HTMLElement>(`[data-app-window="${app}"]`)}
          viewport={viewport}
        />
      )}
    </MobileShell>
  );
}
