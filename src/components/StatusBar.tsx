import type { DevicePreferences } from '../settings/preferences';
import { useDisplayDate } from '../display/useDisplayDate';
export function StatusBar({
  preferences,
  appVisible,
}: {
  preferences: DevicePreferences;
  appVisible: boolean;
}) {
  const date = useDisplayDate();
  return (
    <div
      className="phone-status-bar"
      data-app={appVisible}
      aria-label={`${date.accessibleTime}, ${preferences.airplane ? '에어플레인 모드, ' : ''}${preferences.wifi ? 'Wi-Fi 연결, ' : ''}배터리 80%`}
    >
      <time>{date.clock}</time>
      <div className="phone-status-icons">
        {preferences.airplane ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m2 14 9-4V3a1 1 0 0 1 2 0v7l9 4v2l-9-2v5l3 2v1l-4-1-4 1v-1l3-2v-5l-9 2Z"
              fill="currentColor"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 20 16" aria-label={preferences.cellular ? '셀룰러 연결' : '셀룰러 끔'}>
            {[0, 1, 2, 3].map((n) => (
              <rect
                key={n}
                x={n * 5}
                y={11 - n * 3}
                width="3.5"
                height={4 + n * 3}
                rx="1.4"
                fill="currentColor"
                opacity={preferences.cellular ? 1 : 0.3}
              />
            ))}
          </svg>
        )}
        {preferences.wifi && (
          <svg
            viewBox="0 0 22 17"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.7"
            strokeLinecap="round"
          >
            <path d="M2 5.5a14 14 0 0 1 18 0M5.7 9.3a8.4 8.4 0 0 1 10.6 0" />
            <path d="M8.6 12.8a3.6 3.6 0 0 1 4.8 0L11 15.3Z" fill="currentColor" stroke="none" />
          </svg>
        )}
        <span className="status-battery">
          <span>80</span>
        </span>
      </div>
    </div>
  );
}
