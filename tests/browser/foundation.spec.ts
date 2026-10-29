import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '@playwright/test';
import { attachFailedInput, recordInput } from '../helpers/input-diagnostics';
import { dragTouchWithoutFling } from '../helpers/touch';

test.afterEach(async ({ page }, info) => attachFailedInput(page, info));

test('프로젝트 경로에서 가상 토요일 날짜·시계와 로컬 배경이 로드된다', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.locator('.lock-date')).toHaveText('10월 24일 토요일');
  await expect(page.getByRole('img', { name: '16시 40분' })).toBeVisible();
  for (const img of await page.locator('main img').all()) {
    await expect(img).toHaveJSProperty('complete', true);
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  expect(failures).toEqual([]);
});

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`전체 viewport와 하단 제어 ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./');
    expect(await page.getByRole('main').boundingBox()).toEqual({ x: 0, y: 0, ...size });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    const control = (await page
      .getByRole('button', { name: '잠금 해제', exact: true })
      .boundingBox())!;
    expect(control.y + control.height).toBeLessThanOrEqual(size.height - 24);
  });
}

test('높이 변경·네 방향 safe area에서도 콘텐츠에 접근한다', async ({ page }) => {
  await page.goto('./');
  for (const height of [600, 932, 440]) {
    await page.setViewportSize({ width: 390, height });
    await expect(page.getByRole('main')).toHaveCSS('height', `${height}px`);
    await page.getByRole('button', { name: '잠금 해제', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 844, height: 390 });
  // Synthetic insets verify layout arithmetic, not a real iPhone's system UI.
  await page.addStyleTag({
    content:
      ':root { --safe-area-top: 20px; --safe-area-right: 47px; --safe-area-bottom: 34px; --safe-area-left: 47px; }',
  });
  for (const [side, value] of Object.entries({ top: 66, right: 71, bottom: 58, left: 71 }))
    await expect(page.getByRole('main')).toHaveCSS(`padding-${side}`, `${value}px`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(844);
  await page.getByRole('button', { name: '잠금 해제', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toBeInViewport();
});

test('문자 확대와 짧은 화면에서도 세로 스크롤 없이 하단 제어에 접근한다', async ({
  page,
  browserName,
}) => {
  await recordInput(page);
  await page.setViewportSize({ width: 360, height: 320 });
  await page.goto('./');
  const originalSize = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(
    await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
  ).toBe(originalSize * 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await expect(page.getByTestId('lock-screen')).toHaveCSS('touch-action', 'pinch-zoom');
  const client = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  try {
    if (client) {
      await dragTouchWithoutFling(page, client, 20, 250, -70);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    } else {
      // WebKit has no CDP touch-drag API; check native scroll policy and the reachable control.
      await page.getByRole('button', { name: '잠금 해제', exact: true }).scrollIntoViewIfNeeded();
    }
    await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toBeInViewport();
    await unlockPhone(page);
    await expect(page.getByTestId('home-screen')).toBeVisible();
  } finally {
    await client?.detach();
  }
});

test('실제 시각의 자정과 날짜 변경은 가상 시각·할 일·알림을 진행시키지 않는다', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-12-31T23:59:59+09:00') });
  await page.goto('./');
  await expect(page.locator('.lock-date')).toHaveAttribute('datetime', '2026-10-24');
  await expect(page.getByRole('img', { name: '16시 40분' })).toBeVisible();
  await expect(page.getByRole('button', { name: '남은 할 일 5개' })).toBeVisible();
  const notification = page.locator('.day-notification');
  const before = await notification.innerText();
  await page.clock.fastForward(86_401_000);
  await expect(page.locator('.lock-date')).toHaveAttribute('datetime', '2026-10-24');
  await expect(page.getByRole('img', { name: '16시 40분' })).toBeVisible();
  await expect(page.getByRole('button', { name: '남은 할 일 5개' })).toBeVisible();
  await expect(notification).toHaveText(before, { useInnerText: true });
});

test('PC에서는 가운데 기기 프레임을 표시하고 모바일 크기로 바꾸면 전체 화면을 쓴다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./');
  const phone = page.getByRole('main');
  await expect(phone).toHaveAttribute('data-framed', 'true');
  expect(await phone.boundingBox()).toEqual({ x: 525, y: 78, width: 390, height: 844 });
  await expect(phone).toHaveCSS('border-radius', '44px');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(phone).toHaveAttribute('data-framed', 'false');
  expect(await phone.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
});

test('초기 렌더와 viewport 구독 사이 크기가 바뀌어도 현재 높이로 맞춘다', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error('visualViewport is required for this regression');
    let height = 844;
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => height });
    const subscribe = window.addEventListener;
    let changed = false;
    window.addEventListener = new Proxy(subscribe, {
      apply(target, thisArg, args) {
        // Model the browser resizing after render, before the resize listener exists.
        if (args[0] === 'resize' && !changed) {
          changed = true;
          height = 600;
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
  });
  await page.goto('./');
  await expect(page.getByRole('main')).toHaveCSS('height', '600px');
  await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toBeInViewport();
});
