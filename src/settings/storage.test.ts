import { describe, expect, it } from 'vitest';
import { defaultPreferences } from './preferences';
import {
  loadPreferences,
  PREFERENCES_KEY,
  savePreferences,
  type PreferencesStorage,
} from './storage';

function memoryStorage(initial = new Map<string, string>()): PreferencesStorage {
  return {
    getItem: (key) => initial.get(key) ?? null,
    setItem: (key, value) => {
      initial.set(key, value);
    },
  };
}

describe('preference storage', () => {
  it('restores valid settings and leaves other origin storage untouched', () => {
    const values = new Map([['another-project', 'keep']]);
    const storage = memoryStorage(values);
    const preferences = { ...defaultPreferences, brightness: 60, wifi: false };
    expect(savePreferences(preferences, () => storage)).toBe(true);
    expect(loadPreferences(() => storage)).toEqual({ preferences, storageUnavailable: false });
    expect(values.get('another-project')).toBe('keep');
    expect([...values.keys()]).toEqual(['another-project', PREFERENCES_KEY]);
  });

  it.each([
    '{broken',
    'null',
    '[]',
    '{"version":2}',
    JSON.stringify({ version: 1, preferences: { ...defaultPreferences, brightness: 0 } }),
  ])('recovers defaults for corrupted/unsupported storage: %s', (raw) => {
    const storage = memoryStorage(new Map([[PREFERENCES_KEY, raw]]));
    expect(loadPreferences(() => storage)).toEqual({
      preferences: defaultPreferences,
      storageUnavailable: false,
    });
  });

  it('keeps defaults usable when accessing storage is denied', () => {
    expect(
      loadPreferences(() => {
        throw new Error('denied');
      }),
    ).toEqual({ preferences: defaultPreferences, storageUnavailable: true });
  });

  it('reports quota failure without mutating the supplied in-memory choice', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    const preferences = { ...defaultPreferences, brightness: 70 };
    expect(savePreferences(preferences, () => storage)).toBe(false);
    expect(preferences.brightness).toBe(70);
  });
});
