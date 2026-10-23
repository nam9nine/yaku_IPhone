import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useHorizontalGesture } from './useHorizontalGesture';
import './navigation.css';

interface Props {
  children: ReactNode;
  label: string;
  active?: boolean;
  page?: number;
  onPageChange?: (page: number) => void;
  className?: string;
  contentClassName?: string;
  testId?: string;
}

export function PagedContent({
  children,
  label,
  active = true,
  page,
  onPageChange,
  className = '',
  contentClassName = '',
  testId,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [localPage, setLocalPage] = useState(0);
  const [layout, setLayout] = useState({ width: 1, height: 1, count: 1 });
  const current = Math.min(page ?? localPage, layout.count - 1);
  const stride = layout.width + 24;
  function select(next: number, count = layout.count) {
    const value = Math.max(0, Math.min(next, count - 1));
    setLocalPage(value);
    onPageChange?.(value);
  }
  const measure = useEffectEvent(() => {
    if (!active || !viewport.current || !flow.current) return;
    const width = viewport.current.clientWidth;
    const height = viewport.current.clientHeight;
    if (!width || !height) return;
    flow.current.style.columnWidth = `${width}px`;
    flow.current.style.setProperty('--paged-height', `${height}px`);
    const count = Math.max(1, Math.ceil((flow.current.scrollWidth + 24) / (width + 24)));
    setLayout((previous) =>
      previous.width === width && previous.height === height && previous.count === count
        ? previous
        : { width, height, count },
    );
  });
  useLayoutEffect(() => {
    measure();
  }, [children, active]);
  useEffect(() => {
    const observer = new ResizeObserver(() => measure());
    if (viewport.current) observer.observe(viewport.current);
    const contentObserver = new MutationObserver(() => measure());
    if (flow.current)
      contentObserver.observe(flow.current, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    return () => {
      observer.disconnect();
      contentObserver.disconnect();
    };
  }, []);
  const bind = useHorizontalGesture({
    active,
    start: () => (layout.count > 1 ? 'both' : null),
    commit: (direction) => select(current + (direction === 'next' ? 1 : -1)),
  });
  return (
    <section
      className={`paged-content ${className}`}
      aria-label={label}
      data-testid={testId}
      data-page={current + 1}
      data-pages={layout.count}
    >
      <div
        ref={viewport}
        className="paged-viewport"
        {...bind}
        onFocusCapture={(event) => {
          if (!viewport.current) return;
          const bounds = event.target.getBoundingClientRect();
          const origin = viewport.current.getBoundingClientRect();
          const actualStride = viewport.current.clientWidth + 24;
          const count = Math.max(
            1,
            Math.ceil(((flow.current?.scrollWidth ?? 0) + 24) / actualStride),
          );
          select(
            Math.floor((bounds.left - origin.left + current * stride + 1) / actualStride),
            count,
          );
        }}
      >
        <div
          ref={flow}
          className={`paged-flow ${contentClassName}`}
          style={
            {
              transform: `translateX(${-current * stride}px)`,
              '--paged-height': `${layout.height}px`,
            } as CSSProperties
          }
        >
          {children}
        </div>
      </div>
      <nav className="paged-controls" aria-label={`${label} 페이지 이동`} data-no-page-gesture>
        <button
          type="button"
          tabIndex={0}
          aria-label={`${label} 이전 페이지`}
          disabled={current === 0}
          onClick={() => select(current - 1)}
        >
          ‹
        </button>
        <span role="status" aria-live="polite">
          {current + 1} / {layout.count}
        </span>
        <button
          type="button"
          tabIndex={0}
          aria-label={`${label} 다음 페이지`}
          disabled={current === layout.count - 1}
          onClick={() => select(current + 1)}
        >
          ›
        </button>
      </nav>
    </section>
  );
}
