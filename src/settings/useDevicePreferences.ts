import { useCallback, useState } from 'react';
import type { DevicePreferences } from './preferences';
import { loadPreferences, savePreferences } from './storage';

export function useDevicePreferences() {
  const [state, setState] = useState(loadPreferences);
  const setPreferences = useCallback((preferences: DevicePreferences) => {
    const stored = savePreferences(preferences);
    setState({ preferences, storageUnavailable: !stored });
  }, []);
  return { ...state, setPreferences };
}
