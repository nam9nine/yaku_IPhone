const clock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const calendar = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

export function aiTime(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : clock.format(date);
}

export function aiDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : calendar.format(date);
}
