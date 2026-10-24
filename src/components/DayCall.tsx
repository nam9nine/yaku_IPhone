import { StatusBar } from './StatusBar';
import type { DevicePreferences } from '../settings/preferences';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDay } from '../day/DayContext';
import { PhoneIcon } from '../story/PhoneIcon';
import { contacts } from '../story/data';
import { useDisplayDate } from '../display/useDisplayDate';
import { useRingtone } from './useRingtone';
import './day-call.css';
const caller = contacts.find((person) => person.id === 'majima')!;
export function DayCall({
  locked,
  onMessage,
  preferences,
  silent,
  volume,
}: {
  locked: boolean;
  onMessage: () => void;
  preferences: DevicePreferences;
  silent: boolean;
  volume: number;
}) {
  const { state, dispatch } = useDay();
  const ringing = state.callStatus === 'ringing';
  const date = useDisplayDate();
  useRingtone(ringing, silent, volume);
  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const slider = useRef<{ id: number; x: number } | null>(null);
  const [slide, setSlide] = useState(0);
  const full = connected || (ringing && (locked || expanded));
  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(() => dispatch({ type: 'miss-call' }), 15000);
    return () => clearTimeout(timer);
  }, [ringing, dispatch]);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);
  useLayoutEffect(() => {
    if (full) dialog.current?.showModal();
    else dialog.current?.close();
  }, [full]);
  function answer() {
    if (!ringing) return;
    setConnected(true);
    setSeconds(0);
    dispatch({ type: 'answer-call' });
  }
  function decline() {
    dispatch({ type: 'miss-call' });
    setConnected(false);
    setExpanded(false);
  }
  if (!ringing && !connected) return null;
  return (
    <>
      {!full && (
        <aside
          className="incoming-call-banner day-call"
          aria-label="마지마 형님 전화 수신"
          role="region"
        >
          <button
            className="incoming-caller"
            onClick={() => setExpanded(true)}
            aria-label="수신 전화 전체 화면"
          >
            <img src={caller.portrait} alt="" />
            <span>
              <small>iPhone · 전화</small>
              <strong>마지마형님</strong>
            </span>
          </button>
          <button className="call-action call-decline" aria-label="전화 거절" onClick={decline}>
            <PhoneIcon name="call" />
          </button>
          <button className="call-action call-answer" aria-label="전화 응답" onClick={answer}>
            <PhoneIcon name="call" />
          </button>
        </aside>
      )}
      <dialog
        ref={dialog}
        className="incoming-call-screen day-call"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
          ].filter((button) => !button.disabled && button.getClientRects().length > 0);
          if (!buttons.length) return;
          event.preventDefault();
          event.stopPropagation();
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        }}
        aria-label={connected ? '마지마 형님과 통화' : '마지마 형님 전화 수신'}
        onCancel={(event) => {
          event.preventDefault();
          decline();
        }}
        style={{ '--caller-photo': `url("${caller.portrait}")` } as React.CSSProperties}
      >
        <StatusBar preferences={preferences} appVisible={false} />
        <div className="call-screen-content">
          <div className="call-identity">
            <img src={caller.portrait} alt="" />
            <p className="call-time" aria-label={connected ? '통화 시간' : '현재 시각'}>
              {connected
                ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
                : date.clock}
            </p>
            <h1>마지마형님</h1>
            {!connected && <p className="call-kind">휴대전화</p>}
          </div>
          {connected ? (
            <>
              <div className="call-tools">
                <button aria-pressed={muted} onClick={() => setMuted(!muted)}>
                  <span>
                    <PhoneIcon name="microphone" />
                  </span>
                  소리 끔
                </button>
                <button aria-pressed={speaker} onClick={() => setSpeaker(!speaker)}>
                  <span>◖))</span>스피커
                </button>
              </div>
              <button
                className="call-action call-decline call-end"
                aria-label="통화 종료"
                onClick={() => setConnected(false)}
              >
                <PhoneIcon name="call" />
              </button>
            </>
          ) : (
            <>
              <div className="call-secondary">
                <button
                  onClick={() => {
                    decline();
                    onMessage();
                  }}
                >
                  <span>▤</span>메시지
                </button>
                <button onClick={decline}>
                  <span>◷</span>나중에
                </button>
              </div>
              {locked ? (
                <div
                  className="call-slide"
                  data-testid="call-slide"
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0) return;
                    slider.current = { id: event.pointerId, x: event.clientX };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (slider.current?.id === event.pointerId)
                      setSlide(
                        Math.max(
                          0,
                          Math.min(
                            event.currentTarget.clientWidth - 70,
                            event.clientX - slider.current.x,
                          ),
                        ),
                      );
                  }}
                  onPointerUp={(event) => {
                    if (slider.current?.id !== event.pointerId) return;
                    const distance = event.clientX - slider.current.x;
                    slider.current = null;
                    setSlide(0);
                    if (distance > event.currentTarget.clientWidth * 0.55) answer();
                  }}
                  onPointerCancel={() => {
                    slider.current = null;
                    setSlide(0);
                  }}
                  onLostPointerCapture={() => {
                    slider.current = null;
                    setSlide(0);
                  }}
                >
                  <button
                    className="call-action call-answer"
                    aria-label="전화 응답"
                    onClick={answer}
                    style={{ transform: `translateX(${slide}px)` }}
                  >
                    <PhoneIcon name="call" />
                  </button>
                  <span>밀어서 통화하기</span>
                </div>
              ) : (
                <div className="call-full-actions">
                  <div>
                    <button
                      className="call-action call-decline"
                      aria-label="전화 거절"
                      onClick={decline}
                    >
                      <PhoneIcon name="call" />
                    </button>
                    <span>거절</span>
                  </div>
                  <div>
                    <button
                      className="call-action call-answer"
                      aria-label="전화 응답"
                      onClick={answer}
                    >
                      <PhoneIcon name="call" />
                    </button>
                    <span>응답</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
