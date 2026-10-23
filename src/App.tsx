import { useEffect, useRef, useState } from 'react';
import { MobileShell } from './components/MobileShell';
import { LockScreen } from './lock/LockScreen';

export function App() {
  const [locked, setLocked] = useState(true);
  const arrivalTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!locked) arrivalTitle.current?.focus();
  }, [locked]);

  return (
    <MobileShell foreground={locked}>
      {locked ? (
        <LockScreen onUnlock={() => setLocked(false)} />
      ) : (
        <section
          className="home-arrival screen-enter"
          aria-label="홈 도착 화면"
          data-testid="home-arrival"
        >
          <h1 ref={arrivalTitle} tabIndex={-1}>
            홈
          </h1>
          <p>잠금이 해제되었어요.</p>
          <button type="button" onClick={() => setLocked(true)}>
            다시 잠그기
          </button>
        </section>
      )}
    </MobileShell>
  );
}
