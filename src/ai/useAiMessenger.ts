import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiMessenger } from './messenger';
import type { AiCharacter } from './client';

export function useAiMessenger(online: boolean, character: AiCharacter | null, active: boolean) {
  const [messenger] = useState(() => new AiMessenger());
  const snapshot = useSyncExternalStore(messenger.subscribe, messenger.getSnapshot);
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
