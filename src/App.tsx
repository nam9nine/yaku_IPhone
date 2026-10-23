import { useState } from 'react';
import { MobileShell } from './components/MobileShell';
import { LockScreen } from './lock/LockScreen';
import { HomeScreen } from './home/HomeScreen';

export function App() {
  const [screen, setScreen] = useState<'initial-lock' | 'lock' | 'home'>('initial-lock');
  const locked = screen !== 'home';
  return (
    <MobileShell foreground={locked}>
      {locked ? (
        <LockScreen onUnlock={() => setScreen('home')} autoFocus={screen === 'lock'} />
      ) : (
        <HomeScreen onLock={() => setScreen('lock')} />
      )}
    </MobileShell>
  );
}
