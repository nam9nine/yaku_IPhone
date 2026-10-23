export const displaySettings = {
  locale: 'ko-KR',
  timeZone: 'Asia/Seoul',
} as const;

const labelFormatter = new Intl.DateTimeFormat(displaySettings.locale, {
  timeZone: displaySettings.timeZone,
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: displaySettings.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getDisplayDate(now: Date) {
  const parts = partsFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value;
  return {
    label: labelFormatter.format(now),
    isoDate: `${part('year')}-${part('month')}-${part('day')}`,
  };
}
