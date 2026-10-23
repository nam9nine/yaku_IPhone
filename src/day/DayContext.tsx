import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  DAY_STORAGE_KEY,
  dayReducer,
  initialDay,
  loadDay,
  remainingReminders,
  shoppingComplete,
  type DayAction,
  type DayState,
} from './state';
interface DayValue {
  state: DayState;
  dispatch: Dispatch<DayAction>;
  remaining: number;
  shoppingDone: boolean;
  storageUnavailable: boolean;
  reset: () => void;
}
const DayContext = createContext<DayValue | null>(null);
export function DayProvider({ children }: { children: ReactNode }) {
  const [loaded] = useState(() => {
    try {
      return loadDay(window.localStorage);
    } catch {
      return { state: initialDay(), unavailable: true };
    }
  });
  const [state, setState] = useState(loaded.state);
  const [storageUnavailable, setStorageUnavailable] = useState(loaded.unavailable);
  const latest = useRef(state);
  const dispatch = useCallback<Dispatch<DayAction>>((action) => {
    const next = dayReducer(latest.current, action);
    if (next === latest.current) return;
    latest.current = next;
    setState(next);
    try {
      localStorage.setItem(DAY_STORAGE_KEY, JSON.stringify(next));
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  }, []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), [dispatch]);
  return (
    <DayContext
      value={{
        state,
        dispatch,
        remaining: remainingReminders(state),
        shoppingDone: shoppingComplete(state),
        storageUnavailable,
        reset,
      }}
    >
      {children}
    </DayContext>
  );
}
export function useDay(): DayValue {
  const context = useContext(DayContext);
  if (!context) throw new Error('useDay requires DayProvider');
  return context;
}
