import { useSystemGesture } from '../shell/useSystemGesture';
export function SystemEdges({
  active,
  onControl,
  onNotifications,
}: {
  active: boolean;
  onControl: () => void;
  onNotifications: () => void;
}) {
  const left = useSystemGesture('top', active, onNotifications);
  const right = useSystemGesture('top', active, onControl);
  return (
    <>
      <div
        className="system-top-edge system-top-edge--left"
        data-testid="notification-edge"
        aria-hidden="true"
        {...left.handlers}
      />
      <div
        className="system-top-edge system-top-edge--right"
        data-testid="control-edge"
        aria-hidden="true"
        {...right.handlers}
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
  onHome,
  onSwitcher,
  onQuickSwitch,
}: {
  active: boolean;
  onHome: () => void;
  onSwitcher: () => void;
  onQuickSwitch: (direction: 'previous' | 'next') => void;
}) {
  const bottom = useSystemGesture('bottom', active, (result) => {
    if (result === 'home') onHome();
    else if (result === 'switcher') onSwitcher();
    else if (result === 'previous' || result === 'next') onQuickSwitch(result);
  });
  return (
    <div
      className="home-system-bottom"
      data-testid="home-system-gesture"
      aria-hidden="true"
      {...bottom.handlers}
    />
  );
}
