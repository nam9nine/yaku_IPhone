import { expect, type Page } from '@playwright/test';

// Install page.clock before navigation. This retains trusted browser input while
// making the release gap independent of WebKit protocol/CI scheduling delays.
// https://playwright.dev/docs/clock
export async function releaseFastSwipe(page: Page, x: number, y: number) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => {
    const samples: { type: string; time: number; trusted: boolean }[] = [];
    const record = (event: PointerEvent) => {
      samples.push({ type: event.type, time: event.timeStamp, trusted: event.isTrusted });
    };
    Object.assign(window, { __fastSwipeProbe: { samples, record } });
    window.addEventListener('pointermove', record, true);
    window.addEventListener('pointerup', record, true);
  });
  try {
    await page.mouse.move(x, y);
    await page.clock.runFor(16);
    await page.mouse.up();
    const samples = await page.evaluate(() => {
      const host = window as Window & {
        __fastSwipeProbe?: { samples: { type: string; time: number; trusted: boolean }[] };
      };
      return host.__fastSwipeProbe?.samples ?? [];
    });
    const move = samples.filter((sample) => sample.type === 'pointermove').at(-1);
    const release = samples.filter((sample) => sample.type === 'pointerup').at(-1);
    expect(move?.trusted).toBe(true);
    expect(release?.trusted).toBe(true);
    expect(release!.time - move!.time).toBe(16);
  } finally {
    await page.evaluate(() => {
      const host = window as Window & {
        __fastSwipeProbe?: { record: (event: PointerEvent) => void };
      };
      const probe = host.__fastSwipeProbe;
      if (probe) {
        window.removeEventListener('pointermove', probe.record, true);
        window.removeEventListener('pointerup', probe.record, true);
      }
      delete host.__fastSwipeProbe;
    });
    await page.clock.resume();
  }
}
