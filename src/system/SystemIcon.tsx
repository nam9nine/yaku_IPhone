import type { ReactNode } from 'react';

export type SystemIconName =
  | 'airplane'
  | 'wifi'
  | 'cellular'
  | 'bluetooth'
  | 'sun'
  | 'dark'
  | 'close'
  | 'up'
  | 'left'
  | 'right'
  | 'search'
  | 'bell'
  | 'cards';

export function SystemIcon({ name }: { name: SystemIconName }) {
  const shapes: Record<SystemIconName, ReactNode> = {
    airplane: <path d="m3 11 7 2 5 8 2-1-2-8 6-7c2-3 0-5-3-3l-7 6-8-2-1 2 8 5-3 7 2 1 5-6" />,
    wifi: (
      <>
        <path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0" />
        <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    cellular: (
      <>
        <path d="M12 9v12M8 21h8M8 6a6 6 0 0 0 0 9M16 6a6 6 0 0 1 0 9M5 3a10 10 0 0 0 0 15M19 3a10 10 0 0 1 0 15" />
        <circle cx="12" cy="9" r="2" fill="currentColor" stroke="none" />
      </>
    ),
    bluetooth: <path d="m7 6 11 11-6 5V2l6 5L7 18" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
      </>
    ),
    dark: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    up: <path d="m5 15 7-7 7 7" />,
    left: <path d="m15 5-7 7 7 7" />,
    right: <path d="m9 5 7 7-7 7" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    bell: (
      <>
        <path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4ZM9 21h6M12 2v2" />
      </>
    ),
    cards: (
      <>
        <rect x="6" y="3" width="12" height="18" rx="3" />
        <path d="M2 6v12M22 6v12" />
      </>
    ),
  };
  return (
    <svg
      className="system-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
