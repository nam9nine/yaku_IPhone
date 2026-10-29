import { PushControls } from '../ai/PushControls';
import { messageSentSound } from '../ai/replySound';
import { PhoneIcon } from './PhoneIcon';
import './messages-native.css';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { contacts } from './data';
import { useDay } from '../day/DayContext';
import { dayNotes, type ContactId, type DayMessage } from '../day/content';
import { affinityTone, getStoryChoices } from '../day/state';
import { recentPhoneEvents } from '../day/phoneEvents';
import './social.css';
import {
  AI_MAX_MESSAGE_LENGTH,
  isAiCharacter,
  messageWithinLimits,
  shouldSendOnEnter,
} from '../ai/client';
import type { AiMessengerView } from '../ai/useAiMessenger';
import { aiDate, aiTime } from '../ai/time';
import { storyThreadMessages } from '../ai/storyMessages';
import { conversationRestDeadline } from '../ai/chatPacing';
import { mergeMessageTimeline } from '../ai/messageOrder';

interface VisibleMessage extends DayMessage {
  displayedAt?: number;
  delivery?: string;
  day?: string;
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
function Compose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6M15 4l5 5M9 15l1-5L19 1l5 5-9 9-5 1Z"
        transform="translate(0 1) scale(.9)"
      />
    </svg>
  );
}

export function MessagesApp({
  active,
  selected,
  requestedLatest,
  onSelect,
  online,
  onOpenNote,
  ai,
}: {
  ai: AiMessengerView;
  active: boolean;
  selected: string | null;
  requestedLatest: number;
  onSelect: (id: string | null) => void;
  online: boolean;
  onOpenNote: (id: string) => void;
}) {
  const { state, dispatch, shoppingDone, storageUnavailable } = useDay();
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [editMenu, setEditMenu] = useState(false);
  const [composing, setComposing] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState('');
  const person = contacts.find((contact) => contact.id === selected);
  const aiCharacter = isAiCharacter(person?.id) ? person.id : null;
  const [drafts, setDrafts] = useState({ haruka: '', majima: '' });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, number>>({});
  const [editingFailed, setEditingFailed] = useState(false);
  const focusFailed = useRef(false);
  const [pacingNow, setPacingNow] = useState(() => Date.now());
  const previousThread = useRef<{ id: string; count: number } | null>(null);
  const olderAnchor = useRef<{ id: string; top: number; height: number } | null>(null);
  const handledLatest = useRef(requestedLatest);
  const focusNext = useRef(false);
  const returnId = useRef<string | null>(null);
  const aiEnabled = !!aiCharacter;
  const aiThread = aiCharacter ? ai.threads[aiCharacter] : null;
  function visibleMessages(id: ContactId): VisibleMessage[] {
    const story = storyThreadMessages(id, state);
    if (!isAiCharacter(id)) return story;
    const remote = ai.threads[id];
    return mergeMessageTimeline<VisibleMessage>(story, [
      ...remote.displayedMessages.map((message, index) => ({
        id: `ai-${message.id}`,
        displayedAt: message.displayedAt,
        text: message.content,
        outgoing: message.role === 'user',
        delivery:
          message.role !== 'user'
            ? undefined
            : message.status === 'error' || message.status === 'interrupted'
              ? '답장 실패'
              : (message.request_id && remote.readRequestIds.includes(message.request_id)) ||
                  remote.displayedMessages[index + 1]?.role === 'assistant'
                ? '읽음'
                : '전송됨',
        time: aiTime(message.time),
        day:
          index === 0 || aiDate(message.time) !== aiDate(remote.displayedMessages[index - 1].time)
            ? aiDate(message.time)
            : undefined,
      })),
      ...(remote.failedMessage &&
      !remote.messages.some((message) => message.id === remote.failedMessage?.historyId)
        ? [
            {
              id: `ai-failed-${remote.failedMessage.time}`,
              displayedAt: remote.failedMessage.time
                ? Date.parse(remote.failedMessage.time)
                : undefined,
              text: remote.failedMessage.message,
              outgoing: true,
              time: aiTime(remote.failedMessage.time),
              delivery: remote.failedMessage.reason === 'input' ? '전송되지 않음' : '답장 실패',
            },
          ]
        : []),
      ...(remote.pending?.message &&
      !remote.messages.some((message) => message.id === remote.pending?.historyId)
        ? [
            {
              id: `ai-pending-${remote.pending.requestId}`,
              displayedAt: remote.pending.time ? Date.parse(remote.pending.time) : undefined,
              text: remote.pending.message,
              outgoing: true,
              time: aiTime(remote.pending.time),
              day:
                aiDate(remote.pending.time) !== aiDate(remote.messages.at(-1)?.time ?? '')
                  ? aiDate(remote.pending.time)
                  : undefined,
              delivery:
                remote.pending.phase === 'failed'
                  ? '전송 상태 확인 필요'
                  : remote.readRequestIds.includes(remote.pending.requestId)
                    ? '읽음'
                    : remote.pending.jobId
                      ? '전송됨'
                      : '보내는 중…',
            },
          ]
        : []),
    ]);
  }
  const thread = person ? visibleMessages(person.id) : [];
  const draft = aiCharacter ? drafts[aiCharacter] : '';
  const choices = person ? getStoryChoices(state, person.id) : [];
  const storyPending = person ? state.storyPending[person.id] : undefined;
  const aiBusy = !!(aiThread?.pending || aiThread?.deliveryPending);
  const sentCount = aiThread?.completedCount ?? 0;
  // A short choice interlude after three texts makes room for the rest of the phone.
  // These are pacing defaults, not a claim about the character's canonical behavior.
  const choiceInterlude =
    person?.id === 'majima' && sentCount > 0 && sentCount % 3 === 0 && choices.length > 0;
  const freeText = person?.id === 'majima' && (!choiceInterlude || editingFailed);
  const restDeadline =
    person?.id === 'majima' && !choices.length
      ? conversationRestDeadline(aiThread?.displayedMessages ?? [], sentCount)
      : 0;
  const resting = !editingFailed && restDeadline > pacingNow;
  useEffect(() => {
    if (!restDeadline) return;
    const timer = setTimeout(
      () => setPacingNow(Date.now()),
      Math.max(0, restDeadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [restDeadline]);
  useLayoutEffect(() => {
    if (active && freeText && focusFailed.current && textarea.current) {
      textarea.current.focus();
      focusFailed.current = false;
    }
  }, [active, freeText, editingFailed]);
  const canStartAi =
    active &&
    online &&
    ai.status === 'ready' &&
    !!aiThread?.loaded &&
    !aiThread.loading &&
    !aiThread.pending &&
    !aiThread.deliveryPending &&
    !storyPending &&
    !resting;
  const canSendAi = canStartAi && !!draft.trim() && messageWithinLimits(draft.trim());
  const isUnread = (id: ContactId) =>
    !state.readThreads.includes(id) || (isAiCharacter(id) && ai.threads[id].unread);
  const picking = composing && !person;
  const filtered = [...contacts]
    .sort((left, right) => Number(right.id === 'haruka') - Number(left.id === 'haruka'))
    .filter((contact) => !unreadOnly || isUnread(contact.id))
    .filter((contact) =>
      `${contact.name} ${visibleMessages(contact.id)
        .map((message) => message.text)
        .join(' ')}`.includes(query.trim()),
    );
  useEffect(() => {
    if (active && person) {
      dispatch({ type: 'read-thread', id: person.id });
      if (isAiCharacter(person.id)) ai.messenger.markRead(person.id);
    }
  }, [active, person, dispatch, ai.messenger, state.storySequence]);
  useEffect(() => {
    if (!ai.connection) return;
    for (const id of ['haruka', 'majima'] as const) {
      const remote = ai.threads[id];
      if (remote.pending || remote.deliveryPending) continue;
      const available = getStoryChoices(state, id);
      const completed = available.find((choice) =>
        remote.messages.some(
          (message, index) =>
            message.role === 'user' &&
            message.content === choice.text &&
            message.status === 'complete' &&
            !!message.request_id &&
            remote.messages[index + 1]?.role === 'assistant' &&
            remote.messages[index + 1]?.request_id === message.request_id,
        ),
      );
      if (completed) dispatch({ type: 'story-choice', id, choiceId: completed.id, source: 'ai' });
    }
  }, [ai.connection, ai.threads, state, dispatch]);
  useLayoutEffect(() => {
    if (!active || !history.current || !person) return;
    const sameThread = previousThread.current?.id === person.id;
    const changedCount = sameThread && previousThread.current?.count !== thread.length;
    const anchor = olderAnchor.current;
    if (handledLatest.current !== requestedLatest) {
      olderAnchor.current = null;
      history.current.scrollTop = history.current.scrollHeight;
    } else if (anchor?.id === person.id && !aiThread?.loadingOlder) {
      history.current.scrollTop = history.current.scrollHeight - anchor.height + anchor.top;
      olderAnchor.current = null;
    } else if (!anchor) {
      history.current.scrollTop = changedCount
        ? history.current.scrollHeight
        : (positions.current[person.id] ?? history.current.scrollHeight);
    }
    previousThread.current = { id: person.id, count: thread.length };
    handledLatest.current = requestedLatest;
  }, [active, person, thread.length, aiThread?.loadingOlder, requestedLatest]);
  useLayoutEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 120)}px`;
  }, [draft, aiCharacter, aiEnabled, active]);
  useEffect(() => {
    const viewport = history.current;
    if (!aiEnabled || !viewport) return;
    const observer = new ResizeObserver(() => {
      if (document.activeElement === textarea.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [aiEnabled, person]);
  useLayoutEffect(() => {
    if (!active || !focusNext.current) return;
    focusNext.current = false;
    const target =
      !person && !picking && returnId.current
        ? root.current?.querySelector<HTMLElement>(`[data-conversation="${returnId.current}"]`)
        : null;
    (target ?? title.current)?.focus({ preventScroll: true });
    returnId.current = null;
  }, [person, picking, active]);
  function select(id: string) {
    setComposing(false);
    focusNext.current = true;
    onSelect(id);
  }
  function back() {
    if (!person && !picking) return;
    returnId.current = person?.id ?? null;
    focusNext.current = true;
    setComposing(false);
    onSelect(null);
  }
  const edge = useEdgeNavigation({
    active,
    onBack: person || picking ? back : undefined,
  });
  function sendAi() {
    if (!aiCharacter || !canSendAi || !freeText) return;
    if (
      ai.messenger.send(aiCharacter, draft, active, online, {
        relationshipTone: affinityTone(state),
        phoneEvents: recentPhoneEvents(state, aiCharacter),
      })
    ) {
      messageSentSound();
      setDrafts((current) => ({ ...current, [aiCharacter]: '' }));
      setEditingFailed(false);
    }
  }
  function sendChoice(choice: (typeof choices)[number]) {
    if (!active || !person || !online || storyPending) return;
    if (aiEnabled && aiCharacter) {
      if (!canStartAi) return;
      const nextAffinity = Math.max(-5, Math.min(5, state.affinity + (choice.affinityDelta ?? 0)));
      if (
        ai.messenger.send(aiCharacter, choice.text, active, online, {
          relationshipTone: affinityTone({ ...state, affinity: nextAffinity }),
          phoneEvents: recentPhoneEvents(state, aiCharacter),
        })
      ) {
        messageSentSound();
        setEditingFailed(false);
        focusFailed.current = false;
        setDrafts((current) => ({ ...current, [aiCharacter]: '' }));
      }
      return;
    }
    dispatch({ type: 'story-choice', id: person.id, choiceId: choice.id });
    messageSentSound();
  }
  function rewriteFailed() {
    if (!aiCharacter || !active) return;
    if (aiCharacter === 'haruka') {
      const failed = aiThread?.failedMessage;
      if (
        failed &&
        canStartAi &&
        ai.messenger.send(aiCharacter, failed.message, active, online, {
          phoneEvents: recentPhoneEvents(state, aiCharacter),
        })
      ) {
        ai.messenger.takeFailedMessage(aiCharacter, active);
        messageSentSound();
      }
      return;
    }
    const failed = ai.messenger.takeFailedMessage(aiCharacter, active);
    if (!failed) return;
    focusFailed.current = true;
    setEditingFailed(true);
    setDrafts((current) => ({
      ...current,
      [aiCharacter]: current[aiCharacter]
        ? `${failed.message}\n${current[aiCharacter]}`
        : failed.message,
    }));
    textarea.current?.focus();
  }
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (active && (person || picking) && event.key === 'Escape') {
      event.preventDefault();
      back();
    }
  });
  useEffect(() => {
    if (!active) return;
    const handle = (event: KeyboardEvent) => keyboard(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [active]);
  return (
    <section
      ref={root}
      className="social-app messages-app"
      data-thread={!!person}
      aria-label="메시지 내용"
      {...edge}
    >
      <header
        className={`social-header social-header--compact${person ? ' message-thread-header' : ''}`}
      >
        {person || picking ? (
          <button
            type="button"
            className="social-back"
            onClick={back}
            aria-label="메시지 목록으로 돌아가기"
          >
            <Chevron />
            {person &&
              contacts.some((contact) => contact.id !== person.id && isUnread(contact.id)) && (
                <span className="message-back-count" aria-hidden="true">
                  {
                    contacts.filter((contact) => contact.id !== person.id && isUnread(contact.id))
                      .length
                  }
                </span>
              )}
          </button>
        ) : (
          <>
            <button
              className="message-edit social-circle"
              aria-expanded={editMenu}
              onClick={() => setEditMenu(!editMenu)}
            >
              편집
            </button>
            <button
              className="message-filter social-circle"
              aria-label="읽지 않은 메시지만 보기"
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly(!unreadOnly)}
            >
              <PhoneIcon name="menu" />
            </button>
            {editMenu && (
              <div className="message-edit-menu">
                <button
                  onClick={() => {
                    for (const contact of contacts) {
                      dispatch({ type: 'read-thread', id: contact.id });
                      if (isAiCharacter(contact.id)) ai.messenger.markRead(contact.id);
                    }
                    setEditMenu(false);
                  }}
                >
                  모두 읽음으로 표시
                </button>
                <button onClick={() => setEditMenu(false)}>취소</button>
              </div>
            )}
          </>
        )}
        {person ? (
          <div className="message-recipient">
            <img src={person.portrait} alt="" />
            <h1 ref={title} tabIndex={-1} data-app-title>
              {person.shortName}
              <Chevron />
            </h1>
          </div>
        ) : (
          <h1 ref={title} tabIndex={-1} data-app-title>
            {picking ? '새로운 메시지' : '메시지'}
          </h1>
        )}
        <PushControls connection={ai.connection} active={active} />
      </header>
      {(storageUnavailable || ai.storageUnavailable) && (
        <p className="social-notice" role="status">
          {ai.storageError ?? '저장 공간을 사용할 수 없어 이 화면에서만 유지됩니다.'}
        </p>
      )}
      {person ? (
        <>
          <div
            className="social-scroll message-history"
            ref={history}
            onScroll={(event) => {
              positions.current[person.id] = event.currentTarget.scrollTop;
            }}
            role="log"
            aria-label={`${person.name}와의 대화`}
            aria-live="polite"
          >
            {aiThread?.nextCursor && aiCharacter && (
              <button
                type="button"
                className="message-load-older"
                disabled={aiThread.loadingOlder || !active || !online}
                onClick={() => {
                  if (history.current)
                    olderAnchor.current = {
                      id: person.id,
                      top: history.current.scrollTop,
                      height: history.current.scrollHeight,
                    };
                  void ai.messenger.loadOlder(aiCharacter);
                }}
              >
                {aiThread.loadingOlder ? '불러오는 중…' : '이전 대화 더 보기'}
              </button>
            )}
            {!aiEnabled && <p className="message-local-note">토요일 오후 4:40</p>}
            {thread.map((message, index) => (
              <div
                className={`message-line${message.outgoing ? ' message-line--outgoing' : ''}${index === thread.length - 1 || thread[index + 1]?.outgoing !== message.outgoing ? ' message-line--tail' : ''}`}
                key={message.id}
              >
                {message.day && <p className="message-local-note message-ai-date">{message.day}</p>}
                <div className="message-bubble">
                  <p>{message.text}</p>
                  {message.noteId && (
                    <button
                      className="message-note-link"
                      onClick={() => onOpenNote(message.noteId!)}
                      aria-label={`${dayNotes.find((note) => note.id === message.noteId)?.title ?? '메모'} 열기`}
                    >
                      <span aria-hidden="true">▤</span>
                      <span>
                        <strong>
                          {dayNotes.find((note) => note.id === message.noteId)?.title ?? '메모'}
                        </strong>
                        <small>메모</small>
                      </span>
                    </button>
                  )}
                </div>
                {(index === thread.length - 1 ||
                  thread[index + 1]?.outgoing !== message.outgoing) && (
                  <span className="message-time">
                    {message.time}
                    {message.outgoing
                      ? `${message.time ? ' · ' : ''}${message.delivery ?? '전송됨'}`
                      : ''}
                  </span>
                )}
              </div>
            ))}
            {!thread.length && (
              <p className="social-empty">{person.shortName}에게 첫 메시지를 보내보세요.</p>
            )}
          </div>
          {!online && (
            <p className="social-notice" role="status">
              연결 끊김 · 연결 후 보낼 수 있습니다.
            </p>
          )}
          {person.id === 'majima' && (
            <p className="message-bond" aria-label={`마지마와의 인연 ${state.affinity}`}>
              <span aria-hidden="true">♡</span>{' '}
              {state.affinity > 0
                ? '조금 더 가까워진 사이'
                : state.affinity < 0
                  ? '조금 서먹한 사이'
                  : '익숙한 사이'}
            </p>
          )}
          <div
            className={`message-composer${aiEnabled ? ' message-composer--ai' : ''}`}
            aria-label="메시지 작성"
            onMouseDown={(event) => {
              // Keep the composer in place until the normal click. A pointer
              // focus change can add/remove its home-gesture spacing before
              // pointerup, moving send/retry/rewrite away from the finger.
              // Keyboard focus and normal click activation remain available.
              if (
                event.button === 0 &&
                event.target instanceof Element &&
                event.target.closest('button')
              )
                event.preventDefault();
            }}
          >
            {aiEnabled && aiCharacter && aiThread ? (
              <>
                {(ai.error || aiThread.error) && (
                  <div className="message-ai-notice" role="status">
                    <span>{ai.error ?? aiThread.error}</span>
                    {aiThread.failedMessage && !ai.error ? (
                      <button disabled={!active} onClick={rewriteFailed}>
                        {person.id === 'haruka' ? '다시 보내기' : '다시 작성'}
                      </button>
                    ) : aiThread.pending?.phase === 'failed' && ai.status === 'ready' ? (
                      <button
                        disabled={!active || !online}
                        onClick={() => ai.messenger.retry(aiCharacter, active, online)}
                      >
                        다시 시도
                      </button>
                    ) : (
                      <button
                        disabled={!active || !online || ai.status === 'checking'}
                        onClick={() => void ai.messenger.refresh()}
                      >
                        다시 시도
                      </button>
                    )}
                  </div>
                )}
                {aiThread.failedMessage && !aiThread.error && !ai.error && (
                  <div className="message-ai-notice">
                    <button disabled={!active} onClick={rewriteFailed}>
                      {person.id === 'haruka' ? '다시 보내기' : '다시 작성'}
                    </button>
                  </div>
                )}
                {!messageWithinLimits(draft.trim()) && (
                  <p className="message-choice-status" role="status">
                    메시지를 1000자 이내로 줄여 주세요.
                  </p>
                )}
                {!ai.error && !aiThread.error && (ai.status === 'checking' || aiThread.loading) && (
                  <p className="message-choice-status" role="status">
                    대화를 불러오는 중…
                  </p>
                )}
                {aiThread.pending?.phase === 'failed' &&
                  !aiThread.error &&
                  !ai.error &&
                  online &&
                  ai.status === 'ready' && (
                    <div className="message-ai-notice" role="status">
                      <span>이전 메시지의 전송 상태를 확인해 주세요.</span>
                      <button
                        disabled={!active}
                        onClick={() => ai.messenger.retry(aiCharacter, active, online)}
                      >
                        다시 시도
                      </button>
                    </div>
                  )}
                {aiBusy && !ai.error && !aiThread.error && (
                  <p className="message-choice-status" role="status">
                    답장 대기 중 · 다른 연락처에는 보낼 수 있어요.
                  </p>
                )}
                {resting && !aiBusy && (
                  <p className="message-choice-status">
                    잠깐 다른 일을 둘러보세요. 조금 뒤 다시 보낼 수 있어요.
                  </p>
                )}
                {choiceInterlude && !aiBusy && !editingFailed && (
                  <p className="message-choice-status">이번에는 짧은 답장을 골라보세요.</p>
                )}
                {freeText && (
                  <form
                    className="message-input-wrap message-ai-input"
                    onSubmit={(event) => {
                      event.preventDefault();
                      sendAi();
                    }}
                  >
                    <textarea
                      ref={textarea}
                      rows={1}
                      aria-label={`${person.shortName}에게 메시지 입력`}
                      placeholder="메시지"
                      maxLength={AI_MAX_MESSAGE_LENGTH}
                      value={draft}
                      disabled={!active}
                      onFocus={() => {
                        if (history.current)
                          history.current.scrollTop = history.current.scrollHeight;
                      }}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [aiCharacter]: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (shouldSendOnEnter(event.nativeEvent)) {
                          event.preventDefault();
                          sendAi();
                        }
                      }}
                    />
                    <button
                      className="message-send"
                      type="submit"
                      aria-label="메시지 보내기"
                      disabled={!canSendAi}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 19V5m-6 6 6-6 6 6" />
                      </svg>
                    </button>
                  </form>
                )}
                {choices.length > 0 && (person.id === 'haruka' || choiceInterlude) && (
                  <div className="message-choice-list" aria-label="답장 선택">
                    {choices.map((choice) => (
                      <button
                        className="message-story-reply"
                        key={choice.id}
                        type="button"
                        onClick={() => sendChoice(choice)}
                        disabled={!canStartAi}
                        aria-label={`${choice.text} 보내기`}
                      >
                        {choice.text}
                      </button>
                    ))}
                  </div>
                )}
                {person.id === 'haruka' && !aiBusy && choices.length === 0 && (
                  <p className="message-choice-status">
                    {!shoppingDone
                      ? '메모의 장보기 목록부터 확인해 보세요.'
                      : '새로운 할 일이 생기면 짧게 연락해 보세요.'}
                  </p>
                )}
              </>
            ) : storyPending ? (
              <p className="message-choice-status" role="status">
                답장 대기 중 · 다른 연락처에는 보낼 수 있어요.
              </p>
            ) : choices.length > 0 ? (
              <div className="message-choice-list" aria-label="답장 선택">
                {choices.map((choice) => (
                  <button
                    type="button"
                    key={choice.id}
                    className="message-story-reply"
                    onClick={() => sendChoice(choice)}
                    disabled={!active || !online}
                    aria-label={`${choice.text} 보내기`}
                  >
                    {choice.text}
                  </button>
                ))}
              </div>
            ) : (
              <p className="message-choice-status" role="status">
                지금은 새로 보낼 답장이 없습니다.
              </p>
            )}
          </div>
        </>
      ) : picking ? (
        <>
          <label className="message-recipient-search">
            <span>받는 사람:</span>
            <input
              type="search"
              aria-label="받는 사람 검색"
              placeholder="이름"
              value={recipientQuery}
              onChange={(event) => setRecipientQuery(event.target.value)}
            />
          </label>
          <div className="social-scroll">
            <p className="message-picker-label">연락처</p>
            {contacts
              .filter((contact) =>
                `${contact.name} ${contact.shortName}`.includes(recipientQuery.trim()),
              )
              .map((contact) => (
                <button
                  type="button"
                  className="message-picker-row"
                  key={contact.id}
                  onClick={() => select(contact.id)}
                >
                  <img src={contact.portrait} alt="" />
                  <span>{contact.name}</span>
                </button>
              ))}
            {!contacts.some((contact) =>
              `${contact.name} ${contact.shortName}`.includes(recipientQuery.trim()),
            ) && (
              <p className="social-empty" role="status">
                검색 결과 없음
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="social-scroll message-list">
            {filtered.map((contact) => {
              const latest = visibleMessages(contact.id).at(-1);
              return (
                <button
                  type="button"
                  key={contact.id}
                  className="message-list-row"
                  data-conversation={contact.id}
                  onClick={() => select(contact.id)}
                >
                  <span
                    className="message-unread"
                    aria-label={isUnread(contact.id) ? '읽지 않음' : undefined}
                    data-unread={isUnread(contact.id)}
                  />
                  <img src={contact.portrait} alt="" />
                  <span className="message-list-copy">
                    <span className="message-list-heading">
                      <strong>{contact.name}</strong>
                      <span>{latest?.time}</span>
                      <Chevron />
                    </span>
                    <span className="message-list-preview">
                      {latest?.text ?? '새로운 대화 시작'}
                    </span>
                  </span>
                </button>
              );
            })}
            {!filtered.length && (
              <p className="social-empty" role="status">
                검색 결과 없음
              </p>
            )}
          </div>
          <footer className="social-toolbar">
            <label className="social-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <input
                type="search"
                aria-label="메시지 검색"
                placeholder="검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
              <PhoneIcon name="microphone" />
            </label>
            <button
              type="button"
              className="social-circle"
              aria-label="새로운 메시지"
              onClick={() => {
                setRecipientQuery('');
                focusNext.current = true;
                setComposing(true);
              }}
            >
              <Compose />
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
