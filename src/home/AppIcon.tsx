import type { ReactNode } from 'react';
import type { AppId } from './apps';

const flowerColors = [
  '#ffa500',
  '#ffcc00',
  '#8cce00',
  '#15c6b0',
  '#29b7e9',
  '#7680e9',
  '#e86bb3',
  '#ff5474',
];

function IconArtwork({ id, day, weekday }: { id: AppId; day: string; weekday: string }): ReactNode {
  switch (id) {
    case 'calendar':
      return (
        <>
          <text x="32" y="18" fill="#ef424b" fontSize="10" textAnchor="middle">
            {weekday}
          </text>
          <text x="32" y="51" fill="#161616" fontSize="35" fontWeight="300" textAnchor="middle">
            {day}
          </text>
        </>
      );
    case 'facetime':
      return (
        <>
          <rect x="10" y="17" width="31" height="30" rx="6" fill="white" />
          <path d="M44 25 55 19v27l-11-7Z" fill="white" />
        </>
      );
    case 'photos':
      return (
        <>
          {flowerColors.map((color, index) => (
            <ellipse
              key={color}
              cx="32"
              cy="19"
              rx="8.5"
              ry="14"
              fill={color}
              fillOpacity=".88"
              transform={`rotate(${index * 45} 32 32)`}
            />
          ))}
          <circle cx="32" cy="32" r="7" fill="#f6bc2a" />
        </>
      );
    case 'camera':
      return (
        <>
          <rect x="6" y="17" width="52" height="35" rx="8" fill="#404246" />
          <path d="m20 17 5-7h15l5 7" fill="#404246" />
          <circle cx="32" cy="34" r="17" fill="#15191e" />
          <circle cx="32" cy="34" r="12" fill="#344767" />
          <circle cx="32" cy="34" r="8" fill="#12284b" />
          <ellipse cx="28" cy="28" rx="5" ry="3" fill="#88c0f2" />
          <circle cx="50" cy="23" r="2" fill="#d1d4d4" />
        </>
      );
    case 'mail':
      return (
        <>
          <rect x="8" y="15" width="48" height="35" rx="5" fill="white" />
          <path
            d="m9 18 23 19 23-19M9 48l16-16m30 16L39 32"
            fill="none"
            stroke="#a6d7ff"
            strokeWidth="1.2"
          />
        </>
      );
    case 'notes':
      return (
        <>
          <path d="M0 0h64v17H0Z" fill="#ffd72d" />
          <path d="M9 21h46" stroke="#c8c8c8" strokeWidth="1" strokeDasharray="2 2" />
          <path d="M9 32h46M9 43h46M9 54h33" stroke="#bcbcbc" strokeWidth="1.2" />
        </>
      );
    case 'reminders':
      return (
        <>
          {['#0b99ff', '#ff8d26', '#ffbe20'].map((color, index) => (
            <g key={color}>
              <circle
                cx="13"
                cy={16 + index * 16}
                r="4"
                fill="none"
                stroke={color}
                strokeWidth="2.5"
              />
              <path d={`M24 ${16 + index * 16}h30`} stroke="#c3c3c3" strokeWidth="1.5" />
            </g>
          ))}
        </>
      );
    case 'clock':
      return (
        <>
          <circle cx="32" cy="32" r="28" fill="#fff" />
          {Array.from({ length: 12 }, (_, index) => (
            <path
              key={index}
              d="M32 6v4"
              stroke="#383838"
              strokeWidth="1.2"
              transform={`rotate(${index * 30} 32 32)`}
            />
          ))}
          <path
            d="M32 15v17L19 39"
            stroke="#222"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          <path d="m32 32 11 17" stroke="#f28b20" strokeWidth="1" />
          <circle cx="32" cy="32" r="2.3" fill="#222" />
        </>
      );
    case 'books':
      return (
        <>
          <path
            d="M31 19C22 12 14 15 10 17v34c8-4 14-3 21 2ZM33 19c9-7 17-4 21-2v34c-8-4-14-3-21 2Z"
            fill="#fff4d8"
          />
          <path
            d="M31 21c-7-5-12-5-17-3v28c7-2 11-1 17 3M33 21c7-5 12-5 17-3v28c-7-2-11-1-17 3"
            fill="#ffe1a2"
          />
        </>
      );
    case 'tv':
      return (
        <>
          <rect
            x="10"
            y="17"
            width="44"
            height="29"
            rx="6"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
          />
          <path d="m28 24 14 8-14 8Z" fill="white" />
          <path d="M23 51h18" stroke="white" strokeWidth="3" strokeLinecap="round" />
        </>
      );
    case 'games':
      return (
        <>
          <path d="M21 39C25 18 38 9 54 10c1 16-8 30-29 34Z" fill="#fff1e6" />
          <circle cx="41" cy="23" r="5" fill="#ff5c70" />
          <path d="m23 33-11 4 7-16 13-1M30 42l-3 12 16-9 1-13" fill="#ffb4bb" />
          <path d="m23 43-12 9 5-13" fill="#fff1e6" />
        </>
      );
    case 'appstore':
      return (
        <>
          <path
            d="m23 15 27 38M40 15 14 53M12 41h40"
            fill="none"
            stroke="#e9f9ff"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      );
    case 'maps':
      return (
        <>
          <path d="M0 0h64v64H0Z" fill="#8edb78" />
          <path d="m41 0 6 64" stroke="#f7fbeb" strokeWidth="16" />
          <path d="M0 25 64 59" stroke="#fff" strokeWidth="13" />
          <path d="M17 0v64" stroke="#fff" strokeWidth="14" />
          <path d="M17 0v64" stroke="#65bafa" strokeWidth="8" />
          <circle cx="29" cy="39" r="17" fill="#178fff" stroke="white" strokeWidth="2.5" />
          <path d="m29 26 9 25-9-7-9 7Z" fill="#fff" />
        </>
      );
    case 'health':
      return (
        <path
          d="M32 48C25 41 13 34 13 24c0-11 14-16 19-5 6-11 19-6 19 5 0 10-11 17-19 24"
          fill="#ff346f"
        />
      );
    case 'wallet':
      return (
        <>
          <rect x="10" y="12" width="44" height="37" rx="6" fill="#5cbde9" />
          <path d="M10 20h44v12H10Z" fill="#ffdb50" />
          <path d="M10 28h44v12H10Z" fill="#ff7958" />
          <path d="M8 33h18c1 8 11 8 12 0h18v19H8Z" fill="#d8c0a3" />
        </>
      );
    case 'settings':
      return (
        <>
          <circle
            cx="32"
            cy="32"
            r="21"
            fill="none"
            stroke="#ededee"
            strokeWidth="10"
            strokeDasharray="3 2"
          />
          <circle cx="32" cy="32" r="17" fill="none" stroke="#494b51" strokeWidth="3" />
          <circle cx="32" cy="32" r="10" fill="none" stroke="#ededee" strokeWidth="6" />
          <circle cx="32" cy="32" r="4" fill="#494b51" />
        </>
      );
    case 'phone':
      return (
        <path
          d="m17 12 8 11-5 7c4 7 8 11 15 15l7-5 11 8c-1 5-5 8-9 8-17-3-32-18-36-35 0-4 4-8 9-9"
          fill="white"
          transform="translate(2 -2)"
        />
      );
    case 'safari':
      return (
        <>
          <circle cx="32" cy="32" r="28" fill="#0aa8ee" />
          <circle
            cx="32"
            cy="32"
            r="24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeDasharray=".8 2.3"
          />
          <path d="m44 16-8 20-8-8Z" fill="#ff4b51" />
          <path d="m20 48 8-20 8 8Z" fill="white" />
        </>
      );
    case 'messages':
      return (
        <path
          d="M55 30c0 13-10 22-24 22-3 0-6 0-9-1l-10 5 3-11c-5-4-8-9-8-15 0-12 10-21 24-21s24 9 24 21"
          fill="white"
        />
      );
    case 'music':
      return (
        <path
          d="M27 15v30c-11-3-17 3-15 8 2 6 16 5 16-4V26l22-5v18c-10-3-16 3-14 8 2 6 16 5 16-4V9Z"
          fill="white"
          transform="translate(-1 -1)"
        />
      );
    case 'weather':
      return (
        <>
          <circle cx="24" cy="24" r="13" fill="#ffd54a" />
          <path d="M17 47a10 10 0 0 1 0-20c4-13 24-11 26 2 15-3 20 18 6 18Z" fill="#f5fbff" />
        </>
      );
    case 'files':
      return <path d="M8 17c0-3 2-5 5-5h15l6 7h17c3 0 5 2 5 5v25H8Z" fill="#299ef2" />;
    case 'podcasts':
      return (
        <>
          <circle cx="32" cy="29" r="20" fill="none" stroke="white" strokeWidth="3" />
          <circle cx="32" cy="29" r="13" fill="none" stroke="white" strokeWidth="3" />
          <circle cx="32" cy="27" r="5" fill="white" />
          <path d="M25 38c0-6 14-6 14 0l-3 18h-8Z" fill="white" stroke="#b154e9" strokeWidth="2" />
        </>
      );
    case 'calculator':
      return (
        <>
          <rect x="10" y="9" width="44" height="13" rx="3" fill="#929b91" />
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={10 + col * 16}
                y={28 + row * 10}
                width="12"
                height="7"
                rx="2"
                fill={col === 2 ? '#ff9d27' : '#ddd'}
              />
            )),
          )}
        </>
      );
    case 'compass':
      return (
        <>
          <circle
            cx="32"
            cy="32"
            r="23"
            fill="none"
            stroke="#ddd"
            strokeWidth="2"
            strokeDasharray="1 3"
          />
          <path d="m32 10 6 23-6 21-6-21Z" fill="white" />
          <path d="m32 10 6 23H26Z" fill="#ff5260" />
          <circle cx="32" cy="32" r="3" fill="#222" />
        </>
      );
    case 'voice':
      return (
        <>
          <path d="M8 32h48" stroke="#bbb" strokeWidth=".6" />
          {[8, 18, 28, 42, 30, 18, 10, 22, 34, 16].map((height, index) => (
            <path
              key={index}
              d={`M${11 + index * 4.8} ${32 - height / 2}v${height}`}
              stroke="#ff4752"
              strokeWidth="2.4"
            />
          ))}
        </>
      );
    case 'shortcuts':
      return (
        <>
          <path d="m32 9 23 14-23 14L9 23Z" fill="#4bc8ee" />
          <path d="m32 25 23 14-23 14L9 39Z" fill="#f66fb0" fillOpacity=".9" />
        </>
      );
    case 'contacts':
      return (
        <>
          <rect x="7" y="4" width="46" height="56" rx="5" fill="#d4d0c9" />
          <path d="M53 12h7v10h-7z" fill="#c4ad93" />
          <path d="M53 25h7v10h-7z" fill="#b6a18b" />
          <path d="M53 38h7v10h-7z" fill="#a28a72" />
          <circle cx="29" cy="24" r="9" fill="#8c867c" />
          <path d="M12 51c0-20 34-20 34 0Z" fill="#8c867c" />
        </>
      );
    case 'findmy':
      return (
        <>
          <circle cx="32" cy="32" r="25" fill="#63d37d" />
          <circle cx="32" cy="32" r="17" fill="none" stroke="#dcf9e1" strokeWidth="1" />
          <circle cx="32" cy="32" r="9" fill="none" stroke="#dcf9e1" strokeWidth="1" />
          <path d="m32 32 4-24 21 23Z" fill="#d8f7e5" fillOpacity=".6" />
          <circle cx="32" cy="32" r="5" fill="#389be7" stroke="white" strokeWidth="2" />
        </>
      );
  }
}

export function AppIcon({ id, day, weekday }: { id: AppId; day: string; weekday: string }) {
  return (
    <span className={`app-icon app-icon--${id}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <IconArtwork id={id} day={day} weekday={weekday} />
      </svg>
    </span>
  );
}
