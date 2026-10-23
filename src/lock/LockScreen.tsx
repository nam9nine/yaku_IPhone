import { useId, useState } from 'react';
import { useDisplayDate } from '../display/useDisplayDate';
import { useUnlockGesture } from './useUnlockGesture';
import './lock.css';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const date = useDisplayDate();
  const gradient = useId();
  const [notice, setNotice] = useState('');
  const { offset, dragging, bind, unlock } = useUnlockGesture({ onUnlock });

  return (
    <section className="lock-screen" aria-label="잠금 화면" data-testid="lock-screen" {...bind}>
      <div
        className={`lock-clock-group${dragging ? ' is-dragging' : ''}`}
        style={{ transform: `translateY(${-offset}px)`, opacity: 1 - offset / 400 }}
      >
        <time className="lock-date" dateTime={date.isoDate}>
          {date.label}
        </time>
        <svg
          className="lock-clock"
          viewBox="0 0 330 360"
          role="img"
          aria-label={date.accessibleTime}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0.8" y2="1">
              <stop offset="0" stopColor="#ffefca" />
              <stop offset="0.45" stopColor="#d7c3a6" />
              <stop offset="0.7" stopColor="#fff4dd" />
              <stop offset="1" stopColor="#c9bdaf" />
            </linearGradient>
          </defs>
          <text
            x="165"
            y="119"
            transform="translate(0 -20) scale(1 2.9)"
            textAnchor="middle"
            textLength="288"
            lengthAdjust="spacingAndGlyphs"
            fill={`url(#${gradient})`}
            stroke="#fff7e9"
            strokeWidth="0.35"
          >
            {date.clock}
          </text>
        </svg>
      </div>
      <div className="lock-bottom">
        <div className="lock-notice" role="status">
          {notice}
        </div>
        <div className="lock-shortcuts">
          <button
            className="glass-button"
            type="button"
            aria-label="손전등 안내"
            onClick={() => setNotice('손전등은 이 웹 화면에서 사용할 수 없어요.')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 3h8M7 6h10l-3 5v9h-4v-9L7 6Z" />
              <path d="M12 12v3" />
            </svg>
          </button>
          <button
            className="glass-button"
            type="button"
            aria-label="카메라 안내"
            onClick={() => setNotice('카메라 화면은 준비 중이에요.')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 7h4l2-3h6l2 3h4v13H3V7Z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        </div>
        <button
          className="unlock-hint"
          data-unlock-handle
          type="button"
          onClick={unlock}
          aria-label="잠금 해제"
        >
          <svg viewBox="0 0 20 12" aria-hidden="true">
            <path d="m4 9 6-6 6 6" />
          </svg>
          위로 쓸어올려서 열기
        </button>
      </div>
    </section>
  );
}
