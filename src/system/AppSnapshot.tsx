import { useLayoutEffect, useRef } from 'react';
import type { RunnableApp } from '../shell/session';

/** A visual copy only. No second React app, event handlers, IDs or focus targets. */
export function AppSnapshot({
  app,
  getPreview,
  viewport,
}: {
  app: RunnableApp;
  getPreview: (app: RunnableApp) => HTMLElement | null;
  viewport: { width: number; height: number };
}) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = host.current;
    const source = getPreview(app);
    if (!container || !source) return;
    const clone = source.cloneNode(true) as HTMLElement;
    const width = source.clientWidth || Math.min(478, viewport.width);
    const height = source.clientHeight || viewport.height;
    for (const node of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
      node.removeAttribute('id');
      node.removeAttribute('data-testid');
      node.removeAttribute('data-app-title');
      node.removeAttribute('autofocus');
      node.removeAttribute('name');
      node.removeAttribute('for');
      node.removeAttribute('aria-labelledby');
      node.removeAttribute('aria-describedby');
      node.removeAttribute('data-app-window');
      node.removeAttribute('data-settings-page');
      if (node.matches('button, input, select, textarea, a, [tabindex], [contenteditable]')) {
        node.tabIndex = -1;
        node.removeAttribute('contenteditable');
      }
    }
    clone.hidden = false;
    clone.inert = true;
    clone.setAttribute('aria-hidden', 'true');
    Object.assign(clone.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: `${width}px`,
      maxWidth: 'none',
      height: `${height}px`,
      transformOrigin: 'top left',
      pointerEvents: 'none',
      transition: 'none',
      animation: 'none',
      borderRadius: '0',
    });
    container.append(clone);
    const resize = () => {
      const scale = Math.min(container.clientWidth / width, container.clientHeight / height);
      clone.style.transform = `translateX(${(container.clientWidth - width * scale) / 2}px) scale(${scale})`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => {
      observer.disconnect();
      clone.remove();
    };
  }, [app, getPreview, viewport.width, viewport.height]);

  return <div ref={host} className="recent-snapshot" aria-hidden="true" inert />;
}
