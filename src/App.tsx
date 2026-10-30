import { useEffect, useLayoutEffect, useReducer, useState } from 'react';
import { MobileShell } from './components/MobileShell';
import { LockScreen } from './lock/LockScreen';
import { PasscodeScreen } from './lock/PasscodeScreen';
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
import { defaultPreferences, isOnline, type DevicePreferences } from './settings/preferences';
import { SystemEdges, HomeGestures } from './system/SystemEdges';
import type { TopPanel } from './system/useTopPull';
import { SystemPanels } from './system/SystemPanels';
import './shell/appearance.css';
import { ContactsApp } from './story/ContactsApp';
import { MessagesApp } from './story/MessagesApp';
import { NotesApp } from './story/NotesApp';
import { PhotosApp } from './story/PhotosApp';
import { PhoneApp } from './story/PhoneApp';
import { DayProvider, useDay } from './day/DayContext';
import { RemindersApp } from './day/RemindersApp';
import { CalendarApp } from './day/CalendarApp';
import { MusicApp, TaxiApp, CookingApp } from './lifestyle/LifestyleApps';
import { DayCall } from './components/DayCall';
import { DayNotification } from './components/DayNotification';
import { StoryReplyNotifications, StoryNotificationList } from './day/StoryReplyNotifications';
import { resetStoryStorage } from './story/useStoredState';
import { consumeNotificationLink, disablePush, registerPushWorker } from './ai/push';
import { resetAiConnection } from './ai/connection';
import { usePushPresence } from './ai/usePushPresence';
import { useAiMessenger } from './ai/useAiMessenger';
import { useCallFollowups } from './ai/useCallFollowups';
import { isAiCharacter } from './ai/client';
import { AiReplyBanner, AiReplyNotifications, AiReplySound } from './ai/ReplyNotifications';

const getPreview = (app: RunnableApp) =>
  document.querySelector<HTMLElement>(`[data-app-window="${app}"]`);

export function App() {
  return (
    <DayProvider>
      <PhoneSession />
    </DayProvider>
  );
}

function PhoneSession() {
  const day = useDay();
  const [epoch, setEpoch] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [phoneEntry, setPhoneEntry] = useState(0);
  const [notificationEntry] = useState(() => {
    const value = new URLSearchParams(location.search).get('conversation');
    return isAiCharacter(value ?? undefined) ? value : null;
  });
  const [conversation, setConversation] = useState<string | null>(notificationEntry);
  const [messageEntry, setMessageEntry] = useState(0);
  const [controls, setControls] = useState({ volume: 50, rotation: false, silent: false });
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const [unlockRequest, setUnlockRequest] = useState<{
    app: RunnableApp | null;
    origin: LaunchRect | null;
  } | null>(notificationEntry ? { app: 'messages', origin: null } : null);
  const { preferences, setPreferences, storageUnavailable } = useDevicePreferences();
  const callCharacter =
    day.state.call?.phase === 'connected' && isAiCharacter(day.state.call.caller)
      ? day.state.call.caller
      : null;
  const ai = useAiMessenger(
    isOnline(preferences),
    callCharacter ??
      (isAiCharacter(conversation ?? undefined) ? (conversation as 'haruka' | 'majima') : null),
    !!callCharacter ||
      (!state.locked && state.activeApp === 'messages' && !state.panel && !day.state.call),
  );
  useCallFollowups(ai, isOnline(preferences));
  const inConversation =
    !state.locked &&
    state.activeApp === 'messages' &&
    !!conversation &&
    !state.panel &&
    !day.state.call;
  usePushPresence(ai.connection, inConversation || !!callCharacter, ai.arrival);
  const appearance = useAppearance(preferences);
  const viewport = useViewport();
  const [topPull, setTopPull] = useState<TopPanel | null>(null);
  const [switcherEntry, setSwitcherEntry] = useState<LaunchRect | null>(null);
  const showPanel = (panel: SystemPanel, entry?: LaunchRect) => {
    setTopPull(null);
    setSwitcherEntry(entry ?? null);
    dispatch({ type: 'panel', panel });
  };
  function openApp(app: RunnableApp, entry?: LaunchRect) {
    const rect = document
      .querySelector(`[data-launch-app="${app}"] .app-icon`)
      ?.getBoundingClientRect();
    if (state.locked) {
      setUnlockRequest({ app, origin: entry ?? null });
      return;
    }
    dispatch({
      type: 'open',
      app,
      origin:
        entry ?? (rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null),
    });
  }
  function finishUnlock() {
    if (!unlockRequest) return;
    dispatch({ type: 'unlock' });
    if (unlockRequest.app)
      dispatch({ type: 'open', app: unlockRequest.app, origin: unlockRequest.origin });
    setUnlockRequest(null);
  }
  function openNote(id: string) {
    setNote(id);
    openApp('notes');
  }
  function openPhone() {
    setPhoneEntry((value) => value + 1);
    openApp('phone');
  }
  function openConversation(id: string) {
    setMessageEntry((value) => value + 1);
    setConversation(id);
    openApp('messages');
  }
  function openHaruka() {
    openConversation('haruka');
  }
  async function resetPhone() {
    if (!(await disablePush(ai.connection, true))) return false;
    if (!resetAiConnection()) return false;
    setUnlockRequest(null);
    day.reset();
    resetStoryStorage();
    setPreferences({ ...defaultPreferences });
    setConversation(null);
    setNote(null);
    setPhoto(null);
    for (const app of state.visited) dispatch({ type: 'close-app', app });
    dispatch({ type: 'lock' });
    setEpoch((value) => value + 1);
    return true;
  }
  useEffect(() => {
    void registerPushWorker().catch(() => {});
    consumeNotificationLink();
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onPush = (event: MessageEvent) => {
      if (
        event.data?.type === 'chat.reply' &&
        isAiCharacter(event.data.character) &&
        !document.hidden &&
        ai.connection
      )
        void ai.messenger.receivePush(event.data.character);
    };
    navigator.serviceWorker.addEventListener('message', onPush);
    return () => navigator.serviceWorker.removeEventListener('message', onPush);
  }, [ai.connection, ai.messenger, state.locked, state.activeApp, conversation]);
  useLayoutEffect(() => {
    if (state.locked || state.activeApp || state.panel) return;
    // Restore within the visibility commit so a later user focus is never
    // overwritten by a queued animation frame.
    const launcher = state.launcher
      ? document.querySelector<HTMLElement>(`[data-launch-app="${state.launcher}"]`)
      : null;
    const target =
      launcher && !launcher.closest('[inert], [hidden]')
        ? launcher
        : document.querySelector<HTMLElement>('[data-home-title]');
    target?.focus({ preventScroll: true });
  }, [state.locked, state.activeApp, state.launcher, state.panel]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (document.querySelector('.day-call[open], .lock-weather[open], .passcode-screen[open]'))
        return;
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
    <MobileShell
      foreground={state.locked}
      preferences={preferences}
      appearance={appearance}
      appVisible={!state.locked && !!state.activeApp && !state.panel}
    >
      <div className="base-screens" inert={Boolean(state.panel)} aria-hidden={Boolean(state.panel)}>
        {state.locked && (
          <LockScreen
            active={!state.panel && !unlockRequest}
            onUnlock={() => setUnlockRequest({ app: null, origin: null })}
            autoFocus={state.hasUnlocked}
            onMessage={openHaruka}
            onCall={openPhone}
            onCalendar={() => openApp('calendar')}
            onReminders={() => openApp('reminders')}
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
              key={epoch}
              aiUnread={Object.keys(ai.threads).filter(
                (id) => ai.threads[id as 'haruka' | 'majima'].unread,
              )}
              active={!state.locked && !state.activeApp && !state.panel}
              onLock={() => dispatch({ type: 'lock' })}
              onOpenApp={(app, origin) => dispatch({ type: 'open', app, origin })}
              onSearch={() => showPanel('search')}
              onControl={() => showPanel('control')}
              onSwitcher={() => showPanel('switcher')}
              onPhoto={(id) => {
                setPhoto(id);
                openApp('photos');
              }}
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
          key={`${epoch}-${app}`}
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
              storageUnavailable={storageUnavailable || day.storageUnavailable}
              onReset={resetPhone}
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
              ai={ai}
              active={!state.locked && state.activeApp === app && !state.panel && !day.state.call}
              selected={conversation}
              requestedLatest={messageEntry}
              onSelect={setConversation}
              online={isOnline(preferences)}
              onOpenNote={openNote}
            />
          ) : app === 'notes' ? (
            <NotesApp
              active={!state.locked && state.activeApp === app && !state.panel}
              selected={note}
              onSelect={setNote}
            />
          ) : app === 'reminders' ? (
            <RemindersApp
              active={!state.locked && state.activeApp === app && !state.panel}
              onOpenNote={openNote}
            />
          ) : app === 'calendar' ? (
            <CalendarApp
              active={!state.locked && state.activeApp === app && !state.panel}
              onOpenNote={openNote}
            />
          ) : app === 'music' ? (
            <MusicApp active={!state.locked && state.activeApp === app && !state.panel} />
          ) : app === 'taxi' ? (
            <TaxiApp active={!state.locked && state.activeApp === app && !state.panel} />
          ) : app === 'cooking' ? (
            <CookingApp
              active={!state.locked && state.activeApp === app && !state.panel}
              onOpenNote={openNote}
            />
          ) : app === 'phone' ? (
            <PhoneApp
              requestedRecent={phoneEntry}
              active={!state.locked && state.activeApp === app && !state.panel}
              onMessage={(id) => {
                setConversation(id);
                openApp('messages');
              }}
            />
          ) : (
            <PhotosApp
              active={!state.locked && state.activeApp === app && !state.panel}
              selected={photo}
              onSelect={setPhoto}
              onWallpaper={(id) =>
                setPreferences({ ...preferences, wallpaper: id as DevicePreferences['wallpaper'] })
              }
            />
          )}
        </AppWindow>
      ))}
      {!state.panel && !unlockRequest && (
        <SystemEdges
          onPreview={setTopPull}
          active
          onControl={() => showPanel('control')}
          onNotifications={() => showPanel('notifications')}
        />
      )}
      {(state.panel || topPull) && (
        <SystemPanels
          preview={!!topPull}
          controls={controls}
          onControls={setControls}
          kind={(state.panel || topPull)!}
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
          notifications={
            <>
              <AiReplyNotifications replies={ai.unreadReplies} onOpen={openConversation} />
              <StoryNotificationList onOpen={openConversation} />
              <DayNotification onOpen={openHaruka} onCall={openPhone} />
            </>
          }
        />
      )}
      <AiReplySound
        arrival={ai.arrival}
        silent={controls.silent || !!callCharacter}
        volume={controls.volume}
        activeCharacter={
          !state.locked && state.activeApp === 'messages' && !state.panel ? conversation : null
        }
      />
      <AiReplyBanner
        notification={ai.notification}
        onOpen={openConversation}
        onDismiss={ai.messenger.dismissNotification}
        inConversation={inConversation || !!callCharacter}
        obscured={!!unlockRequest || state.panel === 'notifications'}
      />
      <StoryReplyNotifications
        key={`story-replies-${epoch}`}
        onOpen={openConversation}
        inConversation={inConversation || !!callCharacter}
        activeCharacter={inConversation ? conversation : null}
        obscured={
          !!unlockRequest ||
          state.panel === 'notifications' ||
          !!ai.notification ||
          !!day.state.call
        }
        silent={controls.silent}
        volume={controls.volume}
      />
      <DayCall
        ai={ai}
        silent={controls.silent}
        volume={controls.volume}
        preferences={preferences}
        key={epoch}
        locked={state.locked}
        active={
          !state.locked &&
          !unlockRequest &&
          !Object.values(ai.threads).some(
            (thread) =>
              thread.deliveryPending || (!!thread.pending && thread.pending.phase !== 'failed'),
          )
        }
        onMessage={openConversation}
      />
      {unlockRequest && (
        <PasscodeScreen
          preferences={preferences}
          onSuccess={finishUnlock}
          onCancel={() => setUnlockRequest(null)}
        />
      )}
    </MobileShell>
  );
}
