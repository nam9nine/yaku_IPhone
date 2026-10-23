import { useLayoutEffect, useSyncExternalStore } from 'react';
import type { DevicePreferences } from '../settings/preferences';

const darkMedia = matchMedia('(prefers-color-scheme: dark)');
const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
const subscribeDark = (changed: () => void) => {
  darkMedia.addEventListener('change', changed);
  return () => darkMedia.removeEventListener('change', changed);
};
const subscribeMotion = (changed: () => void) => {
  motionMedia.addEventListener('change', changed);
  return () => motionMedia.removeEventListener('change', changed);
};

export function useAppearance(preferences: DevicePreferences) {
  const systemDark = useSyncExternalStore(subscribeDark, () => darkMedia.matches);
  const systemReduce = useSyncExternalStore(subscribeMotion, () => motionMedia.matches);
  useLayoutEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = `${preferences.textScale}%`;
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, [preferences.textScale]);
  return {
    theme: preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme,
    reduceMotion: systemReduce || preferences.reduceMotion,
  };
}
