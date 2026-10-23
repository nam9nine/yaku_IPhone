import type { ReactNode } from 'react';

export type ControlIconName =
  | 'plus'
  | 'power'
  | 'airplane'
  | 'airdrop'
  | 'wifi'
  | 'cellular'
  | 'bluetooth'
  | 'link'
  | 'globe'
  | 'airplay'
  | 'play'
  | 'previous'
  | 'next'
  | 'rotation'
  | 'bell'
  | 'moon'
  | 'sun'
  | 'volume'
  | 'flashlight'
  | 'timer'
  | 'calculator'
  | 'camera'
  | 'mirror'
  | 'qr'
  | 'heart'
  | 'music'
  | 'dark'
  | 'close'
  | 'chevron';

export function ControlIcon({ name }: { name: ControlIconName }) {
  const art: Record<ControlIconName, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    power: (
      <>
        <path d="M12 2v10M7 5a8 8 0 1 0 10 0" />
      </>
    ),
    airplane: (
      <path
        d="m3 12 7 1 5 8 2-1-2-8 5-6c2-3 0-5-3-3l-6 5-8-2-1 2 7 5-3 6 2 1 4-5"
        fill="currentColor"
        stroke="none"
      />
    ),
    airdrop: (
      <>
        <circle cx="12" cy="9" r="2" />
        <path d="M8 14a6 6 0 1 1 8 0M5 17a10 10 0 1 1 14 0M12 13l-4 8h8Z" />
      </>
    ),
    wifi: (
      <>
        <path
          d="M2 8a16 16 0 0 1 20 0M6 12a10 10 0 0 1 12 0M10 16a4 4 0 0 1 4 0"
          strokeWidth="2.7"
        />
        <circle cx="12" cy="20" r="1.3" fill="currentColor" stroke="none" />
      </>
    ),
    cellular: (
      <>
        <path d="M5 18v3M10 13v8M15 8v13M20 3v18" strokeWidth="3" />
      </>
    ),
    bluetooth: <path d="m7 6 11 11-6 5V2l6 5L7 18" />,
    link: (
      <>
        <path d="m9 15 6-6M7 16l-1 1a4 4 0 0 1-5-6l5-5a4 4 0 0 1 6 0M17 8l1-1a4 4 0 0 1 5 6l-5 5a4 4 0 0 1-6 0" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18M5 7h14M5 17h14" />
      </>
    ),
    airplay: (
      <>
        <path d="m12 12-5 9h10ZM7 15a7 7 0 1 1 10 0M4 18a11 11 0 1 1 16 0" />
      </>
    ),
    play: <path d="m7 3 15 9-15 9Z" fill="currentColor" stroke="none" />,
    previous: <path d="m12 4-11 8 11 8V4Zm11 0-11 8 11 8V4Z" fill="currentColor" stroke="none" />,
    next: <path d="m1 4 11 8-11 8V4Zm11 0 11 8-11 8V4Z" fill="currentColor" stroke="none" />,
    rotation: (
      <>
        <path d="M5 9V3M5 9h6M5 7a9 9 0 1 1-1 9" />
        <rect x="9" y="10" width="7" height="7" rx="1.5" fill="currentColor" />
        <path d="M11 10V8a2 2 0 0 1 4 0v2" />
      </>
    ),
    bell: (
      <>
        <path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4Z" fill="currentColor" />
        <path d="M10 21h4M12 2v2" />
      </>
    ),
    moon: <path d="M18 17A9 9 0 0 1 7 4a9 9 0 1 0 11 13Z" fill="currentColor" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l1.5 1.5m13 13L20 20M4 20l1.5-1.5m13-13L20 4" />
      </>
    ),
    volume: (
      <>
        <path d="M3 9h4l5-5v16l-5-5H3Z" fill="currentColor" />
        <path d="M16 8a7 7 0 0 1 0 8M20 4a12 12 0 0 1 0 16" />
      </>
    ),
    flashlight: (
      <>
        <path d="M6 2h12v6l-3 4v9H9v-9L6 8Z" fill="currentColor" stroke="none" />
        <path d="M6 6h12M12 14v3" stroke="#666" />
      </>
    ),
    timer: (
      <>
        <path d="M12 3a9 9 0 1 1-7 3M12 7v5l4 3M4 2v6h6" />
      </>
    ),
    calculator: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="3" />
        <path d="M7 6h10M8 11h1m6 0h1m-8 5h1m6 0h1" strokeWidth="2.8" />
      </>
    ),
    camera: (
      <>
        <path d="M3 6h4l2-3h6l2 3h4v15H3Z" fill="currentColor" />
        <circle cx="12" cy="13" r="4" stroke="#666" strokeWidth="2.5" />
      </>
    ),
    mirror: (
      <>
        <rect x="2" y="3" width="14" height="12" rx="2" />
        <rect x="8" y="9" width="14" height="12" rx="2" fill="none" />
      </>
    ),
    qr: (
      <>
        <path d="M8 2H2v6M16 2h6v6M2 16v6h6M22 16v6h-6M6 6h4v4H6Zm8 0h4v4h-4ZM6 14h4v4H6Zm8 0h2v2h2v2h-4Z" />
      </>
    ),
    heart: <path d="M12 21C-3 12 2 0 12 7c10-7 15 5 0 14Z" fill="currentColor" stroke="none" />,
    music: (
      <>
        <path d="M9 17V5l11-3v13M9 8l11-3" />
        <ellipse cx="6" cy="18" rx="3" ry="2.5" fill="currentColor" />
        <ellipse cx="17" cy="16" rx="3" ry="2.5" fill="currentColor" />
      </>
    ),
    dark: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    chevron: <path d="m9 8 3-3 3 3m-6 8 3 3 3-3" />,
  };
  return (
    <svg
      className="cc-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {art[name]}
    </svg>
  );
}
