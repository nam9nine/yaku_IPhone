import { describe, expect, it } from 'vitest';
import { defaultPreferences, isOnline, parsePreferences, setAirplaneMode } from './preferences';

describe('device preferences', () => {
  it('disables Wi-Fi on airplane entry while preserving the cellular preference', () => {
    const airborne = setAirplaneMode(defaultPreferences, true);
    expect(airborne).toMatchObject({ airplane: true, wifi: false, cellular: true });
    expect(isOnline(airborne)).toBe(false);
    expect(isOnline(setAirplaneMode(airborne, false))).toBe(true);
  });

  it('allows Wi-Fi during airplane mode without reopening cellular access', () => {
    const airborne = { ...setAirplaneMode(defaultPreferences, true), wifi: true };
    expect(isOnline(airborne)).toBe(true);
    expect(setAirplaneMode(airborne, true)).toBe(airborne);
    expect(isOnline({ ...airborne, wifi: false })).toBe(false);
  });

  it('does not enable a cellular preference that was off before airplane mode', () => {
    const offline = { ...defaultPreferences, cellular: false, wifi: false };
    expect(isOnline(setAirplaneMode(setAirplaneMode(offline, true), false))).toBe(false);
    expect(isOnline({ ...offline, bluetooth: true })).toBe(false);
  });

  it('copies only supported fields from valid preferences', () => {
    expect(parsePreferences({ ...defaultPreferences, extra: 'ignored' })).toEqual(
      defaultPreferences,
    );
  });

  it('restores crop positions without requiring them in older settings', () => {
    const positions = { default: { x: 25, y: 70 }, sea: { x: 50, y: 45 } };
    expect(
      parsePreferences({ ...defaultPreferences, wallpaper: 'sea', wallpaperPositions: positions }),
    ).toMatchObject({ wallpaper: 'sea', wallpaperPositions: positions });
  });

  it.each([
    null,
    [],
    { remote: { x: 50, y: 50 } },
    { default: { x: -1, y: 50 } },
    { sea: { x: 50, y: 101 } },
    { sea: { x: '50', y: 40 } },
    { sea: { x: NaN, y: 40 } },
  ])('rejects malformed wallpaper positions: %j', (wallpaperPositions) => {
    expect(parsePreferences({ ...defaultPreferences, wallpaperPositions })).toBeNull();
  });

  it.each([
    null,
    [],
    {},
    { ...defaultPreferences, wifi: 'true' },
    { ...defaultPreferences, brightness: 49 },
    { ...defaultPreferences, brightness: 101 },
    { ...defaultPreferences, brightness: Number.NaN },
    { ...defaultPreferences, brightness: 80.5 },
    { ...defaultPreferences, theme: 'automatic' },
    { ...defaultPreferences, theme: ['light'] },
    { ...defaultPreferences, wallpaper: 'remote' },
    { ...defaultPreferences, wallpaper: ['default'] },
    { ...defaultPreferences, textScale: '115' },
    { ...defaultPreferences, textScale: 120 },
    { ...defaultPreferences, reduceMotion: 1 },
  ])('rejects malformed or unsupported settings: %j', (candidate) => {
    expect(parsePreferences(candidate)).toBeNull();
  });
});
