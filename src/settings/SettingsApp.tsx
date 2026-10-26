import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { setAirplaneMode, type DevicePreferences } from './preferences';
import { SettingsIcon, type SettingsIconName } from './SettingsIcon';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import './settings.css';
import { getWallpaper, wallpaperChoices } from '../day/media';

type SettingsPage =
  | 'main'
  | 'wifi'
  | 'bluetooth'
  | 'cellular'
  | 'appearance'
  | 'brightness'
  | 'wallpaper'
  | 'accessibility'
  | 'profile';
const pageTitles: Record<SettingsPage, string> = {
  main: '설정',
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  cellular: '셀룰러',
  appearance: '화면 모드',
  brightness: '디스플레이 및 밝기',
  wallpaper: '배경화면',
  accessibility: '손쉬운 사용',
  profile: 'Apple 계정',
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
  onReset,
}: {
  preferences: DevicePreferences;
  onChange: (next: DevicePreferences) => void;
  active: boolean;
  storageUnavailable?: boolean;
  onReset: () => boolean | Promise<boolean>;
}) {
  const [history, setHistory] = useState<SettingsPage[]>(['main']);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const [resetError, setResetError] = useState(false);
  const [resetting, setResetting] = useState(false);
  useLayoutEffect(() => {
    if (!active) resetDialog.current?.close();
  }, [active]);
  const page = history[history.length - 1];
  const title = useRef<HTMLHeadingElement>(null);
  const positions = useRef<Partial<Record<SettingsPage, number>>>({});
  const scrollArea = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = positions.current[page] ?? 0;
  }, [page]);
  const focusAfterNavigation = useRef(false);
  const returnTo = useRef<SettingsPage | null>(null);
  const container = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!focusAfterNavigation.current || !active) return;
    focusAfterNavigation.current = false;
    const target = returnTo.current
      ? container.current?.querySelector<HTMLElement>(`[data-settings-page="${returnTo.current}"]`)
      : null;
    returnTo.current = null;
    (target ?? title.current)?.focus({ preventScroll: true });
  }, [page, active]);

  function navigate(next: SettingsPage) {
    if (next === page) return;
    focusAfterNavigation.current = true;
    setHistory((current) => [...current, next]);
  }

  function back() {
    if (history.length <= 1) return;
    focusAfterNavigation.current = true;
    returnTo.current = page;
    setHistory((current) => current.slice(0, -1));
  }
  const edge = useEdgeNavigation({ active, onBack: history.length > 1 ? back : undefined });

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
        <SettingsIcon name={next === 'profile' ? 'accessibility' : next} />
        <span className="settings-row-label">{pageTitles[next]}</span>
        {value && <span className="settings-row-value">{value}</span>}
        <Chevron />
      </button>
    );
  }

  return (
    <section ref={container} className="settings-app" aria-label="설정 내용" {...edge}>
      <header className={`settings-header${page === 'main' ? ' settings-header--large' : ''}`}>
        {page !== 'main' && (
          <button
            tabIndex={0}
            className="settings-back"
            type="button"
            aria-label={
              history[history.length - 2] === 'main'
                ? '설정 목록으로 돌아가기'
                : `${pageTitles[history[history.length - 2]]}으로 돌아가기`
            }
            onClick={back}
          >
            <Chevron />
            <span>{pageTitles[history[history.length - 2]]}</span>
          </button>
        )}
        <h1 ref={title} data-app-title tabIndex={-1}>
          {pageTitles[page]}
        </h1>
      </header>
      <div
        key={page}
        ref={scrollArea}
        className="settings-content settings-pages"
        data-testid="settings-content"
        onScroll={(event) => {
          positions.current[page] = event.currentTarget.scrollTop;
        }}
      >
        {storageUnavailable && (
          <p className="settings-footnote" role="status">
            설정을 저장할 수 없어 현재 접속 중에만 유지됩니다.
          </p>
        )}
        {page === 'main' && (
          <>
            <button
              className="settings-profile-card"
              tabIndex={0}
              data-settings-page="profile"
              onClick={() => navigate('profile')}
              aria-label="키류 카즈마 프로필"
            >
              <img src={`${import.meta.env.BASE_URL}story/kiryu.jpg`} alt="" />
              <span>
                <strong>키류 카즈마</strong>
                <small>Apple 계정, iCloud+ 등</small>
              </span>
              <Chevron />
            </button>
            <Group>
              <SwitchRow
                icon="airplane"
                label="에어플레인 모드"
                checked={preferences.airplane}
                onChange={(enabled) => onChange(setAirplaneMode(preferences, enabled))}
              />
              {destination('wifi', preferences.wifi ? 'ASAGAO_HOME' : '끔')}
              {destination('bluetooth', preferences.bluetooth ? '켬' : '끔')}
              {destination('cellular', !preferences.airplane && preferences.cellular ? '켬' : '끔')}
            </Group>
            <Group>
              {destination('appearance')}
              {destination('brightness')}
              {destination('wallpaper')}
              {destination('accessibility')}
            </Group>
            <Group>
              <button
                className="settings-row settings-reset"
                onClick={() => {
                  setResetError(false);
                  resetDialog.current?.showModal();
                }}
              >
                처음 상태로 되돌리기
              </button>
            </Group>
          </>
        )}

        {page === 'profile' && (
          <>
            <div className="settings-profile-hero">
              <img src={`${import.meta.env.BASE_URL}story/kiryu.jpg`} alt="키류 카즈마" />
              <h2>키류 카즈마</h2>
              <p>나팔꽃</p>
            </div>
            <Group>
              <div className="settings-row">
                <span className="settings-row-label">이름</span>
                <span className="settings-row-value">키류 카즈마</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">기기</span>
                <span className="settings-row-value">키류의 iPhone</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">가족</span>
                <span className="settings-row-value">나팔꽃 아이들</span>
              </div>
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
            {preferences.wifi && (
              <Group>
                <div className="settings-row">
                  <span className="settings-check">✓</span>
                  <span>ASAGAO_HOME</span>
                  <span className="settings-row-value">연결됨</span>
                </div>
              </Group>
            )}
            <p className="settings-footnote">에어플레인 모드에서도 Wi-Fi를 켤 수 있습니다.</p>
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
            <p className="settings-footnote">라라라 모바일</p>
            <p className="settings-footnote">
              {preferences.airplane
                ? '에어플레인 모드를 끄면 이전 셀룰러 설정이 다시 적용됩니다.'
                : 'Wi-Fi가 꺼져 있을 때 셀룰러 데이터를 사용합니다.'}
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
          </>
        )}

        {page === 'wallpaper' && (
          <>
            <fieldset className="settings-choice-fieldset">
              <legend>잠금 화면과 홈 화면</legend>
              <div className="settings-wallpaper-options">
                {[
                  ...wallpaperChoices.map((choice) => ({
                    value: choice.id,
                    label:
                      choice.id === 'default'
                        ? '기본'
                        : choice.id === 'drawing'
                          ? '아이들이 그린 그림'
                          : '저녁 바다',
                  })),
                  { value: 'solid' as const, label: '슬레이트' },
                ].map(({ value, label }) => (
                  <label className="settings-preview-choice" key={value}>
                    <input
                      tabIndex={0}
                      type="radio"
                      name="wallpaper"
                      value={value}
                      checked={preferences.wallpaper === value}
                      onChange={() => update('wallpaper', value as DevicePreferences['wallpaper'])}
                    />
                    <span
                      className={`settings-wallpaper-preview settings-wallpaper-preview--${value}`}
                      aria-hidden="true"
                    >
                      {value !== 'solid' && <img src={getWallpaper(value).src} alt="" />}
                    </span>
                    <span>{label}</span>
                    <span className="settings-choice-mark" aria-hidden="true">
                      ✓
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {preferences.wallpaper !== 'solid' && (
              <>
                <p className="settings-footnote">
                  현재 배경: {getWallpaper(preferences.wallpaper).title}
                </p>
                <div
                  className="settings-crop-preview"
                  data-landscape={getWallpaper(preferences.wallpaper).landscape || undefined}
                  style={
                    {
                      '--wallpaper-image': `url("${getWallpaper(preferences.wallpaper).src}")`,
                    } as CSSProperties
                  }
                >
                  <img
                    src={getWallpaper(preferences.wallpaper).src}
                    alt="배경 위치 미리보기"
                    style={{
                      objectPosition: `${preferences.wallpaperPositions?.[preferences.wallpaper]?.x ?? 50}% ${preferences.wallpaperPositions?.[preferences.wallpaper]?.y ?? 50}%`,
                      ...(getWallpaper(preferences.wallpaper).landscape
                        ? {
                            top: `${32 + ((preferences.wallpaperPositions?.[preferences.wallpaper]?.y ?? 50) - 50) / 4}%`,
                          }
                        : {}),
                    }}
                  />
                  <span>16:40</span>
                </div>
                {(['x', 'y'] as const).map((axis) => (
                  <label className="settings-crop-control" key={axis}>
                    {axis === 'x' ? '사진 가로 위치' : '사진 세로 위치'}
                    <input
                      type="range"
                      min="0"
                      max="100"
                      aria-label={axis === 'x' ? '사진 가로 위치' : '사진 세로 위치'}
                      value={preferences.wallpaperPositions?.[preferences.wallpaper]?.[axis] ?? 50}
                      onChange={(event) =>
                        update('wallpaperPositions', {
                          ...preferences.wallpaperPositions,
                          [preferences.wallpaper]: {
                            x: preferences.wallpaperPositions?.[preferences.wallpaper]?.x ?? 50,
                            y: preferences.wallpaperPositions?.[preferences.wallpaper]?.y ?? 50,
                            [axis]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </>
            )}
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
      <dialog ref={resetDialog} className="settings-reset-dialog" aria-labelledby="reset-title">
        <h2 id="reset-title">처음 상태로 되돌릴까요?</h2>
        <p>메모, 체크한 항목, 메시지 읽음, 사진 즐겨찾기와 배경 설정이 처음 상태로 돌아갑니다.</p>
        <p>AI 대화도 새로 시작합니다. 이전 대화는 기록으로 보관되며 AI가 다시 참고하지 않습니다.</p>
        {resetError && (
          <p role="alert">
            브라우저에 초기화 상태를 저장하지 못했습니다. 저장 공간을 확인하고 다시 시도해 주세요.
          </p>
        )}
        <div>
          <button onClick={() => resetDialog.current?.close()}>취소</button>
          <button
            className="settings-reset"
            disabled={resetting}
            onClick={async () => {
              setResetting(true);
              try {
                if (await onReset()) resetDialog.current?.close();
                else setResetError(true);
              } catch {
                setResetError(true);
              } finally {
                setResetting(false);
              }
            }}
          >
            초기화
          </button>
        </div>
      </dialog>
    </section>
  );
}
