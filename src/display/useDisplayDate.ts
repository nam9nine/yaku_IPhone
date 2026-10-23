import { getDisplayDate } from './date';

export const DEMO_DATE = '2026-10-24T16:40:00+09:00';
export function useDisplayDate() {
  // A fictional Saturday. Story actions, never the visitor's wall clock, advance events.
  return getDisplayDate(new Date(DEMO_DATE));
}
