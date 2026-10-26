import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiMessenger } from './messenger';
import type { AiCharacter } from './client';
import { AI_RESET_EVENT, AI_RESET_KEY } from './connection';

export function useAiMessenger(online: boolean, character: AiCharacter | null, active: boolean) {
  const [messenger] = useState(() => new AiMessenger());
  const snapshot = useSyncExternalStore(messenger.subscribe, messenger.getSnapshot);
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
    const visibility = () => messenger.setVisible(active && !document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [messenger, active]);
  useEffect(() => messenger.stop, [messenger]);
  return { ...snapshot, messenger };
}
