export interface DevicePreferences {
  airplane: boolean;
  wifi: boolean;
  cellular: boolean;
  bluetooth: boolean;
  theme: 'system' | 'light' | 'dark';
  brightness: number;
  wallpaper: 'default' | 'solid';
  textScale: 100 | 115 | 130;
  reduceMotion: boolean;
}

export const defaultPreferences: DevicePreferences = {
  airplane: false,
  wifi: true,
  cellular: true,
  bluetooth: true,
  theme: 'system',
  brightness: 100,
  wallpaper: 'default',
  textScale: 100,
  reduceMotion: false,
};

export function isOnline(preferences: DevicePreferences) {
  return preferences.wifi || (!preferences.airplane && preferences.cellular);
}

export function setAirplaneMode(
  preferences: DevicePreferences,
  airplane: boolean,
): DevicePreferences {
  if (preferences.airplane === airplane) return preferences;
  return { ...preferences, airplane, wifi: airplane ? false : preferences.wifi };
}

export function parsePreferences(value: unknown): DevicePreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.airplane !== 'boolean' ||
    typeof candidate.wifi !== 'boolean' ||
    typeof candidate.cellular !== 'boolean' ||
    typeof candidate.bluetooth !== 'boolean' ||
    (candidate.theme !== 'system' && candidate.theme !== 'light' && candidate.theme !== 'dark') ||
    typeof candidate.brightness !== 'number' ||
    !Number.isInteger(candidate.brightness) ||
    candidate.brightness < 50 ||
    candidate.brightness > 100 ||
    (candidate.wallpaper !== 'default' && candidate.wallpaper !== 'solid') ||
    (candidate.textScale !== 100 && candidate.textScale !== 115 && candidate.textScale !== 130) ||
    typeof candidate.reduceMotion !== 'boolean'
  )
    return null;
  return {
    airplane: candidate.airplane,
    wifi: candidate.wifi,
    cellular: candidate.cellular,
    bluetooth: candidate.bluetooth,
    theme: candidate.theme as DevicePreferences['theme'],
    brightness: candidate.brightness,
    wallpaper: candidate.wallpaper as DevicePreferences['wallpaper'],
    textScale: candidate.textScale as DevicePreferences['textScale'],
    reduceMotion: candidate.reduceMotion,
  };
}
