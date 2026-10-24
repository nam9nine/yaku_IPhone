import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { shoppingEvent } from './content';
import '../story/personal.css';
import './day.css';

export function CalendarApp({
  active,
  onOpenNote,
}: {
  active: boolean;
  onOpenNote: (id: string) => void;
}) {
  const [detail, setDetail] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const previousDetail = useRef(detail);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = detail ? 0 : listPosition.current;
    if (previousDetail.current !== detail) {
      (detail ? title.current : returnButton.current)?.focus({ preventScroll: true });
      previousDetail.current = detail;
    }
  }, [detail]);
  function back() {
    setDetail(false);
  }
  const edge = useEdgeNavigation({ active, onBack: detail ? back : undefined });
  useEffect(() => {
    if (!active || !detail) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDetail(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, detail]);
  return (
    <section className="personal-app day-calendar" aria-label="캘린더 화면" {...edge}>
      <header className="personal-header">
        <div>
          {detail && (
            <button className="day-calendar-back" onClick={back}>
              〈 캘린더
            </button>
          )}
        </div>
        <h1 data-app-title ref={title} tabIndex={-1}>
          {detail ? '이벤트' : '10월'}
        </h1>
        <span className="day-calendar-header-space" />
      </header>
      <div className="personal-scroll" ref={scroll}>
        {detail ? (
          <article className="day-event-detail">
            <h2>{shoppingEvent.title}</h2>
            <p>{shoppingEvent.location}</p>
            <div className="day-event-dates">
              <span>10월 24일 토요일</span>
              <strong>오후 5:00</strong>
            </div>
            <h3>메모</h3>
            <p>{shoppingEvent.notes}</p>
            <button onClick={() => onOpenNote(shoppingEvent.noteId)}>
              오늘 저녁 카레 메모 열기 <span aria-hidden="true">›</span>
            </button>
          </article>
        ) : (
          <>
            <div className="day-calendar-month" aria-label="10월 달력">
              <div className="day-calendar-weekdays">
                {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="day-calendar-grid">
                {Array.from({ length: 4 }, (_, index) => (
                  <span aria-hidden="true" key={`blank-${index}`} />
                ))}
                {Array.from({ length: 31 }, (_, index) => (
                  <span key={index} aria-current={index === 23 ? 'date' : undefined}>
                    {index + 1}
                  </span>
                ))}
              </div>
            </div>
            <h2 className="day-calendar-today">10월 24일 토요일</h2>
            <button
              ref={returnButton}
              className="day-calendar-event"
              onClick={() => {
                listPosition.current = scroll.current?.scrollTop ?? 0;
                setDetail(true);
              }}
            >
              <time>17:00</time>
              <span>
                <strong>{shoppingEvent.title}</strong>
                <small>저녁 카레 재료</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
