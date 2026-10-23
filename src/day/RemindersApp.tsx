import { useDay } from './DayContext';
import { reminders } from './content';
import '../story/personal.css';
import './day.css';

export function RemindersApp({
  active,
  onOpenNote,
}: {
  active: boolean;
  onOpenNote: (id: string) => void;
}) {
  const { state, dispatch, shoppingDone, remaining, storageUnavailable } = useDay();
  return (
    <section
      className="personal-app day-reminders"
      aria-label="미리 알림 화면"
      data-active={active}
    >
      <header className="personal-header personal-header--large">
        <h1 data-app-title tabIndex={-1}>
          미리 알림
        </h1>
      </header>
      {storageUnavailable && (
        <p className="personal-storage" role="status">
          이번 접속 중에만 저장됩니다.
        </p>
      )}
      <div className="personal-scroll">
        <div className="day-reminder-summary">
          <span className="day-reminder-summary-icon" aria-hidden="true">
            ☷
          </span>
          <strong>{remaining}</strong>
          <span>오늘</span>
        </div>
        <div className="day-reminder-heading">
          <h2>나팔꽃</h2>
          <strong>{remaining}</strong>
        </div>
        <ul className="day-reminder-list">
          {reminders.map((item) => {
            const done = item.id === 'shopping' ? shoppingDone : state.reminders[item.id];
            return (
              <li key={item.id} data-done={done}>
                <label>
                  <input
                    type="checkbox"
                    checked={done}
                    aria-label={`${item.title} 완료`}
                    onChange={(event) =>
                      dispatch({ type: 'reminder', id: item.id, done: event.target.checked })
                    }
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </label>
                {item.id === 'shopping' && (
                  <button
                    className="day-reminder-detail"
                    aria-label="저녁 장보기 메모 열기"
                    onClick={() => onOpenNote('curry')}
                  >
                    ⓘ
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="day-reminder-count" role="status">
          {3 - remaining}개 완료
        </p>
      </div>
    </section>
  );
}
