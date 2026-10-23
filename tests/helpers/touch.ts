import { expect, type CDPSession, type Page } from '@playwright/test';

type TouchProbeWindow = Window & {
  __harnessTouchMove?: { moved: boolean; listener: (event: PointerEvent) => void };
};

// Native touch input with an explicit end at rest. A burst of dispatchTouchEvent
// moves can create a platform fling; Linux may consume the next tap to stop it.
// https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-synthesizeScrollGesture
export async function dragTouchWithoutFling(
  page: Page,
  session: CDPSession,
  x: number,
  y: number,
  yDistance: number,
) {
  await page.evaluate(() => {
    const host = window as TouchProbeWindow;
    const probe = {
      moved: false,
      listener(event: PointerEvent) {
        if (event.isTrusted && event.pointerType === 'touch') probe.moved = true;
      },
    };
    host.__harnessTouchMove = probe;
    window.addEventListener('pointermove', probe.listener, true);
  });
  try {
    await session.send('Input.synthesizeScrollGesture', {
      x,
      y,
      yDistance,
      speed: 600,
      gestureSourceType: 'touch',
      preventFling: true,
    });
    expect(await page.evaluate(() => (window as TouchProbeWindow).__harnessTouchMove?.moved)).toBe(
      true,
    );
  } finally {
    await page.evaluate(() => {
      const host = window as TouchProbeWindow;
      if (host.__harnessTouchMove)
        window.removeEventListener('pointermove', host.__harnessTouchMove.listener, true);
      delete host.__harnessTouchMove;
    });
  }
}
