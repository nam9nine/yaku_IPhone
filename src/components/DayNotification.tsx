import { AppIcon } from '../home/AppIcon';
import { useDay } from '../day/DayContext';
export function DayNotification({ onOpen, onCall }: { onOpen: () => void; onCall?: () => void }) {
  const { state } = useDay();
  const message = !state.readThreads.includes('haruka');
  const missed = state.callStatus === 'missed' && !state.missedCallRead && !!onCall;
  if (!message && !missed) return null;
  return (
    <div className="day-notifications" aria-label="알림">
      {missed && (
        <button
          className="day-notification"
          onClick={onCall}
          aria-label="마지마 부재중 전화 알림 열기"
        >
          <span className="notification-symbol">
            <AppIcon id="phone" day="24" weekday="토" />
          </span>
          <span className="notification-copy">
            <span className="notification-heading">
              <strong>마지마 형님</strong>
              <small>지금</small>
            </span>
            <span>부재중 전화</span>
          </span>
        </button>
      )}
      {message && (
        <button
          className="day-notification"
          onClick={onOpen}
          aria-label="하루카의 메시지 알림 열기"
        >
          <span className="notification-symbol">
            <AppIcon id="messages" day="24" weekday="토" />
          </span>
          <span className="notification-copy">
            <span className="notification-heading">
              <strong>하루카</strong>
              <small>지금</small>
            </span>
            <span>
              아저씨, 카레 재료 메모에 적어뒀어요.
              <br />
              당근은 아직 있어요!
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
