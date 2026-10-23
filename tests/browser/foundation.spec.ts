import { expect, test } from '@playwright/test';
import { attachFailedInput, recordInput } from '../helpers/input-diagnostics';

test.afterEach(async ({ page }, info) => attachFailedInput(page, info));

test('프로젝트 경로에서 한국 날짜·시계와 로컬 배경이 로드된다', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.locator('time')).toHaveText('10월 23일 금요일');
  await expect(page.getByRole('img', { name: '9시 41분' })).toBeVisible();
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
  for (const [side, value] of Object.entries({ top: 36, right: 71, bottom: 58, left: 71 }))
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
  if (browserName === 'chromium') {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 20, y: 250 }],
    });
    for (let y = 230; y >= 180; y -= 10)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 20, y }],
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await client.detach();
  } else {
    // WebKit has no CDP touch-drag API; check native scroll policy and the reachable control.
    await page.getByRole('button', { name: '잠금 해제', exact: true }).scrollIntoViewIfNeeded();
  }
  await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(page.getByTestId('home-screen')).toBeVisible();
});

test('분 경계와 한국 자정에 시계·날짜를 갱신한다', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T23:59:59+09:00') });
  await page.goto('./');
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-12-31');
  await page.clock.fastForward(1000);
  await expect(page.getByRole('img', { name: '0시 0분' })).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2027-01-01');
});
