import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

const sessionValues = new Map<string, unknown>();
let ignoreStored = false;
export function resetStoryStorage() {
  sessionValues.clear();
  ignoreStored = true;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('yaku-iphone.story.')) localStorage.removeItem(key);
    }
  } catch {
    /* The current session still resets if storage is blocked. */
  }
}

export function readStory<T>(key: string, initial: T, validate: (value: unknown) => boolean): T {
  if (sessionValues.has(key)) {
    const value = sessionValues.get(key);
    if (validate(value)) return value as T;
  }
  if (ignoreStored) return initial;
  try {
    const raw = localStorage.getItem(`yaku-iphone.story.${key}.v1`);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (validate(value)) return value as T;
    }
  } catch {
    /* Storage denial must not prevent use of the phone. */
  }
  return initial;
}

export function useStoredState<T>(
  key: string,
  initial: T,
  validate: (value: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState(() => readStory(key, initial, validate));
  const latest = useRef(value);
  const [unavailable, setUnavailable] = useState(false);
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const next =
        typeof action === 'function' ? (action as (old: T) => T)(latest.current) : action;
      latest.current = next;
      sessionValues.set(key, next);
      setValue(next);
      try {
        localStorage.setItem(`yaku-iphone.story.${key}.v1`, JSON.stringify(next));
        setUnavailable(false);
      } catch {
        setUnavailable(true);
      }
    },
    [key],
  );
  return [value, update, unavailable];
}
