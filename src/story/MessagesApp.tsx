import { PhoneIcon } from './PhoneIcon';
import './messages-native.css';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { contacts } from './data';
import { useDay } from '../day/DayContext';
import { dayMessages, replyChoices, type ContactId, type DayMessage } from '../day/content';
import './social.css';

function threadMessages(id: ContactId, replied: boolean): DayMessage[] {
  const initial = dayMessages[id];
  if (!replied) return initial;
  return [
    ...initial,
    { id: `${id}-reply`, text: replyChoices[id].text, outgoing: true, time: '16:40' },
    { id: `${id}-response`, text: replyChoices[id].response, outgoing: false, time: '16:40' },
  ];
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
  onSelect,
  online,
  onOpenNote,
}: {
  active: boolean;
  selected: string | null;
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
  const root = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, number>>({});
  const previousThread = useRef<{ id: string; count: number } | null>(null);
  const focusNext = useRef(false);
  const returnId = useRef<string | null>(null);
  const person = contacts.find((contact) => contact.id === selected);
  const thread = person ? threadMessages(person.id, state.replies.includes(person.id)) : [];
  const picking = composing && !person;
  const filtered = [...contacts]
    .sort((left, right) => Number(right.id === 'haruka') - Number(left.id === 'haruka'))
    .filter((contact) => !unreadOnly || !state.readThreads.includes(contact.id))
    .filter((contact) =>
      `${contact.name} ${threadMessages(contact.id, state.replies.includes(contact.id))
        .map((message) => message.text)
        .join(' ')}`.includes(query.trim()),
    );
  useEffect(() => {
    if (active && person) dispatch({ type: 'read-thread', id: person.id });
  }, [active, person, dispatch]);
  useLayoutEffect(() => {
    if (!history.current || !person) return;
    const changedCount =
      previousThread.current?.id === person.id && previousThread.current.count !== thread.length;
    history.current.scrollTop = changedCount
      ? history.current.scrollHeight
      : (positions.current[person.id] ?? history.current.scrollHeight);
    previousThread.current = { id: person.id, count: thread.length };
  }, [person, thread.length]);
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
  const edge = useEdgeNavigation({ active, onBack: person || picking ? back : undefined });
  function send() {
    if (!active || !person || !online) return;
    dispatch({ type: 'reply', id: person.id });
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
    <section ref={root} className="social-app messages-app" aria-label="메시지 내용" {...edge}>
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
                    for (const contact of contacts)
                      dispatch({ type: 'read-thread', id: contact.id });
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
            </h1>
          </div>
        ) : (
          <h1 ref={title} tabIndex={-1} data-app-title>
            {picking ? '새로운 메시지' : '메시지'}
          </h1>
        )}
      </header>
      {storageUnavailable && (
        <p className="social-notice" role="status">
          저장 공간을 사용할 수 없어 이 화면에서만 유지됩니다.
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
            <p className="message-local-note">토요일 오후 4:40</p>
            {thread.map((message, index) => (
              <div
                className={`message-line${message.outgoing ? ' message-line--outgoing' : ''}${index === thread.length - 1 || thread[index + 1]?.outgoing !== message.outgoing ? ' message-line--tail' : ''}`}
                key={message.id}
              >
                <div className="message-bubble">
                  <p>{message.text}</p>
                  {message.noteId && (
                    <button
                      className="message-note-link"
                      onClick={() => onOpenNote(message.noteId!)}
                      aria-label="장보기 목록: 오늘 저녁 카레 메모 열기"
                    >
                      <span aria-hidden="true">▤</span>
                      <span>
                        <strong>오늘 저녁 카레</strong>
                        <small>장보기 목록 · 메모</small>
                      </span>
                    </button>
                  )}
                </div>
                {(index === thread.length - 1 ||
                  thread[index + 1]?.outgoing !== message.outgoing) && (
                  <span className="message-time">
                    {message.time}
                    {message.outgoing ? ' · 전송됨' : ''}
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
          <div className="message-composer" aria-label="메시지 작성">
            {state.replies.includes(person.id) ? (
              <p className="message-choice-status" role="status">
                답장을 보냈습니다.
              </p>
            ) : (
              <div className="message-input-wrap message-choice-wrap">
                <button
                  type="button"
                  className="message-choice"
                  onClick={send}
                  disabled={!online || (person.id === 'haruka' && !shoppingDone)}
                  aria-label={`${replyChoices[person.id].text} 보내기`}
                >
                  <span>{replyChoices[person.id].text}</span>
                  <span className="message-send" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 19V5m-6 6 6-6 6 6" />
                    </svg>
                  </span>
                </button>
              </div>
            )}
            {person.id === 'haruka' && !shoppingDone && !state.replySent && (
              <p className="message-choice-status">장보기 목록을 모두 체크하면 답장할 수 있어요.</p>
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
              const latest = threadMessages(contact.id, state.replies.includes(contact.id)).at(-1);
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
                    aria-label={state.readThreads.includes(contact.id) ? undefined : '읽지 않음'}
                    data-unread={!state.readThreads.includes(contact.id)}
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
