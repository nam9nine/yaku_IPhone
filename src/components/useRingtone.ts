import { useEffect, useRef } from 'react';
import { createRingtonePlayer } from './ringtone';

export function useRingtone(ringing: boolean, silent: boolean, volume: number) {
  const player = useRef<ReturnType<typeof createRingtonePlayer> | null>(null);
  useEffect(() => {
    const audio = new Audio(`${import.meta.env.BASE_URL}audio/majima-ringtone.m4a`);
    audio.preload = 'auto';
    const current = createRingtonePlayer(audio);
    player.current = current;
    const activate = () => current.activate();
    const visibility = () => current.setVisible(!document.hidden);
    visibility();
    document.addEventListener('pointerup', activate, true);
    document.addEventListener('keydown', activate, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerup', activate, true);
      document.removeEventListener('keydown', activate, true);
      document.removeEventListener('visibilitychange', visibility);
      current.dispose();
      player.current = null;
    };
  }, []);
  useEffect(() => {
    player.current?.update({ ringing, silent, volume });
  }, [ringing, silent, volume]);
}
