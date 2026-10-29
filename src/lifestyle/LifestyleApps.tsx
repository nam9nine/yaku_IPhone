import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import songs from './music.json';
import { destinations, recipes } from './content';
import './lifestyle.css';

function Screen({
  title,
  back,
  active,
  children,
  tone = '',
  view = title,
}: {
  title: string;
  back?: () => void;
  active: boolean;
  children: ReactNode;
  tone?: string;
  view?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(view);
  const content = useRef<HTMLDivElement>(null);
  const edge = useEdgeNavigation({ active, onBack: back });
  useLayoutEffect(() => {
    if (active && previous.current !== view) {
      if (content.current) content.current.scrollTop = 0;
      heading.current?.focus({ preventScroll: true });
    }
    previous.current = view;
  }, [view, active]);
  useEffect(() => {
    if (!active || !back) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, back]);
  return (
    <section className={`lifestyle-app ${tone}`} aria-label={`${title} 화면`} {...edge}>
      <header className="lifestyle-header">
        {back && (
          <button aria-label="이전 화면" onClick={back}>
            〈
          </button>
        )}
        <h1 ref={heading} data-app-title tabIndex={-1}>
          {title}
        </h1>
      </header>
      <div className="lifestyle-content" ref={content}>
        {children}
      </div>
    </section>
  );
}

export function MusicApp({ active }: { active: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const song = songs.find((item) => item.id === selected);
  return (
    <Screen
      title={song ? '노래' : '보관함'}
      active={active}
      back={song ? () => setSelected(null) : undefined}
      view={selected ?? 'library'}
      tone="music-library"
    >
      {song ? (
        <>
          <img
            className="music-cover music-cover--large"
            src={`${import.meta.env.BASE_URL}apps/kiryu-album.jpg`}
            alt="키류 카즈마 카라오케 히트송 모음 앨범"
          />
          <h2>{song.title}</h2>
          <p className="lifestyle-secondary">{song.artist}</p>
          <a className="lifestyle-action" href={song.url} target="_blank" rel="noopener noreferrer">
            Apple Music에서 듣기 ↗
          </a>
        </>
      ) : (
        <>
          <label className="lifestyle-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="보관함 검색"
              placeholder="보관함에서 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="music-album">
            <img
              className="music-cover"
              src={`${import.meta.env.BASE_URL}apps/kiryu-album.jpg`}
              alt=""
            />
            <div>
              <strong>자주 듣는 노래</strong>
              <p>키류 카즈마 · {songs.length}곡</p>
            </div>
          </div>
          <div className="lifestyle-list">
            {songs
              .filter((item) =>
                `${item.title} ${item.artist}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
                <button key={item.id} onClick={() => setSelected(item.id)}>
                  <span className="music-note" aria-hidden="true">
                    ♫
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.artist}</small>
                  </span>
                  <small>
                    {Math.floor(item.seconds / 60)}:{String(item.seconds % 60).padStart(2, '0')}
                  </small>
                </button>
              ))}
          </div>
          {!songs.some((item) =>
            `${item.title} ${item.artist}`.toLowerCase().includes(query.toLowerCase()),
          ) && <p role="status">검색 결과 없음</p>}
        </>
      )}
    </Screen>
  );
}

export function TaxiApp({ active }: { active: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const destination = destinations.find((item) => item.id === selected);
  return (
    <Screen
      title={destination ? '목적지 확인' : '택시'}
      active={active}
      back={destination ? () => setSelected(null) : undefined}
      tone="taxi-app"
    >
      <div
        className="taxi-route"
        aria-label={destination ? `선택한 목적지 ${destination.name}` : '목적지 선택'}
      >
        <div className="taxi-route-line" aria-hidden="true">
          <i />
          <span />
          <i />
        </div>
        <div>
          <small>출발</small>
          <strong>현재 위치</strong>
          <small>도착</small>
          <strong>{destination?.name ?? '어디로 갈까요?'}</strong>
        </div>
      </div>
      <p className="lifestyle-secondary taxi-preview-note">
        목적지만 고르는 가상 화면입니다. 실제 위치 조회나 택시 호출은 하지 않습니다.
      </p>
      {destination ? (
        <>
          <h2>{destination.name}</h2>
          <p className="lifestyle-secondary">{destination.detail}</p>
          <button className="lifestyle-action" onClick={() => setSelected(null)}>
            다른 목적지 선택
          </button>
        </>
      ) : (
        <>
          <h2>자주 가는 곳</h2>
          <div className="lifestyle-list">
            {destinations.map((place) => (
              <button key={place.id} onClick={() => setSelected(place.id)}>
                <span className="destination-symbol" aria-hidden="true">
                  {place.symbol}
                </span>
                <span>
                  <strong>{place.name}</strong>
                  <small>{place.detail}</small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

export function CookingApp({
  active,
  onOpenNote,
}: {
  active: boolean;
  onOpenNote: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const recipe = recipes.find((item) => item.id === selected);
  const back = () => {
    if (step !== null) setStep(null);
    else setSelected(null);
  };
  return (
    <Screen
      title={recipe ? recipe.title : '나팔꽃키친'}
      active={active}
      back={recipe ? back : undefined}
      view={`${selected ?? 'recipes'}:${step ?? 'ingredients'}`}
      tone="cooking-app"
    >
      {!recipe ? (
        <>
          <p className="lifestyle-secondary">아이들과 함께 먹는 밥</p>
          <div className="lifestyle-list">
            {recipes.map((item) => (
              <button key={item.id} onClick={() => setSelected(item.id)}>
                <span className="recipe-symbol" aria-hidden="true">
                  {item.id === 'curry' ? '🍛' : '🍱'}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.subtitle} · {item.time}
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
          <p className="cooking-memo">하루카: 당근은 냉장고에 있어요.</p>
        </>
      ) : step === null ? (
        <>
          <p className="lifestyle-secondary">
            {recipe.subtitle} · {recipe.time}
          </p>
          <h2>재료</h2>
          <ul className="recipe-ingredients">
            {recipe.ingredients.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="cooking-memo">{recipe.memo}</p>
          <button className="lifestyle-action" onClick={() => setStep(0)}>
            만드는 순서
          </button>
          {recipe.id === 'curry' && (
            <button className="lifestyle-link" onClick={() => onOpenNote('curry')}>
              장보기 메모 열기 ›
            </button>
          )}
        </>
      ) : (
        <div className="recipe-step">
          <p className="lifestyle-secondary">
            {step + 1} / {recipe.steps.length}
          </p>
          <h2 tabIndex={-1} aria-live="polite">
            {recipe.steps[step]}
          </h2>
          <div className="recipe-step-buttons">
            <button disabled={step === 0} onClick={() => setStep(step - 1)}>
              이전
            </button>
            <button
              onClick={() => (step < recipe.steps.length - 1 ? setStep(step + 1) : setStep(null))}
            >
              {step < recipe.steps.length - 1 ? '다음' : '완료'}
            </button>
          </div>
        </div>
      )}
    </Screen>
  );
}
