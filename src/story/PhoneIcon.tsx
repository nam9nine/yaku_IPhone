export type PhoneIconName =
  | 'favorite'
  | 'recent'
  | 'contacts'
  | 'keypad'
  | 'voicemail'
  | 'call'
  | 'search'
  | 'microphone'
  | 'menu'
  | 'back'
  | 'info';
export function PhoneIcon({ name }: { name: PhoneIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'favorite' && (
        <path
          fill="currentColor"
          stroke="none"
          d="m12 1 3.2 6.6 7.3 1-5.3 5.2 1.3 7.2-6.5-3.4L5.5 21l1.3-7.2L1.5 8.6l7.3-1Z"
        />
      )}
      {name === 'recent' && (
        <>
          <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
          <path d="M12 5v7H7" stroke="var(--phone-tab-cutout, var(--app-surface))" />
        </>
      )}
      {name === 'contacts' && (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
          <circle
            cx="12"
            cy="9"
            r="3"
            fill="var(--phone-tab-cutout, var(--app-surface))"
            stroke="none"
          />
          <path
            d="M6 19v-2a6 5 0 0 1 12 0v2"
            fill="var(--phone-tab-cutout, var(--app-surface))"
            stroke="none"
          />
        </>
      )}
      {name === 'keypad' &&
        Array.from({ length: 9 }, (_, i) => (
          <circle
            key={i}
            cx={5 + (i % 3) * 7}
            cy={5 + Math.floor(i / 3) * 7}
            r="2.4"
            fill="currentColor"
            stroke="none"
          />
        ))}
      {name === 'voicemail' && (
        <>
          <circle cx="5.5" cy="13" r="4.5" />
          <circle cx="18.5" cy="13" r="4.5" />
          <path d="M5.5 17.5h13" />
        </>
      )}
      {name === 'call' && (
        <path
          fill="currentColor"
          stroke="none"
          d="M5 2 2 4c-1 1 0 6 4 11s10 8 12 7l4-3c.8-.7.5-2-.4-2.5l-4-2.4c-.6-.4-1.5-.2-2 .4l-1.5 1.7c-2.5-1.2-5.3-4-6.5-6.4L9 8.2c.5-.5.7-1.2.3-1.9L7 2.5C6.5 1.6 5.7 1.5 5 2Z"
        />
      )}
      {name === 'search' && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </>
      )}
      {name === 'microphone' && (
        <>
          <rect x="9" y="2" width="6" height="13" rx="3" />
          <path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v4m-3 0h6" />
        </>
      )}
      {name === 'menu' && <path d="M5 7h14M7 12h10M9 17h6" />}
      {name === 'back' && <path d="m15 5-7 7 7 7" />}
      {name === 'info' && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r=".6" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
