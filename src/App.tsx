import { MobileShell } from './components/MobileShell';
import { useDisplayDate } from './display/useDisplayDate';

export function App() {
  const date = useDisplayDate();

  return (
    <MobileShell>
      <section className="welcome" aria-labelledby="welcome-title" data-testid="fixture">
        <time className="welcome-date" dateTime={date.isoDate}>
          {date.label}
        </time>
        <div className="welcome-mark" aria-hidden="true">
          y
        </div>
        <h1 id="welcome-title">yaku iPhone</h1>
        <p>
          잠금 화면과 홈 화면을
          <br />
          준비하고 있습니다.
        </p>
      </section>
    </MobileShell>
  );
}
