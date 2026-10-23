import { useTopPull, type TopPanel } from './useTopPull';
import { useSystemGesture } from '../shell/useSystemGesture';
import { HomeIndicator } from './HomeIndicator';
export function SystemEdges({
  active,
  onControl,
  onNotifications,
  onPreview,
}: {
  active: boolean;
  onControl: () => void;
  onNotifications: () => void;
  onPreview: (kind: TopPanel | null) => void;
}) {
  useTopPull(active, onPreview, (kind) => (kind === 'control' ? onControl() : onNotifications()));
  return (
    <>
      <div
        className="system-top-edge system-top-edge--left"
        data-testid="notification-edge"
        aria-hidden="true"
      />
      <div
        className="system-top-edge system-top-edge--right"
        data-testid="control-edge"
        aria-hidden="true"
      />
      <button tabIndex={0} className="system-keyboard-control" onClick={onControl}>
        제어 센터 열기
      </button>
      <button tabIndex={0} className="system-keyboard-control" onClick={onNotifications}>
        알림 센터 열기
      </button>
    </>
  );
}
export function HomeGestures({
  active,
  onSwitcher,
  onQuickSwitch,
}: {
  active: boolean;
  onSwitcher: () => void;
  onQuickSwitch: (direction: 'previous' | 'next') => void;
}) {
  const bottom = useSystemGesture('bottom', active, (result) => {
    if (result === 'switcher') onSwitcher();
    else if (result === 'previous' || result === 'next') onQuickSwitch(result);
  });
  return (
    <div
      className="home-system-bottom"
      data-testid="home-system-gesture"
      aria-hidden="true"
      style={{ transform: `translateY(${-Math.min(bottom.offset * 0.2, 36)}px)` }}
      {...bottom.handlers}
    >
      <HomeIndicator />
    </div>
  );
}
