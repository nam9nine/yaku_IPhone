export type SettingsIconName =
  | 'airplane'
  | 'wifi'
  | 'bluetooth'
  | 'cellular'
  | 'appearance'
  | 'brightness'
  | 'wallpaper'
  | 'accessibility';

export function SettingsIcon({ name }: { name: SettingsIconName }) {
  return (
    <span className={`settings-icon settings-icon--${name}`} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {name === 'airplane' && (
          <path
            d="m3 12 7 2 4 7 2-1-2-7 6-6c2-2 1-4-1-3l-7 6-7-2-2 2 6 2-4 4-2-1-1 1 2 3 3 1 1-1-1-2 4-4"
            fill="currentColor"
            stroke="none"
          />
        )}
        {name === 'wifi' && (
          <>
            <path d="M3 9a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 15a5 5 0 0 1 6 0" />
            <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
          </>
        )}
        {name === 'bluetooth' && <path d="m8 7 9 10-5 4V3l5 4L8 17" />}
        {name === 'cellular' && (
          <>
            <path d="M12 12v9M7 16a7 7 0 0 1 0-10M17 16a7 7 0 0 0 0-10M4 19a11 11 0 0 1 0-16M20 19a11 11 0 0 0 0-16" />
            <circle cx="12" cy="11" r="2" fill="currentColor" stroke="none" />
          </>
        )}
        {name === 'appearance' && (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
          </>
        )}
        {name === 'brightness' && (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5l1.5 1.5M5 19l1.5-1.5M17.5 6.5l1.5-1.5" />
          </>
        )}
        {name === 'wallpaper' && (
          <>
            <rect x="4" y="3" width="16" height="18" rx="3" />
            <path d="m5 17 5-6 4 4 2-2 3 4" />
            <circle cx="15.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
          </>
        )}
        {name === 'accessibility' && (
          <>
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
            <path d="M6 10h12M12 10v5m0 0-4 4m4-4 4 4" />
          </>
        )}
      </svg>
    </span>
  );
}
