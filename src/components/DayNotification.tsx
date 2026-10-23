import { AppIcon } from '../home/AppIcon';
import { useDay } from '../day/DayContext';

export function DayNotification({ onOpen }: { onOpen: () => void }) {
  const { state } = useDay();
  if (state.readThreads.includes('haruka')) return null;
  return (
    <button className="day-notification" onClick={onOpen} aria-label="하루카의 메시지 알림 열기">
      <span className="notification-app">
        <AppIcon id="messages" day="24" weekday="토" />
        메시지 <small>지금</small>
      </span>
      <strong>하루카</strong>
      <span>
        아저씨, 카레 재료 메모에 적어뒀어요.
        <br />
        당근은 아직 있어요!
      </span>
    </button>
  );
}
