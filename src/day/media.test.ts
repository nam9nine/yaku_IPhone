import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import provenance from '../../references/personal-media.json';
import previousPhotos from './gamePhotos.json';
import { dayPhotos, galleryKnownIds, getWallpaper } from './media';
import { defaultPreferences, parsePreferences } from '../settings/preferences';

describe('selected personal photos', () => {
  it('shows only the six supplied photos and preserves their original bytes', () => {
    expect(dayPhotos).toHaveLength(6);
    expect(new Set(dayPhotos.map((photo) => photo.id)).size).toBe(6);
    for (const photo of dayPhotos) {
      const source = provenance.images.find((image) => image.id === photo.id)!;
      expect(source).toBeDefined();
      expect(photo.src).toContain('/asagao/selected/');
      const bytes = readFileSync(new URL(`../../${source.path}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
    }
  });

  it('restores every previously selected wallpaper without resetting other settings', () => {
    for (const photo of previousPhotos) {
      const stored = {
        ...defaultPreferences,
        theme: 'dark',
        brightness: 65,
        wallpaper: photo.id,
        wallpaperPositions: { [photo.id]: { x: 25, y: 70 } },
      };
      expect(parsePreferences(stored)).toEqual(stored);
      expect(getWallpaper(photo.id).src).toContain(`/asagao/${photo.src}`);
      expect(galleryKnownIds).toContain(photo.id);
      expect(dayPhotos.some((current) => current.id === photo.id)).toBe(false);
    }
  });

  it('accepts a new personal background and keeps the existing default, drawing and sea', () => {
    for (const photo of dayPhotos) {
      expect(parsePreferences({ ...defaultPreferences, wallpaper: photo.id })?.wallpaper).toBe(
        photo.id,
      );
      expect(getWallpaper(photo.id).src).toBe(photo.src);
    }
    expect(getWallpaper('default').src).toContain('/asagao/mealtime.jpg');
    expect(getWallpaper('drawing').src).toContain('/asagao/family-drawing.svg');
    expect(getWallpaper('sea').src).toContain('/asagao/game/evening-sea.jpg');
    expect(getWallpaper('lunchbox').src).toContain('/asagao/game/cooking.jpg');
    expect(getWallpaper('sprout-garden').src).toContain('/asagao/game/asagao-family.jpg');
  });
});
