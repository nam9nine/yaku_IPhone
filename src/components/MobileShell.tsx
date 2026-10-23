import type { ReactNode } from 'react';

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <main className="mobile-shell" aria-label="yaku iPhone 준비 화면">
      <div className="mobile-shell-wallpaper" aria-hidden="true">
        <img src={`${import.meta.env.BASE_URL}wallpapers/silver-fold.svg`} alt="" />
      </div>
      <div className="mobile-shell-content">{children}</div>
    </main>
  );
}
