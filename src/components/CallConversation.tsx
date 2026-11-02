import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { messageWithinLimits, type AiCharacter } from '../ai/client';
import type { AiMessengerView } from '../ai/useAiMessenger';
import { CallRecording, supportsCallRecording, useRecordedSpeech } from '../speech/recording';
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
  const { state, dispatch } = useDay();
  const [draft, setDraft] = useState('');
  const [speechState, setSpeechState] = useState<SpeechRecognitionState>('idle');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const audio = useRef<CallRecording | null>(null);
  const [audioStarting, setAudioStarting] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const mounted = useRef(true);
  const controller = useRef<SpeechRecognitionController | null>(null);
  const speechRun = useRef(0);
  const recognizedText = useRef('');
  const [transcribing, setTranscribing] = useState(false);
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
  const waitingForReply =
    (!!thread.pending && thread.pending.phase !== 'failed') || thread.deliveryPending;
  const recognizing = speechState !== 'idle';
  const recordedSpeech = useRecordedSpeech() || !supportsSpeechRecognition();
  const supported = recordedSpeech ? supportsCallRecording() : supportsSpeechRecognition();
  useEffect(() => {
    onBusyChange(waitingForReply || recognizing || audioStarting || audioActive || transcribing);
    return () => onBusyChange(false);
  }, [waitingForReply, recognizing, audioStarting, audioActive, transcribing, onBusyChange]);
  function noteInput() {
    const call = state.call;
    if (call?.caller === character)
      dispatch({ type: 'call-input', callId: call.id, requestId: call.followupRequestId });
  }
  const ready = online && ai.status === 'ready' && thread.loaded && !thread.loading;
  useEffect(() => {
    mounted.current = true;
    const invalidateRun = () => {
      speechRun.current++;
    };
    const cancel = () => {
      invalidateRun();
      controller.current?.cancel();
      audio.current?.stop();
      setSpeechState('idle');
      setAudioActive(false);
      setAudioStarting(false);
      setTranscribing(false);
      setDraft('');
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', cancel);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', cancel);
      mounted.current = false;
      invalidateRun();
      audio.current?.stop();
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
  async function start() {
    if (audioStarting && !audioActive && !recognizing) {
      speechRun.current++;
      audio.current?.stop();
      setAudioStarting(false);
      setAudioActive(false);
      setTranscribing(false);
      return;
    }
    if (recognizing || audioActive || audioStarting) {
      controller.current?.stop();
      audio.current?.stop();
      return;
    }
    if (busy || transcribing || !ready || !ai.connection) return;
    const run = ++speechRun.current;
    const current = () => mounted.current && speechRun.current === run;
    controller.current?.dispose();
    setDraft('');
    recognizedText.current = '';
    setSpeechError(null);
    noteInput();
    const capture = new CallRecording((active) => {
      if (!current()) return;
      setAudioActive(active);
      if (recordedSpeech && !active) setTranscribing(true);
    });
    audio.current = capture;
    if (recordedSpeech) {
      // One microphone owner: the same saved audio is transcribed on the Mac.
      setAudioStarting(true);
      try {
        if (!(await capture.start(ai.connection, character, { transcribe: true })) || !current())
          return;
        setAudioStarting(false);
        await capture.saved;
        if (!current()) return;
        const text = capture.transcript;
        setDraft(text);
        if (text) noteInput();
        else setSpeechError('말소리를 듣지 못했어요. 다시 시도해 주세요.');
      } catch (error) {
        if (current()) setSpeechError(error instanceof Error ? error.message : '마이크 시작 실패');
      } finally {
        if (current()) {
          setAudioStarting(false);
          setAudioActive(false);
          setTranscribing(false);
        }
      }
      return;
    }
    controller.current = new SpeechRecognitionController({
      onState: (value) => {
        if (!current()) return;
        setSpeechState(value);
        if (value === 'idle') capture.stop();
      },
      onTranscript: ({ text }) => {
        if (!current()) return;
        recognizedText.current = text;
        if (text) noteInput();
        setDraft(text);
      },
      onEnd: () => {
        if (current() && !recognizedText.current)
          setSpeechError('말소리를 듣지 못했어요. 다시 시도해 주세요.');
      },
      onError: ({ message }) => {
        if (current()) setSpeechError(message);
      },
    });
    // Native desktop recognition starts inside the original tap. An optional
    // archive failure must not cancel otherwise working recognition.
    if (!controller.current.start()) return;
    setAudioStarting(true);
    try {
      if (await capture.start(ai.connection, character))
        void capture.saved.catch(() => {
          if (current()) setSpeechError('음성 저장 실패');
        });
    } catch {
      if (current()) setSpeechError('음성 저장 실패');
    } finally {
      if (current()) setAudioStarting(false);
    }
  }
  function send() {
    if (
      !ready ||
      busy ||
      recognizing ||
      audioStarting ||
      audioActive ||
      transcribing ||
      !draft.trim() ||
      !messageWithinLimits(draft.trim())
    )
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
  }
  const status = !online
    ? '연결 끊김'
    : !ready
      ? ai.status === 'error'
        ? '연결 실패'
        : '연결 중…'
      : busy
        ? '답장 대기 중'
        : transcribing || speechState === 'stopping'
          ? '음성 인식 중…'
          : audioStarting || speechState === 'starting'
            ? '마이크 연결 중…'
            : audioActive || speechState === 'listening'
              ? '듣는 중…'
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
      {(draft || recognizing || audioActive || transcribing) && (
        <div className="call-live-editor">
          <p className="call-live-transcript" aria-label="인식한 말">
            {draft || '…'}
          </p>
          <button
            disabled={
              !ready ||
              busy ||
              recognizing ||
              audioStarting ||
              audioActive ||
              transcribing ||
              !draft.trim() ||
              !messageWithinLimits(draft.trim())
            }
            onClick={send}
          >
            말 보내기
          </button>
        </div>
      )}
      <div className="call-tools">
        <button
          aria-label={recognizing || audioActive || audioStarting ? '마이크 끄기' : '마이크'}
          aria-pressed={recognizing || audioActive || audioStarting}
          disabled={!supported || busy || transcribing || !ready}
          onClick={() => void start()}
        >
          <span>
            <PhoneIcon name="microphone" />
          </span>
          마이크
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
            ai.messenger.takeFailedMessage(character, true);
            setDraft('');
            setSpeechError(null);
          }}
        >
          다시 말하기
        </button>
      )}
    </section>
  );
}
