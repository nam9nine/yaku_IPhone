import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiMessenger } from './messenger';
import type { AiCharacter } from './client';
import { AI_RESET_EVENT, AI_RESET_KEY } from './connection';
import { PUSH_SETTINGS_EVENT, readPushBinding, renewPush } from './push';

export function useAiMessenger(online: boolean, character: AiCharacter | null, active: boolean) {
  const [messenger] = useState(() => new AiMessenger());
  const [pushEnabled, setPushEnabled] = useState(false);
  const snapshot = useSyncExternalStore(messenger.subscribe, messenger.getSnapshot);
  useEffect(() => {
    let current = true;
    const check = () => {
      void readPushBinding(snapshot.connection)
        .then((value) => {
          if (current) setPushEnabled(!!value);
        })
        .catch(() => {
          if (current) setPushEnabled(false);
        });
    };
    check();
    if (snapshot.connection) void renewPush(snapshot.connection).catch(() => {});
    window.addEventListener(PUSH_SETTINGS_EVENT, check);
    return () => {
      current = false;
      window.removeEventListener(PUSH_SETTINGS_EVENT, check);
    };
  }, [snapshot.connection]);
  useEffect(() => {
    const localReset = () => messenger.syncReset(false);
    const externalReset = (event: StorageEvent) => {
      if (event.key === AI_RESET_KEY || event.key === null) messenger.syncReset();
    };
    window.addEventListener(AI_RESET_EVENT, localReset);
    window.addEventListener('storage', externalReset);
    return () => {
      window.removeEventListener(AI_RESET_EVENT, localReset);
      window.removeEventListener('storage', externalReset);
    };
  }, [messenger]);
  useEffect(() => {
    messenger.setOnline(online);
  }, [messenger, online]);
  useEffect(() => {
    void messenger.activate(active ? character : null);
  }, [messenger, character, active]);
  useEffect(() => {
    // Home/Settings are still foreground pages. The active character already
    // decides read status; only a genuinely hidden page should slow polling.
    const visibility = () => messenger.setVisible(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [messenger]);
  useEffect(() => {
    messenger.resume();
    return messenger.stop;
  }, [messenger]);
  return { ...snapshot, messenger, pushEnabled };
}

export type AiMessengerView = ReturnType<typeof useAiMessenger>;
