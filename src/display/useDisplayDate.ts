import { useEffect, useState } from 'react';
import { getDisplayDate } from './date';

export function useDisplayDate() {
  const [date, setDate] = useState(() => getDisplayDate(new Date()));

  useEffect(() => {
    const refresh = () => setDate(getDisplayDate(new Date()));
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return date;
}
