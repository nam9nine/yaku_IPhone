import { useStoredState } from '../story/useStoredState';
import { validExtraContacts, type ExtraContact } from '../story/addressBook';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
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
  extraContacts: ExtraContact[];
  setExtraContacts: Dispatch<SetStateAction<ExtraContact[]>>;
  state: DayState;
  dispatch: Dispatch<DayAction>;
  remaining: number;
  shoppingDone: boolean;
  storageUnavailable: boolean;
  reset: () => void;
  setCallActivity: (active: boolean) => void;
}
const DayContext = createContext<DayValue | null>(null);
export function DayProvider({ children }: { children: ReactNode }) {
  const [extraContacts, setExtraContacts, contactsUnavailable] = useStoredState<ExtraContact[]>(
    'contacts',
    [],
    validExtraContacts,
  );
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
  const callsActive = useRef(false);
  const setCallActivity = useCallback((active: boolean) => {
    callsActive.current = active;
  }, []);
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
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible')
        dispatch({ type: 'tick', elapsedMs: 1000, allowCalls: callsActive.current });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [dispatch]);
  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
    setExtraContacts([]);
  }, [dispatch, setExtraContacts]);
  return (
    <DayContext
      value={{
        state,
        extraContacts,
        setExtraContacts,
        dispatch,
        setCallActivity,
        remaining: remainingReminders(state),
        shoppingDone: shoppingComplete(state),
        storageUnavailable: storageUnavailable || contactsUnavailable,
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
