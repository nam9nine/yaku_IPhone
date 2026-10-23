import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main aria-label="yaku iPhone 준비 화면">
      <section data-testid="fixture" className="welcome">
        <div className="welcome-mark" aria-hidden="true">
          y
        </div>
        <h1>yaku iPhone</h1>
        <p>
          잠금 화면과 홈 화면을
          <br />
          준비하고 있습니다.
        </p>
      </section>
    </main>
  </StrictMode>,
);
