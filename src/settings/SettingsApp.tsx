import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { setAirplaneMode, type DevicePreferences } from './preferences';
import { SettingsIcon, type SettingsIconName } from './SettingsIcon';
import './settings.css';

type SettingsPage =
  | 'main'
  | 'wifi'
  | 'bluetooth'
  | 'cellular'
  | 'appearance'
  | 'brightness'
  | 'wallpaper'
  | 'accessibility';
const pageTitles: Record<SettingsPage, string> = {
  main: '설정',
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  cellular: '셀룰러',
  appearance: '화면 모드',
  brightness: '디스플레이 및 밝기',
  wallpaper: '배경화면',
  accessibility: '손쉬운 사용',
};

function Chevron() {
  return (
    <svg className="settings-chevron" viewBox="0 0 12 20" aria-hidden="true">
      <path
        d="m3 4 6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
  disabled = false,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  icon?: SettingsIconName;
}) {
  return (
    <label className={`settings-row settings-switch-row${disabled ? ' is-disabled' : ''}`}>
      {icon && <SettingsIcon name={icon} />}
      <span className="settings-row-label">{label}</span>
      <span className="settings-switch">
        <input
          tabIndex={0}
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="settings-switch-track" aria-hidden="true" />
      </span>
    </label>
  );
}

function Group({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className="settings-section" aria-label={label}>
      {label && <h2 className="settings-group-title">{label}</h2>}
      <div className="settings-group">{children}</div>
    </section>
  );
}

export function SettingsApp({
  preferences,
  onChange,
  active,
  storageUnavailable = false,
}: {
  preferences: DevicePreferences;
  onChange: (next: DevicePreferences) => void;
  active: boolean;
  storageUnavailable?: boolean;
}) {
  const [page, setPage] = useState<SettingsPage>('main');
  const content = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const scrollPositions = useRef<Partial<Record<SettingsPage, number>>>({});
  const focusAfterNavigation = useRef(false);
  const previousDetail = useRef<SettingsPage>('wifi');

  useLayoutEffect(() => {
    if (!focusAfterNavigation.current || !active) return;
    focusAfterNavigation.current = false;
    if (content.current) content.current.scrollTop = scrollPositions.current[page] ?? 0;
    if (page === 'main') {
      content.current
        ?.querySelector<HTMLButtonElement>(`[data-settings-page="${previousDetail.current}"]`)
        ?.focus({ preventScroll: true });
    } else {
      title.current?.focus({ preventScroll: true });
    }
  }, [page, active]);

  function navigate(next: SettingsPage) {
    scrollPositions.current[page] = content.current?.scrollTop ?? 0;
    if (next !== 'main') previousDetail.current = next;
    focusAfterNavigation.current = true;
    setPage(next);
  }

  function update<K extends keyof DevicePreferences>(key: K, value: DevicePreferences[K]) {
    onChange({ ...preferences, [key]: value });
  }

  function destination(next: Exclude<SettingsPage, 'main'>, value?: string) {
    return (
      <button
        tabIndex={0}
        className="settings-row settings-link"
        type="button"
        data-settings-page={next}
        onClick={() => navigate(next)}
      >
        <SettingsIcon name={next} />
        <span className="settings-row-label">{pageTitles[next]}</span>
        {value && <span className="settings-row-value">{value}</span>}
        <Chevron />
      </button>
    );
  }

  return (
    <section className="settings-app" aria-label="설정 내용">
      <header className={`settings-header${page === 'main' ? ' settings-header--large' : ''}`}>
        {page !== 'main' && (
          <button
            tabIndex={0}
            className="settings-back"
            type="button"
            aria-label="설정 목록으로 돌아가기"
            onClick={() => navigate('main')}
          >
            <Chevron />
            <span>설정</span>
          </button>
        )}
        <h1 ref={title} data-app-title tabIndex={-1}>
          {pageTitles[page]}
        </h1>
      </header>
      <div className="settings-content" ref={content} data-testid="settings-content">
        {storageUnavailable && (
          <p className="settings-footnote" role="status">
            설정을 저장할 수 없어 현재 접속 중에만 유지됩니다.
          </p>
        )}
        {page === 'main' && (
          <>
            <Group label="연결">
              <SwitchRow
                icon="airplane"
                label="에어플레인 모드"
                checked={preferences.airplane}
                onChange={(enabled) => onChange(setAirplaneMode(preferences, enabled))}
              />
              {destination('wifi', preferences.wifi ? '켬' : '끔')}
              {destination('bluetooth', preferences.bluetooth ? '켬' : '끔')}
              {destination('cellular', !preferences.airplane && preferences.cellular ? '켬' : '끔')}
            </Group>
            <p className="settings-footnote">연결 설정은 이 웹 체험 안에서만 적용됩니다.</p>
            <Group label="화면과 사용 방식">
              {destination('appearance')}
              {destination('brightness')}
              {destination('wallpaper')}
              {destination('accessibility')}
            </Group>
          </>
        )}

        {page === 'wifi' && (
          <>
            <Group>
              <SwitchRow
                label="Wi-Fi"
                checked={preferences.wifi}
                onChange={(value) => update('wifi', value)}
              />
            </Group>
            <p className="settings-footnote">
              이 웹 체험의 Wi-Fi 연결을 켜거나 끕니다. 에어플레인 모드에서도 Wi-Fi를 켤 수 있습니다.
            </p>
          </>
        )}
        {page === 'bluetooth' && (
          <>
            <Group>
              <SwitchRow
                label="Bluetooth"
                checked={preferences.bluetooth}
                onChange={(value) => update('bluetooth', value)}
              />
            </Group>
            <p className="settings-footnote">
              이 웹 체험의 Bluetooth 설정입니다. 실제 주변 기기를 검색하거나 연결하지 않습니다.
            </p>
          </>
        )}
        {page === 'cellular' && (
          <>
            <Group>
              <SwitchRow
                label="셀룰러 데이터"
                checked={!preferences.airplane && preferences.cellular}
                disabled={preferences.airplane}
                onChange={(value) => update('cellular', value)}
              />
            </Group>
            <p className="settings-footnote">
              {preferences.airplane
                ? '에어플레인 모드를 끄면 이전 셀룰러 설정이 다시 적용됩니다.'
                : 'Wi-Fi가 꺼져 있을 때 이 웹 체험에서 셀룰러 연결을 사용합니다.'}
            </p>
          </>
        )}

        {page === 'appearance' && (
          <>
            <fieldset className="settings-choice-fieldset">
              <legend>화면 스타일</legend>
              <div className="settings-theme-options">
                {(
                  [
                    { value: 'light', label: '라이트 모드' },
                    { value: 'dark', label: '다크 모드' },
                    { value: 'system', label: '자동' },
                  ] as const
                ).map(({ value, label }) => (
                  <label className="settings-preview-choice" key={value}>
                    <input
                      tabIndex={0}
                      type="radio"
                      name="appearance"
                      value={value}
                      checked={preferences.theme === value}
                      onChange={() => update('theme', value)}
                    />
                    <span
                      className={`settings-theme-preview settings-theme-preview--${value}`}
                      aria-hidden="true"
                    >
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{label}</span>
                    <span className="settings-choice-mark" aria-hidden="true">
                      ✓
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="settings-footnote">
              자동은 기기의 밝은 화면 또는 어두운 화면 설정을 따릅니다.
            </p>
            <fieldset className="settings-choice-fieldset settings-text-options">
              <legend>텍스트 크기</legend>
              <div className="settings-group">
                {(
                  [
                    { value: 100, label: '기본' },
                    { value: 115, label: '크게' },
                    { value: 130, label: '더 크게' },
                  ] as const
                ).map(({ value, label }) => (
                  <label className="settings-row settings-radio-row" key={value}>
                    <input
                      tabIndex={0}
                      type="radio"
                      name="text-size"
                      value={value}
                      checked={preferences.textScale === value}
                      onChange={() => update('textScale', value)}
                    />
                    <span className="settings-row-label">{label}</span>
                    <span className="settings-row-value">{value}%</span>
                    <span className="settings-check" aria-hidden="true">
                      ✓
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="settings-text-preview">편안하게 읽어보세요.</p>
          </>
        )}

        {page === 'brightness' && (
          <>
            <Group label="밝기">
              <div className="settings-brightness">
                <label htmlFor="settings-brightness">
                  화면 밝기 <output>{preferences.brightness}%</output>
                </label>
                <div className="settings-brightness-slider">
                  <span aria-hidden="true">☼</span>
                  <input
                    tabIndex={0}
                    id="settings-brightness"
                    type="range"
                    aria-label="화면 밝기"
                    aria-valuetext={`${preferences.brightness}%`}
                    min="50"
                    max="100"
                    step="1"
                    value={preferences.brightness}
                    onChange={(event) => update('brightness', Number(event.target.value))}
                  />
                  <span aria-hidden="true">☀</span>
                </div>
              </div>
            </Group>
            <p className="settings-footnote">
              이 웹 화면의 밝기를 조절합니다. 기기 자체의 화면 밝기는 바뀌지 않습니다.
            </p>
          </>
        )}

        {page === 'wallpaper' && (
          <>
            <fieldset className="settings-choice-fieldset">
              <legend>잠금 화면과 홈 화면</legend>
              <div className="settings-wallpaper-options">
                {(
                  [
                    { value: 'default', label: '기본' },
                    { value: 'solid', label: '슬레이트' },
                  ] as const
                ).map(({ value, label }) => (
                  <label className="settings-preview-choice" key={value}>
                    <input
                      tabIndex={0}
                      type="radio"
                      name="wallpaper"
                      value={value}
                      checked={preferences.wallpaper === value}
                      onChange={() => update('wallpaper', value)}
                    />
                    <span
                      className={`settings-wallpaper-preview settings-wallpaper-preview--${value}`}
                      aria-hidden="true"
                    >
                      {value === 'default' && (
                        <img src={`${import.meta.env.BASE_URL}wallpapers/silver-fold.svg`} alt="" />
                      )}
                    </span>
                    <span>{label}</span>
                    <span className="settings-choice-mark" aria-hidden="true">
                      ✓
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {page === 'accessibility' && (
          <>
            <Group>
              <button
                tabIndex={0}
                className="settings-row settings-link"
                onClick={() => navigate('appearance')}
              >
                텍스트 크기
                <Chevron />
              </button>
            </Group>
            <Group>
              <SwitchRow
                label="동작 줄이기"
                checked={preferences.reduceMotion}
                onChange={(value) => update('reduceMotion', value)}
              />
            </Group>
            <p className="settings-footnote">
              화면 전환과 제어 요소의 움직임을 줄입니다. 기기에서 동작 줄이기를 켠 경우에도
              적용됩니다.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
