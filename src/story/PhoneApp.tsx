import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ContactsApp } from './ContactsApp';
import { contacts } from './data';
import { PhoneIcon, type PhoneIconName } from './PhoneIcon';
import { useDay } from '../day/DayContext';
import './phone.css';

type Tab = 'favorite' | 'recent' | 'contacts' | 'keypad' | 'voicemail';
const tabs: { id: Tab; label: string }[] = [
  { id: 'favorite', label: '즐겨찾기' },
  { id: 'recent', label: '최근 통화' },
  { id: 'contacts', label: '연락처' },
  { id: 'keypad', label: '키패드' },
  { id: 'voicemail', label: '음성 사서함' },
];
// Fictional personal call history. No real phone numbers or canon dialogue.
const history = [
  { id: 'h1', person: 'haruka', date: '14:20', missed: false, outgoing: true },
  { id: 'h2', person: 'daigo', date: '어제', missed: true, outgoing: false },
  { id: 'h3', person: 'daigo', date: '어제', missed: false, outgoing: true },
  { id: 'h4', person: 'saejima', date: '목요일', missed: false, outgoing: false },
  { id: 'h5', person: 'haruka', date: '목요일', missed: false, outgoing: true },
  { id: 'h6', person: 'mine', date: '수요일', missed: false, outgoing: false },
  { id: 'h7', person: 'majima', date: '수요일', missed: false, outgoing: true },
  { id: 'h8', person: 'haruka', date: '화요일', missed: false, outgoing: false },
];
const digits = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];
export function PhoneApp({
  active,
  onMessage,
  requestedRecent = 0,
}: {
  active: boolean;
  requestedRecent?: number;
  onMessage: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('recent');
  const [missed, setMissed] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [number, setNumber] = useState('');
  const [detail, setDetail] = useState<{ id: string; key: number } | null>(null);
  const [lastRequest, setLastRequest] = useState(requestedRecent);
  if (lastRequest !== requestedRecent) {
    setLastRequest(requestedRecent);
    setTab('recent');
    setMissed(false);
    setQuery('');
    setEditing(false);
  }
  const [call, setCall] = useState<{ name: string; id?: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const { state, dispatch } = useDay();
  useEffect(() => {
    if (active && tab === 'recent' && state.callStatus === 'missed')
      dispatch({ type: 'read-call' });
  }, [active, tab, state.callStatus, dispatch]);
  const calls = [
    ...(state.callStatus === 'missed' || state.callStatus === 'answered'
      ? [
          {
            id: 'majima-event',
            person: 'majima',
            date: '16:45',
            missed: state.callStatus === 'missed',
            outgoing: false,
          },
        ]
      : []),
    ...history,
  ].filter(
    (item) =>
      !removed.includes(item.id) &&
      (!missed || item.missed) &&
      contacts.find((p) => p.id === item.person)?.name.includes(query.trim()),
  );
  useLayoutEffect(() => {
    if (active && call) dialog.current?.showModal();
    else dialog.current?.close();
  }, [active, call]);
  function select(next: Tab) {
    setTab(next);
    if (next === 'recent') dispatch({ type: 'read-call' });
  }
  return (
    <section className="phone-app" aria-label="전화 내용">
      <div className="phone-page">
        {tab === 'contacts' ? (
          <ContactsApp active={active} onMessage={onMessage} requestedContact={detail} />
        ) : tab === 'keypad' ? (
          <div className="phone-keypad">
            <h1 className="system-sr-only" data-app-title tabIndex={-1}>
              키패드
            </h1>
            <output className="phone-dial-number" aria-live="polite" aria-label="입력한 전화번호">
              {number}
            </output>
            <div className="phone-digits">
              {digits.map(([digit, letters]) => (
                <button
                  key={digit}
                  aria-label={digit}
                  onClick={() => setNumber((n) => (n + digit).slice(0, 24))}
                >
                  <span>{digit}</span>
                  {letters && <small>{letters}</small>}
                </button>
              ))}
            </div>
            <div className="phone-dial-actions">
              <span />
              <button
                className="phone-dial-call"
                aria-label="전화 걸기"
                onClick={() => (number ? setCall({ name: number }) : setNumber('010'))}
              >
                <PhoneIcon name="call" />
              </button>
              <button
                className="phone-delete"
                aria-label="번호 한 자리 지우기"
                disabled={!number}
                onClick={() => setNumber((n) => n.slice(0, -1))}
              >
                ⌫
              </button>
            </div>
          </div>
        ) : tab === 'voicemail' ? (
          <>
            <header className="phone-title">
              <h1 data-app-title tabIndex={-1}>
                음성 사서함
              </h1>
            </header>
            <div className="phone-empty">
              <PhoneIcon name="voicemail" />
              <h2>음성 메시지 없음</h2>
              <p>저장된 음성 메시지가 없습니다.</p>
            </div>
          </>
        ) : (
          <>
            <header className="phone-header">
              <div className="phone-topbar">
                <button className="phone-circle" onClick={() => setEditing(!editing)}>
                  {editing ? '완료' : '편집'}
                </button>
                {tab === 'recent' && (
                  <div className="phone-segment" aria-label="통화 필터">
                    <button aria-pressed={!missed} onClick={() => setMissed(false)}>
                      모두
                    </button>
                    <button aria-pressed={missed} onClick={() => setMissed(true)}>
                      부재중 전화
                    </button>
                  </div>
                )}
                <button
                  className="phone-circle"
                  aria-label="부재중 전화만 보기"
                  aria-pressed={missed}
                  onClick={() => {
                    setTab('recent');
                    setMissed(!missed);
                  }}
                >
                  <PhoneIcon name="menu" />
                </button>
              </div>
              <h1 data-app-title tabIndex={-1}>
                {tab === 'favorite' ? '즐겨찾기' : '최근 통화'}
              </h1>
              <label className="phone-search">
                <PhoneIcon name="search" />
                <input
                  type="search"
                  placeholder="검색"
                  aria-label="통화 검색"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <PhoneIcon name="microphone" />
              </label>
            </header>
            <div className="phone-history">
              {(tab === 'favorite'
                ? contacts
                    .filter((p) => p.id === 'haruka' || p.id === 'majima')
                    .map((p) => ({
                      id: p.id,
                      person: p.id,
                      date: '',
                      missed: false,
                      outgoing: false,
                    }))
                    .filter(
                      (item) =>
                        !removed.includes(item.id) &&
                        contacts.find((p) => p.id === item.person)?.name.includes(query.trim()),
                    )
                : calls
              ).map((item) => {
                const person = contacts.find((p) => p.id === item.person)!;
                return (
                  <div className="phone-call" key={item.id} data-missed={item.missed}>
                    {editing && (
                      <button
                        className="phone-remove"
                        aria-label={`${person.name} 통화 기록 삭제`}
                        onClick={() => setRemoved([...removed, item.id])}
                      >
                        −
                      </button>
                    )}
                    <button
                      className="phone-call-main"
                      aria-label={
                        item.id === 'majima-event'
                          ? item.missed
                            ? '마지마 부재중 전화, 메시지 열기'
                            : '마지마 통화, 메시지 열기'
                          : `${person.name}에게 전화`
                      }
                      onClick={() => {
                        if (item.id === 'majima-event') {
                          dispatch({ type: 'read-call' });
                          onMessage('majima');
                        } else setCall({ name: person.name, id: person.id });
                      }}
                    >
                      <img src={person.portrait} alt="" />
                      <span>
                        <strong>{person.id === 'majima' ? '마지마 형님' : person.name}</strong>
                        <small>
                          <span aria-hidden="true">{item.outgoing ? '↗' : '↙'}</span> 휴대전화
                        </small>
                      </span>
                      <time>{item.date}</time>
                    </button>
                    <button
                      className="phone-info"
                      aria-label={`${person.name} 연락처 정보`}
                      onClick={() => {
                        setDetail({ id: person.id, key: Date.now() });
                        setTab('contacts');
                      }}
                    >
                      <PhoneIcon name="info" />
                    </button>
                  </div>
                );
              })}
              {tab === 'recent' && !calls.length && <p className="phone-empty">최근 통화 없음</p>}
            </div>
          </>
        )}
      </div>
      <nav className="phone-tabs" aria-label="전화 보기">
        {tabs.map((item) => (
          <button key={item.id} aria-pressed={tab === item.id} onClick={() => select(item.id)}>
            <PhoneIcon name={item.id as PhoneIconName} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <dialog
        ref={dialog}
        className="phone-call-dialog"
        onCancel={() => setCall(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setCall(null);
        }}
      >
        <h2>{call?.name}</h2>
        <p>실제 전화에 연결하지 않는 웹 체험입니다.</p>
        {call?.id && (
          <button
            onClick={() => {
              setCall(null);
              onMessage(call.id!);
            }}
          >
            메시지 보내기
          </button>
        )}
        <button onClick={() => setCall(null)}>확인</button>
      </dialog>
    </section>
  );
}
