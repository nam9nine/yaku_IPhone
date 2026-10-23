import { useEffect, useReducer, useState } from 'react';
import { MobileShell } from './components/MobileShell';
import { LockScreen } from './lock/LockScreen';
import { HomeScreen } from './home/HomeScreen';
import { AppWindow } from './shell/AppWindow';
import {
  initialShellState,
  shellReducer,
  type RunnableApp,
  type SystemPanel,
  type LaunchRect,
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
import { ContactsApp } from './story/ContactsApp';
import { MessagesApp } from './story/MessagesApp';
import { NotesApp } from './story/NotesApp';
import { PhotosApp } from './story/PhotosApp';

const getPreview = (app: RunnableApp) =>
  document.querySelector<HTMLElement>(`[data-app-window="${app}"]`);

export function App() {
  const [conversation, setConversation] = useState<string | null>(null);
  const [controls, setControls] = useState({ volume: 50, rotation: false, silent: false });
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const { preferences, setPreferences, storageUnavailable } = useDevicePreferences();
  const appearance = useAppearance(preferences);
  const viewport = useViewport();
  const [switcherEntry, setSwitcherEntry] = useState<LaunchRect | null>(null);
  const showPanel = (panel: SystemPanel, entry?: LaunchRect) => {
    setSwitcherEntry(entry ?? null);
    dispatch({ type: 'panel', panel });
  };
  function openApp(app: RunnableApp, entry?: LaunchRect) {
    const rect = document
      .querySelector(`[data-launch-app="${app}"] .app-icon`)
      ?.getBoundingClientRect();
    dispatch({
      type: 'open',
      app,
      origin:
        entry ?? (rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null),
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
        showPanel('control');
      }
      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        showPanel('notifications');
      }
      if (!state.locked && !state.activeApp && event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        showPanel('search');
      }
      if (!state.locked && event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        showPanel(
          'switcher',
          state.activeApp ? getPreview(state.activeApp)?.getBoundingClientRect() : undefined,
        );
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
          parked={state.panel === 'switcher'}
          previousApp={state.visited.find((candidate) => candidate !== app)}
          origin={state.activeApp === app ? state.origin : null}
          onHome={() => dispatch({ type: 'home' })}
          onControl={() => showPanel('control')}
          onSwitcher={(entry) => showPanel('switcher', entry)}
          onQuickSwitch={(direction) => dispatch({ type: 'quick-switch', direction })}
        >
          {app === 'settings' ? (
            <SettingsApp
              preferences={preferences}
              onChange={setPreferences}
              active={!state.locked && state.activeApp === app && !state.panel}
              storageUnavailable={storageUnavailable}
            />
          ) : app === 'safari' ? (
            <SafariApp
              online={isOnline(preferences)}
              active={!state.locked && state.activeApp === app && !state.panel}
            />
          ) : app === 'contacts' ? (
            <ContactsApp
              active={!state.locked && state.activeApp === app && !state.panel}
              onMessage={(id) => {
                setConversation(id);
                openApp('messages');
              }}
            />
          ) : app === 'messages' ? (
            <MessagesApp
              active={!state.locked && state.activeApp === app && !state.panel}
              selected={conversation}
              onSelect={setConversation}
              online={isOnline(preferences)}
            />
          ) : app === 'notes' ? (
            <NotesApp active={!state.locked && state.activeApp === app && !state.panel} />
          ) : (
            <PhotosApp active={!state.locked && state.activeApp === app && !state.panel} />
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
          controls={controls}
          onControls={setControls}
          kind={state.panel}
          recent={state.visited}
          activeApp={state.activeApp}
          entry={switcherEntry}
          preferences={preferences}
          onPreferences={setPreferences}
          onSelectApp={openApp}
          onCloseApp={(app) => dispatch({ type: 'close-app', app })}
          onDismiss={() =>
            dispatch({ type: state.panel === 'switcher' ? 'home' : 'dismiss-panel' })
          }
          getPreview={getPreview}
          viewport={viewport}
        />
      )}
    </MobileShell>
  );
}
