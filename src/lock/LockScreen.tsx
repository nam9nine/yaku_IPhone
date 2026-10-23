import { useState } from 'react';
import { useDisplayDate } from '../display/useDisplayDate';
import { useUnlockGesture } from './useUnlockGesture';
import { useDay } from '../day/DayContext';
import { DayNotification } from '../components/DayNotification';
import './lock.css';

export function LockScreen({
  onUnlock,
  autoFocus = false,
  active = true,
  onMessage,
  onCalendar,
  onReminders,
  onWeather,
}: {
  onUnlock: () => void;
  autoFocus?: boolean;
  active?: boolean;
  onMessage: () => void;
  onCalendar: () => void;
  onReminders: () => void;
  onWeather: () => void;
}) {
  const date = useDisplayDate();
  const { remaining } = useDay();
  const [notice, setNotice] = useState('');
  const { offset, dragging, bind, unlock } = useUnlockGesture({ onUnlock, active });
  return (
    <section className="lock-screen" aria-label="잠금 화면" data-testid="lock-screen" {...bind}>
      <div
        className={`lock-clock-group${dragging ? ' is-dragging' : ''}`}
        style={{ transform: `translateY(${-offset}px)`, opacity: 1 - offset / 400 }}
      >
        <time className="lock-date" dateTime={date.isoDate}>
          {date.label}
        </time>
        <div className="lock-time" role="img" aria-label={date.accessibleTime}>
          {date.clock}
        </div>
        <div className="lock-widgets" aria-label="잠금 화면 위젯">
          <button
            className="lock-event-widget"
            onClick={onCalendar}
            aria-label="17:00 장보기, 저녁 카레 재료 일정 열기"
          >
            <strong>17:00 장보기</strong>
            <span>저녁 카레 재료</span>
          </button>
          <button
            className="lock-round-widget"
            onClick={onWeather}
            aria-label="가상 날씨 27도 안내 열기"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
            </svg>
            <span>27°</span>
          </button>
          <button
            className="lock-round-widget"
            onClick={onReminders}
            aria-label={`남은 할 일 ${remaining}개`}
          >
            <span className="lock-task-count">{remaining}</span>
            <small>할 일</small>
          </button>
        </div>
      </div>
      <div className="lock-bottom">
        <DayNotification onOpen={onMessage} />
        <div className="lock-notice" role="status">
          {notice}
        </div>
        <div className="lock-shortcuts">
          <button
            className="glass-button"
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
            aria-label="카메라 안내"
            onClick={() => setNotice('카메라 권한을 사용하지 않는 웹 체험입니다.')}
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
          autoFocus={autoFocus}
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
