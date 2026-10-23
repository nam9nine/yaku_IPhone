import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { contacts, initialMessages } from './data';
import { useStoredState } from './useStoredState';
import './social.css';

type Message = { id: string; text: string; outgoing: boolean; time: string };
type MessageStore = {
  threads: Record<string, Message[]>;
  drafts: Record<string, string>;
  order: string[];
};
const initialStore: MessageStore = {
  threads: Object.fromEntries(
    contacts.map((person) => [person.id, [...(initialMessages[person.id] ?? [])]]),
  ),
  drafts: Object.fromEntries(contacts.map((person) => [person.id, ''])),
  order: contacts.map((person) => person.id),
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validStore(value: unknown): boolean {
  if (
    !record(value) ||
    !record(value.threads) ||
    !record(value.drafts) ||
    !Array.isArray(value.order)
  )
    return false;
  const { threads, drafts, order } = value;
  if (
    order.length !== contacts.length ||
    new Set(order).size !== contacts.length ||
    !order.every((id) => typeof id === 'string' && contacts.some((person) => person.id === id))
  )
    return false;
  return contacts.every(
    ({ id }) =>
      Array.isArray(threads[id]) &&
      threads[id].every(
        (message: unknown) =>
          record(message) &&
          typeof message.id === 'string' &&
          typeof message.text === 'string' &&
          typeof message.outgoing === 'boolean' &&
          typeof message.time === 'string',
      ) &&
      typeof drafts[id] === 'string',
  );
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
}: {
  active: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  online: boolean;
}) {
  const [store, setStore, storageUnavailable] = useStoredState<MessageStore>(
    'messages',
    initialStore,
    validStore,
  );
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState('');
  const root = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, number>>({});
  const previousThread = useRef<{ id: string; count: number } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const focusNext = useRef(false);
  const returnId = useRef<string | null>(null);
  const person = contacts.find((contact) => contact.id === selected);
  const thread = person ? store.threads[person.id] : [];
  const draft = person ? store.drafts[person.id] : '';
  const picking = composing && !person;
  const filtered = store.order
    .map((id) => contacts.find((contact) => contact.id === id)!)
    .filter((contact) =>
      `${contact.name} ${store.threads[contact.id].map((message) => message.text).join(' ')}`.includes(
        query.trim(),
      ),
    );
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
    if (composer.current) {
      composer.current.style.height = 'auto';
      composer.current.style.height = `${Math.min(composer.current.scrollHeight, 120)}px`;
    }
  }, [draft, person]);
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
  function send(event: FormEvent) {
    event.preventDefault();
    if (!active || !person || !draft.trim() || !online) return;
    const message: Message = {
      id: crypto.randomUUID(),
      text: draft.trim(),
      outgoing: true,
      time: new Intl.DateTimeFormat('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Seoul',
      }).format(new Date()),
    };
    setStore((current) => ({
      threads: { ...current.threads, [person.id]: [...current.threads[person.id], message] },
      drafts: { ...current.drafts, [person.id]: '' },
      order: [person.id, ...current.order.filter((id) => id !== person.id)],
    }));
    composer.current?.focus({ preventScroll: true });
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
        className={`social-header${person || picking ? ' social-header--compact' : ''}${person ? ' message-thread-header' : ''}`}
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
        ) : null}
        {person ? (
          <div className="message-recipient">
            <img src={person.portrait} alt="" />
            <h1 ref={title} tabIndex={-1} data-app-title>
              {person.name}
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
            <p className="message-local-note">이 폰 안에 저장되는 대화</p>
            {thread.map((message, index) => (
              <div
                className={`message-line${message.outgoing ? ' message-line--outgoing' : ''}${index === thread.length - 1 || thread[index + 1]?.outgoing !== message.outgoing ? ' message-line--tail' : ''}`}
                key={message.id}
              >
                <p className="message-bubble">{message.text}</p>
                {(index === thread.length - 1 ||
                  thread[index + 1]?.outgoing !== message.outgoing) && (
                  <span className="message-time">
                    {message.time}
                    {message.outgoing ? ' · 이 폰에 저장됨' : ''}
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
          <form className="message-composer" onSubmit={send} aria-label="메시지 작성">
            <div className="message-input-wrap">
              <textarea
                ref={composer}
                rows={1}
                value={draft}
                aria-label="메시지 입력"
                placeholder="메시지"
                maxLength={2000}
                onChange={(event) => {
                  const text = event.target.value;
                  setStore((current) => ({
                    ...current,
                    drafts: { ...current.drafts, [person.id]: text },
                  }));
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (event.ctrlKey || event.metaKey) &&
                    !event.nativeEvent.isComposing
                  )
                    send(event);
                }}
              />
              <button
                type="submit"
                className="message-send"
                disabled={!draft.trim() || !online}
                aria-label="메시지 보내기"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 19V5m-6 6 6-6 6 6" />
                </svg>
              </button>
            </div>
          </form>
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
              const latest = store.threads[contact.id].at(-1);
              return (
                <button
                  type="button"
                  key={contact.id}
                  className="message-list-row"
                  data-conversation={contact.id}
                  onClick={() => select(contact.id)}
                >
                  <img src={contact.portrait} alt="" />
                  <span className="message-list-copy">
                    <span className="message-list-heading">
                      <strong>{contact.name}</strong>
                      <span>{latest?.time}</span>
                      <Chevron />
                    </span>
                    <span className="message-list-preview">
                      {store.drafts[contact.id]
                        ? `임시 저장: ${store.drafts[contact.id]}`
                        : (latest?.text ?? '새로운 대화 시작')}
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
