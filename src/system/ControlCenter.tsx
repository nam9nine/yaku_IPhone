import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type MouseEvent,
} from 'react';
import { setAirplaneMode, type DevicePreferences } from '../settings/preferences';
import { usePanelSwipe } from './usePanelSwipe';
import { ControlIcon, type ControlIconName } from './ControlIcon';
import './control-center.css';

export interface ControlState {
  volume: number;
  rotation: boolean;
  silent: boolean;
}
export interface ControlCenterProps {
  controls: ControlState;
  onControls: (next: ControlState) => void;
  preferences: DevicePreferences;
  onPreferences: (next: DevicePreferences) => void;
  viewport: { width: number; height: number };
  fontScale: number;
}

type Detail =
  | 'display'
  | 'connections'
  | 'media'
  | 'controls'
  | 'power'
  | 'flashlight'
  | 'timer'
  | 'calculator'
  | 'camera'
  | 'mirror'
  | 'qr'
  | 'focus';

function RoundControl({
  name,
  label,
  onClick,
  active = false,
}: {
  name: ControlIconName;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`cc-round cc-glass${active ? ' cc-round--active' : ''}`}
      aria-label={label}
      aria-pressed={name === 'rotation' || name === 'bell' ? active : undefined}
      onClick={onClick}
    >
      <ControlIcon name={name} />
    </button>
  );
}
const detailText: Record<
  Exclude<Detail, 'display' | 'connections'>,
  { title: string; message: string }
> = {
  media: { title: '재생 중이 아님', message: '재생할 미디어가 없습니다.' },
  controls: { title: '제어 항목', message: '연결, 밝기와 화면 모드를 조절할 수 있어요.' },
  power: { title: '전원', message: '전원을 끌 수 없습니다.' },
  flashlight: { title: '손전등', message: '손전등을 사용할 수 없습니다.' },
  timer: { title: '타이머', message: '설정된 타이머가 없습니다.' },
  calculator: { title: '계산기', message: '계산기를 열 수 없습니다.' },
  camera: { title: '카메라', message: '카메라를 사용할 수 없습니다.' },
  mirror: { title: '화면 미러링', message: '연결된 화면이 없습니다.' },
  qr: { title: '코드 스캔', message: '카메라를 사용할 수 없습니다.' },
  focus: { title: '집중 모드', message: '설정된 집중 모드가 없습니다.' },
};

/** Layout reference: apple-control-center-image. Artwork is original SVG. */
export function ControlCenter({
  controls,
  onControls,
  preferences,
  onPreferences,
  viewport,
  fontScale,
}: ControlCenterProps) {
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const { volume, rotation, silent } = controls;
  const [notice, setNotice] = useState('');
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const [previous, setPrevious] = useState<HTMLElement | null>(null);
  const tiny = viewport.height < 560 || fontScale > 1.4;
  const pageCount = tiny ? 3 : 1;
  const visiblePage = Math.min(page, pageCount - 1);
  const swipe = usePanelSwipe({
    horizontal: (direction) =>
      setPage(Math.max(0, Math.min(pageCount - 1, visiblePage + direction))),
  });
  const dark =
    preferences.theme === 'dark' ||
    (preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  function openDetail(next: Detail, trigger: HTMLElement) {
    setPrevious(trigger);
    setDetail(next);
  }
  function closeDetail() {
    setDetail(null);
    requestAnimationFrame(() => previous?.isConnected && previous.focus({ preventScroll: true }));
  }
  useEffect(() => {
    if (detail) detailTitle.current?.focus({ preventScroll: true });
  }, [detail]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggle = (key: 'airplane' | 'wifi' | 'cellular' | 'bluetooth') => {
    onPreferences(
      key === 'airplane'
        ? setAirplaneMode(preferences, !preferences.airplane)
        : { ...preferences, [key]: !preferences[key] },
    );
  };
  function connection(
    key: 'airplane' | 'wifi' | 'cellular' | 'bluetooth',
    label: string,
    small = false,
  ) {
    const disabled = key === 'cellular' && preferences.airplane;
    return (
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={!disabled && preferences[key]}
        disabled={disabled}
        className={`cc-connection cc-connection--${key}${small ? ' cc-connection--small' : ''}`}
        onClick={() => toggle(key)}
      >
        <ControlIcon name={key} />
      </button>
    );
  }
  const connections = (
    <div className="cc-connections cc-glass">
      {connection('airplane', '에어플레인 모드')}
      <button
        type="button"
        className="cc-connection cc-connection--airdrop"
        aria-label="연결 설정"
        onClick={(event) => openDetail('connections', event.currentTarget)}
      >
        <ControlIcon name="airdrop" />
      </button>
      {connection('wifi', 'Wi-Fi')}
      <div className="cc-connection-cluster">
        {connection('cellular', '셀룰러 데이터', true)}
        {connection('bluetooth', 'Bluetooth', true)}
        <span aria-hidden="true">
          <ControlIcon name="link" />
        </span>
        <span aria-hidden="true">
          <ControlIcon name="globe" />
        </span>
      </div>
    </div>
  );
  const media = (
    <div className="cc-media cc-glass">
      <button
        className="cc-media-main"
        type="button"
        aria-label="미디어 상태"
        onClick={(event) => openDetail('media', event.currentTarget)}
      >
        <span className="cc-media-art" />
        <span className="cc-media-airplay">
          <ControlIcon name="airplay" />
        </span>
        <span className="cc-media-title">재생 중이 아님</span>
      </button>
      <div className="cc-media-buttons">
        <button type="button" aria-label="이전 곡" disabled>
          <ControlIcon name="previous" />
        </button>
        <button type="button" aria-label="재생" disabled>
          <ControlIcon name="play" />
        </button>
        <button type="button" aria-label="다음 곡" disabled>
          <ControlIcon name="next" />
        </button>
      </div>
    </div>
  );
  const rotationControl = (
    <RoundControl
      name="rotation"
      label="화면 회전 잠금"
      onClick={() => {
        onControls({ ...controls, rotation: !rotation });
        setNotice(rotation ? '세로 화면 방향 고정: 끔' : '세로 화면 방향 고정: 켬');
      }}
      active={rotation}
    />
  );
  const silentControl = (
    <RoundControl
      name="bell"
      label="무음 모드"
      onClick={() => {
        onControls({ ...controls, silent: !silent });
        setNotice(silent ? '무음 모드: 끔' : '무음 모드: 켬');
      }}
      active={silent}
    />
  );
  const focus = (
    <button
      type="button"
      className="cc-focus cc-glass"
      aria-label="집중 모드"
      onClick={(event) => openDetail('focus', event.currentTarget)}
    >
      <span className="cc-focus-symbol">
        <ControlIcon name="moon" />
        <i />
        <i />
      </span>
      <span>집중 모드</span>
      <ControlIcon name="chevron" />
    </button>
  );
  const brightness = (
    <div
      className="cc-slider cc-glass cc-slider--brightness"
      data-no-swipe
      style={{ '--cc-level': `${preferences.brightness}%` } as CSSProperties}
    >
      <div className="cc-slider-fill" />
      <input
        type="range"
        aria-label="화면 밝기"
        aria-orientation="vertical"
        min={50}
        max={100}
        step={1}
        value={preferences.brightness}
        onChange={(event) =>
          onPreferences({ ...preferences, brightness: Number(event.target.value) })
        }
      />
      <button
        type="button"
        aria-label="디스플레이 설정"
        onClick={(event) => openDetail('display', event.currentTarget)}
      >
        <ControlIcon name="sun" />
      </button>
    </div>
  );
  const sound = (
    <div
      className="cc-slider cc-glass cc-slider--volume"
      data-no-swipe
      style={{ '--cc-level': `${volume}%` } as CSSProperties}
    >
      <div className="cc-slider-fill" />
      <input
        type="range"
        aria-label="음량"
        aria-orientation="vertical"
        min={0}
        max={100}
        step={1}
        value={volume}
        onChange={(event) => {
          onControls({ ...controls, volume: Number(event.target.value) });
        }}
      />
      <ControlIcon name="volume" />
    </div>
  );
  const tools: [ControlIconName, Detail, string][] = [
    ['flashlight', 'flashlight', '손전등'],
    ['timer', 'timer', '타이머'],
    ['calculator', 'calculator', '계산기'],
    ['camera', 'camera', '카메라'],
    ['mirror', 'mirror', '화면 미러링'],
    ['qr', 'qr', '코드 스캔'],
  ];
  const utilities = tools.map(([icon, destination, label]) => (
    <div className={`cc-tool cc-tool--${icon}`} key={icon}>
      <RoundControl
        name={icon}
        label={label}
        onClick={(event) => openDetail(destination, event.currentTarget)}
      />
    </div>
  ));
  const groups: ReactNode[] = [
    <div className="cc-grid cc-grid--top">
      {connections}
      {media}
    </div>,
    <div className="cc-grid cc-grid--middle">
      {rotationControl}
      {silentControl}
      {brightness}
      {sound}
      {focus}
    </div>,
    <div className="cc-grid cc-grid--tools">{utilities}</div>,
  ];
  return (
    <div className="ios-control-center" data-paged={tiny} data-large-text={fontScale > 1.4}>
      <div className="cc-main" inert={detail !== null} aria-hidden={detail !== null}>
        <header className="cc-topbar">
          <button
            type="button"
            aria-label="제어 항목 추가"
            onClick={(event) => openDetail('controls', event.currentTarget)}
          >
            <ControlIcon name="plus" />
          </button>
          <button
            type="button"
            aria-label="전원 제어"
            onClick={(event) => openDetail('power', event.currentTarget)}
          >
            <ControlIcon name="power" />
          </button>
        </header>
        <div
          className="cc-pages"
          {...swipe.handlers}
          onKeyDown={(event) => {
            if ((event.target as HTMLElement).matches('input')) return;
            if (tiny && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.preventDefault();
              setPage(
                Math.max(0, Math.min(2, visiblePage + (event.key === 'ArrowRight' ? 1 : -1))),
              );
            }
          }}
        >
          {tiny ? (
            <div
              className="cc-track"
              data-dragging={swipe.offset.x !== 0}
              style={{
                transform: `translateX(calc(${-visiblePage * 100}% + ${swipe.offset.x * 0.4}px))`,
              }}
            >
              {groups.map((group, index) => (
                <section
                  key={index}
                  className="cc-page"
                  aria-label={`제어 센터 ${index + 1}페이지`}
                  inert={visiblePage !== index}
                  aria-hidden={visiblePage !== index}
                >
                  {group}
                </section>
              ))}
            </div>
          ) : (
            <div className="cc-grid cc-grid--all">
              {connections}
              {media}
              {rotationControl}
              {silentControl}
              {brightness}
              {sound}
              {focus}
              {utilities}
            </div>
          )}
        </div>
        <nav className="cc-rail" aria-label="제어 센터 그룹">
          {(['heart', 'music', 'cellular'] as const).map((icon, index) => (
            <button
              key={icon}
              type="button"
              aria-label={
                tiny
                  ? `제어 센터 ${index + 1}페이지`
                  : ['즐겨찾는 제어', '미디어 제어', '연결 제어'][index]
              }
              aria-current={(tiny ? visiblePage === index : index === 0) ? 'page' : undefined}
              onClick={(event) => {
                if (tiny) setPage(index);
                else if (index === 1) openDetail('media', event.currentTarget);
                else if (index === 2) openDetail('connections', event.currentTarget);
              }}
            >
              <ControlIcon name={icon} />
            </button>
          ))}
        </nav>
        {notice && (
          <div className="cc-toast" role="status" onClick={() => setNotice('')}>
            {notice}
          </div>
        )}
      </div>
      {detail && (
        <section
          className="cc-detail"
          role="region"
          aria-label="제어 상세"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeDetail();
          }}
        >
          <header>
            <h2 ref={detailTitle} tabIndex={-1}>
              {detail === 'display'
                ? '디스플레이'
                : detail === 'connections'
                  ? '연결'
                  : detailText[detail].title}
            </h2>
            <button
              type="button"
              className="cc-detail-close"
              aria-label="제어 상세 닫기"
              onClick={closeDetail}
            >
              <ControlIcon name="close" />
            </button>
          </header>
          {detail === 'display' ? (
            <div className="cc-display-detail">
              <label>
                밝기 <output>{preferences.brightness}%</output>
                <input
                  type="range"
                  aria-label="화면 밝기"
                  min={50}
                  max={100}
                  value={preferences.brightness}
                  onChange={(event) =>
                    onPreferences({ ...preferences, brightness: Number(event.target.value) })
                  }
                />
              </label>
              <button
                type="button"
                role="switch"
                aria-label="다크 모드"
                aria-checked={dark}
                onClick={() => onPreferences({ ...preferences, theme: dark ? 'light' : 'dark' })}
              >
                <ControlIcon name="dark" />
                <span>다크 모드</span>
                <span>{dark ? '켬' : '끔'}</span>
              </button>
            </div>
          ) : detail === 'connections' ? (
            <div className="cc-connection-detail">
              <div>
                {connection('airplane', '에어플레인 모드')}
                {connection('wifi', 'Wi-Fi')}
                {connection('cellular', '셀룰러 데이터')}
                {connection('bluetooth', 'Bluetooth')}
              </div>
            </div>
          ) : (
            <p>{detailText[detail].message}</p>
          )}
        </section>
      )}
    </div>
  );
}
