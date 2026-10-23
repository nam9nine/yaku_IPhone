import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useEdgeNavigation } from '../navigation/EdgeNavigation';
import { initialNotes } from './data';
import { useStoredState } from './useStoredState';
import './personal.css';

type Note = (typeof initialNotes)[number];

function validNotes(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    new Set(
      value.map((item: unknown) =>
        item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined,
      ),
    ).size === value.length &&
    value.every((note: unknown) => {
      if (!note || typeof note !== 'object') return false;
      const item = note as Record<string, unknown>;
      return (
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.body === 'string' &&
        typeof item.updatedAt === 'string' &&
        Number.isFinite(Date.parse(item.updatedAt)) &&
        Array.isArray(item.checklist) &&
        new Set(
          item.checklist.map((entry: unknown) =>
            entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : undefined,
          ),
        ).size === item.checklist.length &&
        item.checklist.every((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return false;
          const check = entry as Record<string, unknown>;
          return (
            typeof check.id === 'string' &&
            typeof check.text === 'string' &&
            typeof check.done === 'boolean'
          );
        })
      );
    })
  );
}

function NoteIcon({ name }: { name: 'back' | 'compose' | 'trash' | 'checklist' | 'search' }) {
  const paths = {
    back: 'm14 5-7 7 7 7',
    compose:
      'M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M9 15l1-4L19 2l3 3-9 9-4 1 M17 4l3 3',
    trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    checklist: 'm3 7 2 2 3-4M11 7h10M3 16a2 2 0 1 0 4 0 2 2 0 0 0-4 0M11 16h10',
    search: 'M16 16l5 5M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0',
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NotesApp({ active }: { active: boolean }) {
  const [notes, setNotes, unavailable] = useStoredState<Note[]>('notes', initialNotes, validNotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = notes.find((note) => note.id === selectedId);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const returnId = useRef<string | null>(null);
  const pendingFocus = useRef<'title' | 'heading' | 'item' | 'check' | null>(null);
  const noteTitle = (note: Note) => note.title.trim() || '새로운 메모';

  useLayoutEffect(() => {
    if (!active || !pendingFocus.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'title') titleInput.current?.focus();
    else if (target === 'check')
      root.current
        ?.querySelector<HTMLInputElement>('.note-checklist li:last-child input[type="text"]')
        ?.focus();
    else if (target === 'item') {
      if (scroll.current) scroll.current.scrollTop = listPosition.current;
      const row = Array.from(
        root.current?.querySelectorAll<HTMLButtonElement>('[data-note-id]') ?? [],
      ).find((item) => item.dataset.noteId === returnId.current);
      (row ?? heading.current)?.focus({ preventScroll: true });
    } else heading.current?.focus({ preventScroll: true });
  }, [active, selectedId, notes]);

  useLayoutEffect(() => {
    const element = bodyInput.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [selected?.body, selectedId, active]);

  useLayoutEffect(() => {
    const element = bodyInput.current;
    if (!element) return;
    let previousWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedId]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (confirmDelete && active) element.showModal();
    else element.close();
  }, [confirmDelete, active]);

  function back() {
    if (!selected) return;
    returnId.current = selected.id;
    pendingFocus.current = 'item';
    setSelectedId(null);
    setConfirmDelete(false);
  }
  const edge = useEdgeNavigation({
    active: active && !confirmDelete,
    onBack: selected ? back : undefined,
  });

  function update(patch: Partial<Note>) {
    if (!selected) return;
    setNotes((current) =>
      current.map((note) =>
        note.id === selected.id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note,
      ),
    );
  }

  function createNote() {
    const note: Note = {
      id: crypto.randomUUID(),
      title: '',
      body: '',
      checklist: [],
      updatedAt: new Date().toISOString(),
    };
    setNotes((current) => [note, ...current]);
    setQuery('');
    pendingFocus.current = 'title';
    setSelectedId(note.id);
  }

  function addCheck() {
    if (!selected) return;
    pendingFocus.current = 'check';
    update({
      checklist: [...selected.checklist, { id: crypto.randomUUID(), text: '', done: false }],
    });
  }

  const filtered = notes.filter((note) =>
    `${note.title} ${note.body} ${note.checklist.map((item) => item.text).join(' ')}`
      .toLocaleLowerCase('ko')
      .includes(query.trim().toLocaleLowerCase('ko')),
  );

  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (active && event.key === 'Escape' && selected && !confirmDelete) {
      event.preventDefault();
      event.stopPropagation();
      back();
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
      className={`personal-app notes-app${selected ? ' notes-app--detail' : ''}`}
      aria-label="메모 화면"
      {...edge}
    >
      <header className={`personal-header${selected ? '' : ' personal-header--large'}`}>
        {selected ? (
          <>
            <button className="personal-round" aria-label="메모 목록으로 돌아가기" onClick={back}>
              <NoteIcon name="back" />
            </button>
            <h1 ref={heading} data-app-title tabIndex={-1} className="personal-visually-hidden">
              {noteTitle(selected)}
            </h1>
            <button
              className="notes-done"
              onClick={() => {
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                heading.current?.focus({ preventScroll: true });
              }}
            >
              완료
            </button>
          </>
        ) : (
          <h1 ref={heading} data-app-title tabIndex={-1}>
            메모
          </h1>
        )}
      </header>
      {unavailable && (
        <p className="personal-storage" role="status">
          저장 공간을 사용할 수 없어 이번 접속 중에만 유지됩니다.
        </p>
      )}
      <div
        ref={scroll}
        className="personal-scroll notes-scroll"
        data-testid="notes-content"
        onScroll={(event) => {
          if (!selected) listPosition.current = event.currentTarget.scrollTop;
        }}
      >
        {!selected ? (
          <>
            <label className="personal-search">
              <NoteIcon name="search" />
              <input
                type="search"
                aria-label="메모 검색"
                placeholder="검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="notes-list">
              {filtered.map((note) => (
                <button
                  key={note.id}
                  className="notes-row"
                  data-note-id={note.id}
                  onClick={() => {
                    pendingFocus.current = 'heading';
                    setSelectedId(note.id);
                    if (scroll.current) scroll.current.scrollTop = 0;
                  }}
                >
                  <strong>{noteTitle(note)}</strong>
                  <span>
                    {note.body.split('\n').find(Boolean) ||
                      note.checklist.find((item) => item.text)?.text ||
                      '추가 텍스트 없음'}
                  </span>
                </button>
              ))}
            </div>
            {!filtered.length && (
              <div className="personal-empty">
                <h2>{query ? '검색 결과 없음' : '메모 없음'}</h2>
                <p>{query ? '다른 단어로 검색해 보세요.' : '새로운 메모를 작성해 보세요.'}</p>
              </div>
            )}
          </>
        ) : (
          <article className="note-paper">
            <input
              ref={titleInput}
              className="note-title"
              aria-label="메모 제목"
              placeholder="제목"
              value={selected.title}
              onChange={(event) => update({ title: event.target.value })}
            />
            <textarea
              ref={bodyInput}
              className="note-body"
              aria-label="메모 내용"
              placeholder="메모"
              value={selected.body}
              onChange={(event) => update({ body: event.target.value })}
              rows={1}
            />
            <ul className="note-checklist">
              {selected.checklist.map((item, index) => (
                <li key={item.id} data-done={item.done}>
                  <input
                    type="checkbox"
                    aria-label={`${item.text || `항목 ${index + 1}`} 완료`}
                    checked={item.done}
                    onChange={(event) =>
                      update({
                        checklist: selected.checklist.map((entry) =>
                          entry.id === item.id ? { ...entry, done: event.target.checked } : entry,
                        ),
                      })
                    }
                  />
                  <input
                    type="text"
                    aria-label={`체크리스트 항목 ${index + 1}`}
                    placeholder="목록 항목"
                    value={item.text}
                    onChange={(event) =>
                      update({
                        checklist: selected.checklist.map((entry) =>
                          entry.id === item.id ? { ...entry, text: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <button
                    className="note-remove-check"
                    aria-label={`${item.text || `항목 ${index + 1}`} 항목 삭제`}
                    onClick={() =>
                      update({
                        checklist: selected.checklist.filter((entry) => entry.id !== item.id),
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>
      <footer className="personal-toolbar notes-toolbar">
        {selected ? (
          <div className="personal-capsule">
            <button aria-label="체크리스트 항목 추가" onClick={addCheck}>
              <NoteIcon name="checklist" />
            </button>
            <button aria-label="메모 삭제" onClick={() => setConfirmDelete(true)}>
              <NoteIcon name="trash" />
            </button>
          </div>
        ) : (
          <span className="notes-count">{notes.length}개의 메모</span>
        )}
        <button className="personal-round" aria-label="새로운 메모" onClick={createNote}>
          <NoteIcon name="compose" />
        </button>
      </footer>
      <dialog
        ref={dialog}
        className="personal-alert"
        aria-labelledby="delete-note-title"
        onCancel={() => setConfirmDelete(false)}
        onClose={() => setConfirmDelete(false)}
      >
        <h2 id="delete-note-title">이 메모를 삭제하겠습니까?</h2>
        <p>삭제한 메모는 되돌릴 수 없습니다.</p>
        <div>
          <button autoFocus onClick={() => setConfirmDelete(false)}>
            취소
          </button>
          <button
            className="personal-destructive"
            onClick={() => {
              const id = selectedId;
              setNotes((current) => current.filter((note) => note.id !== id));
              pendingFocus.current = 'heading';
              setSelectedId(null);
              setConfirmDelete(false);
            }}
          >
            삭제
          </button>
        </div>
      </dialog>
    </section>
  );
}
