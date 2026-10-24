import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { contacts } from './data';
import './social.css';
import './contacts.css';
import { useDay } from '../day/DayContext';
import { PhoneIcon } from './PhoneIcon';

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}
function initial(name: string) {
  const code = name.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171
    ? 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor(code / 588)]
    : name[0].toUpperCase();
}

export function ContactsApp({
  active,
  onMessage,
  requestedContact = null,
}: {
  active: boolean;
  onMessage: (id: string) => void;
  requestedContact?: { id: string; key: number } | null;
}) {
  const [selected, setSelected] = useState<string | null>(requestedContact?.id ?? null);
  const [query, setQuery] = useState('');
  const [lastRequest, setLastRequest] = useState(requestedContact);
  if (lastRequest !== requestedContact) {
    setLastRequest(requestedContact);
    if (requestedContact) setSelected(requestedContact.id);
  }
  const { extraContacts, setExtraContacts } = useDay();
  const people = useMemo(
    () => [
      ...contacts,
      ...extraContacts.map((person) => ({
        ...person,
        shortName: person.name,
        relation: person.phone || '연락처',
        about: '연락처',
        portrait: '',
      })),
    ],
    [extraContacts],
  );
  const [myCard, setMyCard] = useState(false);
  const addDialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  useLayoutEffect(() => {
    if (!active) addDialog.current?.close();
  }, [active]);
  const container = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const focusNext = useRef(false);
  const returnId = useRef<string | null>(null);
  const contact = useMemo(
    () =>
      myCard
        ? {
            id: 'kiryu',
            name: '키류 카즈마',
            portrait: `${import.meta.env.BASE_URL}story/kiryu.jpg`,
            relation: '나팔꽃',
            about: '키류의 iPhone · 하루카가 정리를 도와줬다.',
          }
        : people.find((person) => person.id === selected),
    [myCard, people, selected],
  );
  const filtered = people
    .filter((person) =>
      `${person.name} ${person.shortName} ${person.relation}`.includes(query.trim()),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const groups = [...new Set(filtered.map((person) => initial(person.name)))];
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = contact ? 0 : listPosition.current;
  }, [contact]);
  useLayoutEffect(() => {
    if (!active || !focusNext.current) return;
    focusNext.current = false;
    const target =
      !contact && returnId.current
        ? container.current?.querySelector<HTMLElement>(`[data-contact="${returnId.current}"]`)
        : null;
    (target ?? title.current)?.focus({ preventScroll: true });
    returnId.current = null;
  }, [contact, active]);
  function back() {
    if (!contact) return;
    returnId.current = contact.id;
    focusNext.current = true;
    setSelected(null);
    setMyCard(false);
  }
  const edge = useEdgeNavigation({ active, onBack: contact ? back : undefined });
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (active && contact && event.key === 'Escape') {
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
    <section className="social-app contacts-app" ref={container} aria-label="연락처 내용" {...edge}>
      <header className="social-header social-header--compact contacts-header">
        {contact ? (
          <button
            type="button"
            className="social-back"
            onClick={back}
            aria-label="연락처 목록으로 돌아가기"
          >
            <BackIcon />
          </button>
        ) : (
          <button
            type="button"
            className="social-back"
            onClick={() => {
              setQuery('');
              scrollArea.current?.scrollTo({ top: 0 });
            }}
            aria-label="모든 연락처 보기"
          >
            <BackIcon />
          </button>
        )}
        <h1 ref={contact ? undefined : title} tabIndex={-1} data-app-title={!contact || undefined}>
          {contact ? '' : '연락처'}
        </h1>
        {!contact && (
          <button
            className="contacts-add social-circle"
            aria-label="새로운 연락처"
            onClick={() => addDialog.current?.showModal()}
          >
            +
          </button>
        )}
      </header>
      {!contact && (
        <label className="social-search contacts-search">
          <SearchIcon />
          <input
            type="search"
            aria-label="연락처 검색"
            placeholder="검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          <PhoneIcon name="microphone" />
        </label>
      )}
      <div
        className="social-scroll contacts-scroll"
        ref={scrollArea}
        onScroll={(event) => {
          if (!contact) listPosition.current = event.currentTarget.scrollTop;
        }}
      >
        {contact ? (
          <>
            <div className="contact-hero">
              <img
                className="contact-portrait"
                src={contact.portrait || `${import.meta.env.BASE_URL}story/kiryu.jpg`}
                alt={`${contact.name} 프로필`}
              />
              <h1 ref={title} tabIndex={-1} data-app-title>
                {contact.name}
              </h1>
              {contacts.some((person) => person.id === contact.id) && (
                <button
                  type="button"
                  className="contact-message"
                  onClick={() => onMessage(contact.id)}
                  aria-label={`${contact.name}에게 메시지 보내기`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21 11.5c0 4.7-4 8.5-9 8.5-1.4 0-2.8-.3-4-.8L3 21l1.2-4.1A8.1 8.1 0 0 1 3 11.5C3 6.8 7 3 12 3s9 3.8 9 8.5Z" />
                  </svg>
                </button>
              )}
            </div>
            <dl className="contact-fields">
              <div>
                <dt>관계</dt>
                <dd>{contact.relation}</dd>
              </div>
              <div>
                <dt>메모</dt>
                <dd>{contact.about}</dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            {!query && (
              <button
                className="contact-list-row contact-my-card"
                onClick={() => {
                  focusNext.current = true;
                  setMyCard(true);
                }}
              >
                <img src={`${import.meta.env.BASE_URL}story/kiryu.jpg`} alt="" />
                <span>
                  키류 카즈마<small>내 카드</small>
                </span>
              </button>
            )}
            {groups.map((group) => (
              <section
                className="contact-group"
                key={group}
                data-contact-group={group}
                aria-label={`${group} 연락처`}
              >
                <h2>{group}</h2>
                {filtered
                  .filter((person) => initial(person.name) === group)
                  .map((person) => (
                    <button
                      type="button"
                      className="contact-list-row"
                      key={person.id}
                      data-contact={person.id}
                      onClick={() => {
                        focusNext.current = true;
                        setSelected(person.id);
                      }}
                    >
                      {person.portrait ? (
                        <img src={person.portrait} alt="" />
                      ) : (
                        <span className="contact-initial" aria-hidden="true">
                          {person.name.slice(0, 2)}
                        </span>
                      )}
                      <span>{person.name}</span>
                    </button>
                  ))}
              </section>
            ))}
            {!filtered.length && (
              <p className="social-empty" role="status">
                검색 결과 없음
              </p>
            )}
            <p className="contact-count">연락처 {filtered.length}개</p>
          </>
        )}
      </div>
      {!contact && !query && (
        <nav className="contacts-index" aria-label="연락처 색인">
          {groups.map((group) => (
            <button
              key={group}
              aria-label={`${group} 연락처로 이동`}
              onClick={() =>
                container.current
                  ?.querySelector(`[data-contact-group="${group}"]`)
                  ?.scrollIntoView({ block: 'start' })
              }
            >
              {group}
            </button>
          ))}
        </nav>
      )}
      <dialog
        ref={addDialog}
        className="phone-call-dialog contact-add-dialog"
        onCancel={() => {
          setName('');
          setPhone('');
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setExtraContacts((previous) => [
              ...previous,
              { id: `local-${crypto.randomUUID()}`, name: name.trim(), phone: phone.trim() },
            ]);
            setName('');
            setPhone('');
            addDialog.current?.close();
          }}
        >
          <h2>새로운 연락처</h2>
          <label>
            이름
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            전화번호
            <input
              type="tel"
              maxLength={40}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!name.trim() || extraContacts.length >= 100}>
            완료
          </button>
          <button type="button" onClick={() => addDialog.current?.close()}>
            취소
          </button>
        </form>
      </dialog>
    </section>
  );
}
