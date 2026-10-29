import { useEffect, useRef } from 'react';
import { createRingtonePlayer } from './ringtone';

type Tone = 'majima' | 'other';
const sources: Record<Tone, string> = {
  majima: 'majima-ringtone.m4a',
  // Existing message receipt sound reused for other callers; not an iPhone call-ringtone claim.
  other: 'iphone-note.wav',
};
export function useRingtone(
  ringing: boolean,
  silent: boolean,
  volume: number,
  tone: Tone = 'majima',
) {
  const players = useRef<Partial<Record<Tone, ReturnType<typeof createRingtonePlayer>>>>({});
  useEffect(() => {
    const current = Object.fromEntries(
      Object.entries(sources).map(([name, source]) => {
        const audio = new Audio(`${import.meta.env.BASE_URL}audio/${source}`);
        audio.preload = 'auto';
        return [name, createRingtonePlayer(audio)];
      }),
    ) as Record<Tone, ReturnType<typeof createRingtonePlayer>>;
    players.current = current;
    // Prepare both sounds during real user activation, before a scheduled incoming call.
    const activate = () => Object.values(current).forEach((player) => player.activate());
    const visibility = () =>
      Object.values(current).forEach((player) => player.setVisible(!document.hidden));
    visibility();
    document.addEventListener('pointerup', activate, true);
    document.addEventListener('keydown', activate, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerup', activate, true);
      document.removeEventListener('keydown', activate, true);
      document.removeEventListener('visibilitychange', visibility);
      Object.values(current).forEach((player) => player.dispose());
      players.current = {};
    };
  }, []);
  useEffect(() => {
    for (const [name, player] of Object.entries(players.current))
      player.update({ ringing: ringing && name === tone, silent, volume });
  }, [ringing, silent, volume, tone]);
}
