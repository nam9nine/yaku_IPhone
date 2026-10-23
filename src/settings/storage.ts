import { defaultPreferences, parsePreferences, type DevicePreferences } from './preferences';

export const PREFERENCES_KEY = 'yaku-iphone.preferences.v1';
const STORAGE_VERSION = 1;

export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredPreferences {
  preferences: DevicePreferences;
  storageUnavailable: boolean;
}

function browserStorage(): PreferencesStorage {
  return window.localStorage;
}

export function loadPreferences(
  getStorage: () => PreferencesStorage = browserStorage,
): StoredPreferences {
  try {
    const raw = getStorage().getItem(PREFERENCES_KEY);
    if (!raw) return { preferences: { ...defaultPreferences }, storageUnavailable: false };
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      return { preferences: { ...defaultPreferences }, storageUnavailable: false };
    }
    const envelope =
      stored && typeof stored === 'object' && !Array.isArray(stored)
        ? (stored as Record<string, unknown>)
        : null;
    const preferences =
      envelope?.version === STORAGE_VERSION ? parsePreferences(envelope.preferences) : null;
    return { preferences: preferences ?? { ...defaultPreferences }, storageUnavailable: false };
  } catch {
    return { preferences: { ...defaultPreferences }, storageUnavailable: true };
  }
}

export function savePreferences(
  preferences: DevicePreferences,
  getStorage: () => PreferencesStorage = browserStorage,
): boolean {
  try {
    getStorage().setItem(
      PREFERENCES_KEY,
      JSON.stringify({ version: STORAGE_VERSION, preferences }),
    );
    return true;
  } catch {
    return false;
  }
}
