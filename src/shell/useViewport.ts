import { useEffect, useState } from 'react';
export function useViewport() {
  const read = () => {
    const width = window.visualViewport?.width ?? window.innerWidth;
    const height = window.visualViewport?.height ?? window.innerHeight;
    const framed = width >= 900 && height >= 600;
    const phoneHeight = framed ? Math.min(844, height - 48) : height;
    return {
      width: framed ? 390 : width,
      height: phoneHeight,
      top: (window.visualViewport?.offsetTop ?? 0) + (framed ? (height - phoneHeight) / 2 : 0),
      left: framed ? (width - 390) / 2 : 0,
      framed,
    };
  };
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const resize = () => setViewport(read());
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    // Reconcile a resize between the initial render and listener registration.
    const initialFrame = window.requestAnimationFrame(resize);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, []);
  return viewport;
}
