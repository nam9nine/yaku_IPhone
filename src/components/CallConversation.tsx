import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { messageWithinLimits, type AiCharacter } from '../ai/client';
import type { AiMessengerView } from '../ai/useAiMessenger';
import { useDay } from '../day/DayContext';
import { affinityTone } from '../day/state';
import { recentPhoneEvents } from '../day/phoneEvents';
import { PhoneIcon } from '../story/PhoneIcon';
import {
  SpeechRecognitionController,
  supportsSpeechRecognition,
  type SpeechRecognitionState,
} from '../speech/recognition';

export function CallConversation({
  character,
  ai,
  online,
  onBusyChange,
}: {
  character: AiCharacter;
  ai: AiMessengerView;
  online: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { state } = useDay();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [speechState, setSpeechState] = useState<SpeechRecognitionState>('idle');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const controller = useRef<SpeechRecognitionController | null>(null);
  const draftBeforeSpeech = useRef('');
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const thread = ai.threads[character];
  const [requestIds, setRequestIds] = useState<Set<string>>(() => new Set());
  const recentMessages = thread.displayedMessages
    .filter((message) => !!message.request_id && requestIds.has(message.request_id))
    .slice(-8);
  const pendingText =
    thread.pending &&
    requestIds.has(thread.pending.requestId) &&
    !recentMessages.some(
      (message) => message.role === 'user' && message.request_id === thread.pending?.requestId,
    )
      ? thread.pending.message
      : null;
  const busy = !!thread.pending || thread.deliveryPending;
  const recognizing = speechState !== 'idle';
  const supported = supportsSpeechRecognition();
  useEffect(() => {
    onBusyChange(busy || recognizing || !!draft.trim());
    return () => onBusyChange(false);
  }, [busy, recognizing, draft, onBusyChange]);
  const ready = online && ai.status === 'ready' && thread.loaded && !thread.loading;
  useEffect(() => {
    const cancel = () => {
      controller.current?.cancel();
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', cancel);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', cancel);
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    if (!recognizing) return;
    const timer = window.setTimeout(() => controller.current?.stop(), 30_000);
    return () => window.clearTimeout(timer);
  }, [recognizing]);
  useEffect(() => {
    if (speechState !== 'stopping') return;
    const timer = window.setTimeout(() => controller.current?.cancel(), 5000);
    return () => window.clearTimeout(timer);
  }, [speechState]);
  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [thread.pending?.requestId, thread.displayedMessages.length]);
  function start() {
    if (recognizing) {
      controller.current?.stop();
      return;
    }
    if (busy || !ready) return;
    controller.current?.dispose();
    draftBeforeSpeech.current = draft.trim();
    controller.current = new SpeechRecognitionController({
      onState: setSpeechState,
      onTranscript: ({ text }) =>
        setDraft([draftBeforeSpeech.current, text].filter(Boolean).join(' ').slice(0, 1000)),
      onError: ({ message }) => setSpeechError(message),
    });
    setSpeechError(null);
    setEditing(true);
    controller.current.start();
  }
  function send() {
    if (!ready || busy || recognizing || !draft.trim() || !messageWithinLimits(draft.trim()))
      return;
    const accepted = ai.messenger.send(character, draft, true, online, {
      relationshipTone: affinityTone(state),
      phoneEvents: [
        ...recentPhoneEvents(state, character).slice(-3),
        character === 'majima' ? 'majima-call-live' : 'haruka-call-live',
      ],
    });
    if (!accepted) return;
    const pending = ai.messenger.getSnapshot().threads[character].pending;
    if (pending) setRequestIds((ids) => new Set([...ids, pending.requestId]));
    setDraft('');
    setSpeechError(null);
    setEditing(false);
    input.current?.blur();
  }
  const status = !online
    ? '연결 끊김'
    : !ready
      ? ai.status === 'error'
        ? '연결 실패'
        : '연결 중…'
      : busy
        ? '답장 대기 중'
        : speechState === 'listening'
          ? '● 음성 입력 중'
          : recognizing
            ? '음성 인식 중…'
            : '';
  return (
    <section className="call-live" aria-label="음성으로 대화">
      {(recentMessages.length > 0 || pendingText) && (
        <div
          ref={log}
          className="call-live-log"
          role="log"
          aria-label="실시간 통화 대화"
          aria-live="polite"
        >
          {recentMessages.map((message) => (
            <p key={message.id} className={message.role === 'user' ? 'call-user-line' : undefined}>
              {message.role === 'user' ? '나: ' : ''}
              {message.content}
            </p>
          ))}
          {pendingText && <p className="call-user-line">나: {pendingText}</p>}
        </div>
      )}
      <p className="call-live-status" role="status">
        {status}
      </p>
      {(speechError || thread.error || ai.error) && (
        <p className="call-live-error" role="alert">
          {speechError ?? thread.error ?? ai.error}
        </p>
      )}
      {!supported && <p className="call-live-hint">음성 인식 미지원</p>}
      {editing && (
        <div className="call-live-editor">
          <textarea
            ref={input}
            aria-label="통화에서 보낼 말"
            value={draft}
            maxLength={1000}
            rows={2}
            readOnly={recognizing}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="메시지"
          />
          <button
            disabled={
              !ready || busy || recognizing || !draft.trim() || !messageWithinLimits(draft.trim())
            }
            onClick={send}
          >
            말 보내기
          </button>
        </div>
      )}
      <div className="call-tools">
        <button
          aria-label={recognizing ? '음성 인식 마치기' : '마이크'}
          aria-pressed={recognizing}
          disabled={!supported || busy || !ready}
          onClick={start}
        >
          <span>
            <PhoneIcon name="microphone" />
          </span>
          {recognizing ? '마치기' : '마이크'}
        </button>
        <button
          disabled={recognizing || busy}
          onClick={() => {
            setEditing(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          <span aria-hidden="true">⌨</span>글로 입력
        </button>
      </div>
      {!ready && online && ai.status !== 'checking' && !thread.loading && (
        <button className="call-live-retry" onClick={() => void ai.messenger.activate(character)}>
          다시 연결
        </button>
      )}
      {thread.pending?.phase === 'failed' && (
        <button
          className="call-live-retry"
          onClick={() => ai.messenger.retry(character, true, online)}
        >
          보낸 말 다시 시도
        </button>
      )}
      {thread.failedMessage && (
        <button
          className="call-live-retry"
          onClick={() => {
            const failed = ai.messenger.takeFailedMessage(character, true);
            if (failed) {
              setDraft(failed.message);
              setEditing(true);
            }
          }}
        >
          보낸 말 수정
        </button>
      )}
    </section>
  );
}
