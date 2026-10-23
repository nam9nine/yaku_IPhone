import type { ReactNode } from 'react';

export function MobileShell({
  children,
  foreground = false,
}: {
  children: ReactNode;
  foreground?: boolean;
}) {
  return (
    <main className="mobile-shell" aria-label="yaku iPhone">
      <div className="mobile-shell-wallpaper" aria-hidden="true">
        <img src={`${import.meta.env.BASE_URL}wallpapers/silver-fold.svg`} alt="" />
      </div>
      {foreground && (
        <div className="mobile-shell-foreground" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}wallpapers/silver-fold-front.svg`} alt="" />
        </div>
      )}
      <div className="mobile-shell-content">{children}</div>
    </main>
  );
}
