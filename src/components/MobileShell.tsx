import type { ReactNode } from 'react';
import type { DevicePreferences } from '../settings/preferences';

export function MobileShell({
  children,
  foreground = false,
  preferences,
  appearance,
}: {
  children: ReactNode;
  foreground?: boolean;
  preferences: DevicePreferences;
  appearance: { theme: 'light' | 'dark'; reduceMotion: boolean };
}) {
  return (
    <main
      className="mobile-shell"
      aria-label="yaku iPhone"
      data-theme={appearance.theme}
      data-wallpaper={preferences.wallpaper}
      data-reduced-motion={appearance.reduceMotion}
    >
      <div className="mobile-shell-wallpaper" aria-hidden="true">
        <img src={`${import.meta.env.BASE_URL}wallpapers/silver-fold.svg`} alt="" />
      </div>
      {foreground && (
        <div className="mobile-shell-foreground" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}wallpapers/silver-fold-front.svg`} alt="" />
        </div>
      )}
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
