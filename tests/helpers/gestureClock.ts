import { expect, type Locator, type Page } from '@playwright/test';

interface TimedPoint {
  dx: number;
  dy: number;
  afterMs: number;
}

// Freeze the whole path, not only its release, so a slow curve remains slow
// under CI scheduling. The page clock must be installed before navigation.
export async function dragTimedPath(
  page: Page,
  surface: Locator,
  points: TimedPoint[],
  options: {
    holdMs?: number;
    originX?: number;
    atEnd?: (point: { x: number; y: number }) => Promise<void>;
  } = {},
) {
  await surface.click({ trial: true });
  const box = (await surface.boundingBox())!;
  const x = box.x + box.width * (options.originX ?? 0.5);
  const y = box.y + box.height / 2;
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.mouse.move(x, y);
  await page.evaluate(() => {
    const samples: { type: string; time: number; trusted: boolean }[] = [];
    const record = (event: PointerEvent) => {
      samples.push({ type: event.type, time: event.timeStamp, trusted: event.isTrusted });
    };
    Object.assign(window, { __pathProbe: { samples, record } });
    for (const type of ['pointerdown', 'pointermove', 'pointerup'])
      window.addEventListener(type, record as EventListener, true);
  });
  let released = false;
  try {
    await page.mouse.down();
    for (const point of points) {
      await page.clock.runFor(point.afterMs);
      await page.mouse.move(x + point.dx, y + point.dy);
    }
    await page.clock.runFor(16);
    const last = points.at(-1)!;
    await options.atEnd?.({ x: x + last.dx, y: y + last.dy });
    await page.clock.runFor(options.holdMs ?? 0);
    await page.mouse.up();
    released = true;
    const samples = await page.evaluate(() => {
      const host = window as Window & {
        __pathProbe?: { samples: { type: string; time: number; trusted: boolean }[] };
      };
      return host.__pathProbe?.samples ?? [];
    });
    expect(samples.every((sample) => sample.trusted)).toBe(true);
    expect(samples.map((sample) => sample.type)).toEqual([
      'pointerdown',
      ...points.map(() => 'pointermove'),
      'pointerup',
    ]);
    expect(samples.slice(1).map((sample, index) => sample.time - samples[index].time)).toEqual([
      ...points.map((point) => point.afterMs),
      16 + (options.holdMs ?? 0),
    ]);
  } finally {
    if (!released) await page.mouse.up();
    await page.evaluate(() => {
      const host = window as Window & { __pathProbe?: { record: (event: PointerEvent) => void } };
      if (host.__pathProbe)
        for (const type of ['pointerdown', 'pointermove', 'pointerup'])
          window.removeEventListener(type, host.__pathProbe.record as EventListener, true);
      delete host.__pathProbe;
    });
    await page.clock.resume();
  }
}

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
