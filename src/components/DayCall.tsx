import { CallConversation } from './CallConversation';
import { isAiCharacter } from '../ai/client';
import type { AiMessengerView } from '../ai/useAiMessenger';
import { isOnline } from '../settings/preferences';
import { StatusBar } from './StatusBar';
import type { DevicePreferences } from '../settings/preferences';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDay } from '../day/DayContext';
import { PhoneIcon } from '../story/PhoneIcon';
import { contacts } from '../story/data';
import { peerHangupDue } from '../day/state';
import { useRingtone } from './useRingtone';
import type { ContactId } from '../day/content';
import './day-call.css';
import '../story/phone.css';
export function DayCall({
  locked,
  active = !locked,
  onMessage,
  preferences,
  silent,
  volume,
  ai,
}: {
  ai: AiMessengerView;
  locked: boolean;
  active?: boolean;
  onMessage: (id: ContactId) => void;
  preferences: DevicePreferences;
  silent: boolean;
  volume: number;
}) {
  const { state, dispatch, setCallActivity } = useDay();
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const callActive = active && visible;
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const call = state.call;
  const caller = contacts.find((person) => person.id === call?.caller);
  const name = caller?.id === 'majima' ? '마지마 형님' : caller?.shortName;
  const ringing = call?.phase === 'ringing';
  const connected = call?.phase === 'connected';
  const outgoing = call?.direction === 'outgoing';
  const seconds = Math.floor((call?.elapsedMs ?? 0) / 1000);
  useEffect(() => {
    setCallActivity(callActive);
    if (!callActive) dispatch({ type: 'defer-contact' });
    return () => setCallActivity(false);
  }, [callActive, setCallActivity, dispatch]);
  const [liveBusy, setLiveBusy] = useState(false);
  const [endingCall, setEndingCall] = useState<string | null>(null);
  const callId = call?.id;
  const requestId = call?.followupRequestId;
  const onBusyChange = useCallback(
    (busy: boolean) => {
      setLiveBusy(busy);
      if (callId) dispatch({ type: 'call-activity', callId, requestId, busy, active: callActive });
    },
    [callId, requestId, callActive, dispatch],
  );
  useEffect(() => {
    if (callId)
      dispatch({ type: 'call-activity', callId, requestId, busy: liveBusy, active: callActive });
  }, [callId, requestId, connected, liveBusy, callActive, dispatch]);
  const peerDue = !!call && peerHangupDue(call);
  useEffect(() => {
    if (!callId || !peerDue || liveBusy || !callActive) return;
    const id = callId;
    const show = window.setTimeout(() => setEndingCall(id), 0);
    const finish = window.setTimeout(
      () =>
        dispatch({
          type: 'peer-end-call',
          callId: id,
          requestId,
          ...(caller && isAiCharacter(caller.id) ? { reason: 'idle' as const } : {}),
        }),
      6000,
    );
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(finish);
      setEndingCall(null);
    };
  }, [callId, requestId, peerDue, liveBusy, callActive, caller, dispatch]);
  useRingtone(ringing && !outgoing, silent, volume, caller?.id === 'majima' ? 'majima' : 'other');
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const expanded = expandedCall === call?.id;
  const dialog = useRef<HTMLDialogElement>(null);
  const slider = useRef<{ id: number; x: number } | null>(null);
  const [slide, setSlide] = useState(0);
  const full = connected || (ringing && (locked || expanded || outgoing));
  useLayoutEffect(() => {
    if (full) dialog.current?.showModal();
    else dialog.current?.close();
  }, [full]);
  function answer() {
    if (!ringing) return;
    dispatch({ type: 'answer-call' });
  }
  function decline() {
    dispatch({ type: 'end-call' });
    setExpandedCall(null);
  }
  if (!call || !caller || (!ringing && !connected)) return null;
  return (
    <>
      {!full && (
        <aside
          className="incoming-call-banner day-call"
          aria-label={`${name} 전화 수신`}
          role="region"
        >
          <button
            className="incoming-caller"
            onClick={() => setExpandedCall(call.id)}
            aria-label="수신 전화 전체 화면"
          >
            <img src={caller.portrait} alt="" />
            <span>
              <small>iPhone · 전화</small>
              <strong>{name}</strong>
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
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button, textarea, input, [tabindex="0"]',
            ),
          ].filter(
            (button) => !button.hasAttribute('disabled') && button.getClientRects().length > 0,
          );
          if (!buttons.length) return;
          event.preventDefault();
          event.stopPropagation();
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        }}
        aria-label={connected ? `${name} 통화` : `${name} 전화 ${outgoing ? '발신' : '수신'}`}
        onCancel={(event) => {
          event.preventDefault();
          decline();
        }}
        style={{ '--caller-photo': `url("${caller.portrait}")` } as React.CSSProperties}
      >
        <StatusBar preferences={preferences} appVisible={false} />
        <div className="call-screen-content" data-live={connected && isAiCharacter(call.caller)}>
          <div className="call-identity">
            <img src={caller.portrait} alt="" />
            {connected && (
              <p className="call-time" aria-label="통화 시간">
                {`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`}
              </p>
            )}
            <h1>{name}</h1>
            {!connected && <p className="call-kind">{outgoing ? '연결 중…' : '휴대전화'}</p>}
          </div>
          {connected ? (
            <>
              <div className="call-transcript" role="log" aria-live="polite" aria-label="통화 내용">
                {call.lines.slice(0, Math.floor(call.elapsedMs / 5000) + 1).map((line, index) => (
                  <p key={`${call.id}-${index}`}>{line}</p>
                ))}
              </div>
              {isAiCharacter(call.caller) ? (
                <CallConversation
                  key={call.id}
                  character={call.caller}
                  ai={ai}
                  online={isOnline(preferences)}
                  onBusyChange={onBusyChange}
                />
              ) : null}
              {endingCall === call.id && (
                <p className="call-live-status" role="status">
                  {call.caller === 'majima'
                    ? '내가 또 연락하께. 끊는다, 키류쨩.'
                    : call.caller === 'haruka'
                      ? '아저씨, 나중에 다시 전화할게.'
                      : '나중에 다시 연락하지.'}
                </p>
              )}
              <button
                className="call-action call-decline call-end"
                aria-label="통화 종료"
                onClick={decline}
              >
                <PhoneIcon name="call" />
              </button>
            </>
          ) : outgoing ? (
            <button
              className="call-action call-decline call-end outgoing-cancel"
              aria-label="발신 취소"
              onClick={decline}
            >
              <PhoneIcon name="call" />
            </button>
          ) : (
            <>
              <div className="call-secondary">
                <button
                  onClick={() => {
                    decline();
                    onMessage(call.caller);
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
