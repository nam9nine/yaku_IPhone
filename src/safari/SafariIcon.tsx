type SafariIconName =
  | 'back'
  | 'forward'
  | 'reload'
  | 'tabs'
  | 'menu'
  | 'plus'
  | 'close'
  | 'search'
  | 'compass'
  | 'arrow'
  | 'globe';

const paths: Record<SafariIconName, string> = {
  back: 'm14.5 4-8 8 8 8',
  forward: 'm9.5 4 8 8-8 8',
  reload: 'M19 8a8 8 0 1 0 .4 7M19 3v5h-5',
  tabs: 'M8 7V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-3M4 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
  menu: 'M4 6h16M4 11h16M4 16h10',
  plus: 'M12 4v16M4 12h16',
  close: 'm6 6 12 12M6 18 18 6',
  search: 'M16 16 21 21M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  compass: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 8l-3 5-5 3 3-5 5-3Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
};

export function SafariIcon({ name }: { name: SafariIconName }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
