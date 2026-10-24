import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiMessenger } from './messenger';

export function useAiMessenger(online: boolean) {
  const [messenger] = useState(() => new AiMessenger());
  const snapshot = useSyncExternalStore(messenger.subscribe, messenger.getSnapshot);
  useEffect(() => {
    messenger.setOnline(online);
  }, [messenger, online]);
  useEffect(() => {
    void messenger.refresh();
    return messenger.stop;
  }, [messenger]);
  return { ...snapshot, messenger };
}
