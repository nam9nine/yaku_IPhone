import { useLayoutEffect, useRef, useState } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { contacts } from './data';
import './social.css';

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
}: {
  active: boolean;
  onMessage: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const container = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const focusNext = useRef(false);
  const returnId = useRef<string | null>(null);
  const contact = contacts.find((person) => person.id === selected);
  const filtered = contacts
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
  }
  const edge = useEdgeNavigation({ active, onBack: contact ? back : undefined });
  return (
    <section
      className="social-app contacts-app"
      ref={container}
      aria-label="연락처 내용"
      {...edge}
      onKeyDown={(event) => {
        if (active && contact && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          back();
        }
      }}
    >
      <header className={`social-header${contact ? ' social-header--compact' : ''}`}>
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
          <h1 ref={title} tabIndex={-1} data-app-title>
            연락처
          </h1>
        )}
      </header>
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
                src={contact.portrait}
                alt={`${contact.name} 프로필`}
              />
              <h1 ref={title} tabIndex={-1} data-app-title>
                {contact.name}
              </h1>
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
            {groups.map((group) => (
              <section className="contact-group" key={group} aria-label={`${group} 연락처`}>
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
      {!contact && (
        <footer className="social-toolbar">
          <label className="social-search">
            <SearchIcon />
            <input
              type="search"
              aria-label="연락처 검색"
              placeholder="검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
        </footer>
      )}
    </section>
  );
}
