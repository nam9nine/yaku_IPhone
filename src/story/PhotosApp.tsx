import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { useHorizontalGesture } from '../navigation/useHorizontalGesture';
import { photos } from './data';
import { useStoredState } from './useStoredState';
import './personal.css';

function PhotoIcon({ name }: { name: 'back' | 'next' | 'heart' | 'grid' | 'collections' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={
          {
            back: 'm14 5-7 7 7 7',
            next: 'm10 5 7 7-7 7',
            heart: 'M12 21 3.5 13A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 8.5 7Z',
            grid: 'M5 4V2h15M3 7V5h17M3 8h18v13H3ZM3 18l5-5 4 4 3-3 6 6M15 11h.01',
            collections: 'M6 2h12M4 5h16M3 8h18v13H3Z',
          }[name]
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PhotosApp({ active }: { active: boolean }) {
  const [favorites, setFavorites, unavailable] = useStoredState<string[]>(
    'photo-favorites',
    [],
    (value: unknown) =>
      Array.isArray(value) &&
      new Set(value).size === value.length &&
      value.every((id) => typeof id === 'string' && photos.some((photo) => photo.id === id)),
  );
  const [tab, setTab] = useState<'library' | 'collections'>('library');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewIds, setViewIds] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef({ library: 0, favorites: 0 });
  const pendingFocus = useRef(false);
  const returnId = useRef<string | null>(null);
  const selected = photos.find((photo) => photo.id === selectedId);
  const currentIndex = selectedId ? viewIds.indexOf(selectedId) : -1;
  const visible = favoriteOnly ? photos.filter((photo) => favorites.includes(photo.id)) : photos;
  const isGrid = tab === 'library' || favoriteOnly;
  const key = favoriteOnly ? 'favorites' : 'library';

  useLayoutEffect(() => {
    if (!active || !pendingFocus.current) return;
    pendingFocus.current = false;
    if (selectedId) heading.current?.focus({ preventScroll: true });
    else {
      if (scroll.current) scroll.current.scrollTop = positions.current[key];
      const tile = Array.from(
        root.current?.querySelectorAll<HTMLButtonElement>('[data-photo-id]') ?? [],
      ).find((element) => element.dataset.photoId === returnId.current);
      (tile ?? heading.current)?.focus({ preventScroll: true });
    }
  }, [selectedId, active, key, tab]);

  function back() {
    pendingFocus.current = true;
    if (selected) {
      returnId.current = selected.id;
      setSelectedId(null);
    } else if (favoriteOnly) setFavoriteOnly(false);
  }
  const edge = useEdgeNavigation({ active, onBack: selected || favoriteOnly ? back : undefined });
  function navigate(direction: 'previous' | 'next') {
    const next = viewIds[currentIndex + (direction === 'next' ? 1 : -1)];
    if (next) setSelectedId(next);
  }
  const browse = useHorizontalGesture({
    active: active && !!selected,
    start: () => 'both',
    commit: navigate,
  });

  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (!active) return;
    if (event.key === 'Escape' && (selected || favoriteOnly)) {
      event.preventDefault();
      event.stopPropagation();
      back();
    }
    if (selected && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      navigate(event.key === 'ArrowRight' ? 'next' : 'previous');
    }
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => keyboard(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return (
    <section
      ref={root}
      className={`personal-app photos-app${!selected && tab === 'library' ? ' photos-app--library' : ''}`}
      aria-label="사진 내용"
      {...edge}
    >
      <header
        className={`personal-header${selected ? ' photo-detail-header' : ' personal-header--large'}`}
      >
        {selected || favoriteOnly ? (
          <button
            className="personal-round"
            aria-label={selected ? '사진 보관함으로 돌아가기' : '모음으로 돌아가기'}
            onClick={back}
          >
            <PhotoIcon name="back" />
          </button>
        ) : null}
        <h1 ref={heading} data-app-title tabIndex={-1}>
          {selected ? (
            <>
              <span>{selected.date}</span>
              <small>{selected.title}</small>
            </>
          ) : favoriteOnly ? (
            '즐겨찾는 항목'
          ) : tab === 'library' ? (
            '보관함'
          ) : (
            '모음'
          )}
        </h1>
      </header>
      {unavailable && (
        <p className="personal-storage" role="status">
          즐겨찾기를 저장할 수 없어 이번 접속 중에만 유지됩니다.
        </p>
      )}
      {selected ? (
        <>
          <div className="photo-viewer" data-testid="photo-viewer" {...browse}>
            <img src={selected.src} alt={selected.title} draggable={false} />
          </div>
          <div className="photo-filmstrip" aria-label="사진 빠르게 보기">
            {viewIds.map((id) => {
              const photo = photos.find((item) => item.id === id);
              return photo ? (
                <button
                  key={id}
                  aria-label={`${photo.title} 보기`}
                  aria-current={id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(id)}
                >
                  <img src={photo.src} alt="" draggable={false} />
                </button>
              ) : null;
            })}
          </div>
          <footer className="personal-toolbar photo-toolbar">
            <button
              className="personal-round"
              aria-label="이전 사진"
              disabled={currentIndex <= 0}
              onClick={() => navigate('previous')}
            >
              <PhotoIcon name="back" />
            </button>
            <button
              className="personal-round photo-favorite"
              aria-label="즐겨찾기"
              aria-pressed={favorites.includes(selected.id)}
              onClick={() =>
                setFavorites((current) =>
                  current.includes(selected.id)
                    ? current.filter((id) => id !== selected.id)
                    : [...current, selected.id],
                )
              }
            >
              <PhotoIcon name="heart" />
            </button>
            <button
              className="personal-round"
              aria-label="다음 사진"
              disabled={currentIndex >= viewIds.length - 1}
              onClick={() => navigate('next')}
            >
              <PhotoIcon name="next" />
            </button>
          </footer>
        </>
      ) : (
        <>
          <div
            ref={scroll}
            className="personal-scroll photos-scroll"
            data-testid="photos-content"
            onScroll={(event) => {
              if (isGrid) positions.current[key] = event.currentTarget.scrollTop;
            }}
          >
            {isGrid ? (
              <>
                <div className="photo-grid">
                  {visible.map((photo) => (
                    <button
                      key={photo.id}
                      className="photo-tile"
                      data-photo-id={photo.id}
                      aria-label={photo.title}
                      onClick={() => {
                        setViewIds(visible.map((item) => item.id));
                        pendingFocus.current = true;
                        setSelectedId(photo.id);
                      }}
                    >
                      <img src={photo.src} alt="" draggable={false} />
                      {favorites.includes(photo.id) && (
                        <span className="photo-tile-favorite" aria-label="즐겨찾기">
                          <PhotoIcon name="heart" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {!visible.length ? (
                  <div className="personal-empty">
                    <PhotoIcon name="heart" />
                    <h2>즐겨찾는 항목 없음</h2>
                    <p>사진을 열고 하트를 눌러 추가하세요.</p>
                  </div>
                ) : (
                  <p className="photo-count">{visible.length}장의 사진</p>
                )}
              </>
            ) : (
              <div className="photo-collections">
                <h2>고정된 모음</h2>
                <button
                  className="photo-collection"
                  onClick={() => {
                    pendingFocus.current = true;
                    setFavoriteOnly(true);
                  }}
                >
                  <span>
                    <PhotoIcon name="heart" />
                  </span>
                  <strong>즐겨찾는 항목</strong>
                  <span>{favorites.length}</span>
                  <PhotoIcon name="next" />
                </button>
              </div>
            )}
          </div>
          <footer className="personal-toolbar photos-tabs">
            <div className="personal-capsule" role="group" aria-label="사진 보기">
              <button
                aria-pressed={tab === 'library'}
                onClick={() => {
                  pendingFocus.current = true;
                  returnId.current = null;
                  setTab('library');
                  setFavoriteOnly(false);
                }}
              >
                <PhotoIcon name="grid" />
                <span>보관함</span>
              </button>
              <button
                aria-pressed={tab === 'collections'}
                onClick={() => {
                  pendingFocus.current = true;
                  returnId.current = null;
                  setTab('collections');
                  setFavoriteOnly(false);
                }}
              >
                <PhotoIcon name="collections" />
                <span>모음</span>
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
