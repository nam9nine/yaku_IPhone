import { StatusBar } from './StatusBar';
import type { CSSProperties, ReactNode } from 'react';
import { useViewport } from '../shell/useViewport';
import type { DevicePreferences } from '../settings/preferences';
import { getWallpaper } from '../day/media';

export function MobileShell({
  children,
  foreground = false,
  preferences,
  appearance,
  appVisible = false,
}: {
  children: ReactNode;
  appVisible?: boolean;
  foreground?: boolean;
  preferences: DevicePreferences;
  appearance: { theme: 'light' | 'dark'; reduceMotion: boolean };
}) {
  const viewport = useViewport();
  const wallpaper = getWallpaper(preferences.wallpaper);
  const position = preferences.wallpaperPositions?.[preferences.wallpaper];
  return (
    <main
      className="mobile-shell"
      style={
        {
          height: viewport.height,
          top: viewport.top,
          left: viewport.left,
          width: viewport.width,
          '--phone-top': `${viewport.top}px`,
          '--phone-left': `${viewport.left}px`,
          '--phone-width': `${viewport.width}px`,
          '--phone-height': `${viewport.height}px`,
        } as CSSProperties
      }
      aria-label="키류의 iPhone"
      data-framed={viewport.framed}
      data-locked={foreground}
      data-theme={appearance.theme}
      data-wallpaper={preferences.wallpaper}
      data-reduced-motion={appearance.reduceMotion}
    >
      <div
        className="mobile-shell-wallpaper"
        aria-hidden="true"
        data-landscape={wallpaper.landscape || undefined}
        style={{ '--wallpaper-image': `url("${wallpaper.src}")` } as CSSProperties}
      >
        <img
          src={wallpaper.src}
          alt=""
          style={{
            objectPosition: position ? `${position.x}% ${position.y}%` : wallpaper.position,
            ...(wallpaper.landscape && position ? { top: `${32 + (position.y - 50) / 4}%` } : {}),
          }}
        />
      </div>
      <StatusBar preferences={preferences} appVisible={appVisible} />
      <div className="mobile-shell-content">{children}</div>
      <div
        className="brightness-overlay"
        data-testid="brightness-overlay"
        aria-hidden="true"
        style={{ opacity: 1 - preferences.brightness / 100 }}
      />
    </main>
  );
}
