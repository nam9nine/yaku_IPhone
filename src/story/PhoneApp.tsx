import { useState } from 'react';
import { ContactsApp } from './ContactsApp';
import { useDay } from '../day/DayContext';
import './phone.css';

export function PhoneApp({
  active,
  onMessage,
}: {
  active: boolean;
  onMessage: (id: string) => void;
}) {
  const [tab, setTab] = useState<'recent' | 'contacts'>('recent');
  const { state, dispatch } = useDay();
  return (
    <section className="phone-app" aria-label="전화 내용">
      {tab === 'contacts' ? (
        <ContactsApp active={active} onMessage={onMessage} />
      ) : (
        <>
          <header className="social-header">
            <h1 data-app-title tabIndex={-1}>
              최근 통화
            </h1>
          </header>
          <div className="phone-history">
            {state.missedCall ? (
              <button
                className="phone-call"
                onClick={() => {
                  dispatch({ type: 'read-call' });
                  onMessage('majima');
                }}
                aria-label="마지마 부재중 전화, 메시지 열기"
              >
                <span className="phone-call-mark">↙</span>
                <span>
                  <strong>마지마 형님</strong>
                  <small>부재중 전화 · 휴대전화</small>
                </span>
                <time>16:45</time>
                <span aria-hidden="true">ⓘ</span>
              </button>
            ) : (
              <p className="phone-empty">최근 통화 없음</p>
            )}
            <p className="phone-footnote">
              이 휴대폰 안에 남겨진 기록입니다. 실제 전화는 연결되지 않습니다.
            </p>
          </div>
        </>
      )}
      <nav className="phone-tabs" aria-label="전화 보기">
        <button
          aria-pressed={tab === 'recent'}
          onClick={() => {
            setTab('recent');
            dispatch({ type: 'read-call' });
          }}
        >
          <span aria-hidden="true">◷</span>최근 통화
        </button>
        <button aria-pressed={tab === 'contacts'} onClick={() => setTab('contacts')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="7" r="4" />
            <path d="M4 22v-4a8 8 0 0 1 16 0v4" />
          </svg>
          연락처
        </button>
      </nav>
    </section>
  );
}
