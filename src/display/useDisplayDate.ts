import { useEffect, useState } from 'react';
import { getDisplayDate } from './date';

export function useDisplayDate() {
  const [date, setDate] = useState(() => getDisplayDate(new Date()));

  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          setDate(getDisplayDate(new Date()));
          schedule();
        },
        60_000 - (Date.now() % 60_000),
      );
    };
    const resume = () => {
      window.clearTimeout(timer);
      setDate(getDisplayDate(new Date()));
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  return date;
}
