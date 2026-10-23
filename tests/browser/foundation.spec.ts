import { expect, test } from '@playwright/test';

test('프로젝트 경로에서 준비 화면과 로컬 배경이 로드된다', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'yaku iPhone' })).toBeVisible();
  await expect(page.locator('time')).toHaveText('10월 23일 금요일');
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-10-23');
  const wallpaper = page.locator('.mobile-shell-wallpaper img');
  await expect(wallpaper).toHaveJSProperty('complete', true);
  expect(await wallpaper.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(failures).toEqual([]);
});

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`전체 viewport를 채운다 ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./');
    await expect(page.getByRole('main')).toHaveCSS('min-height', `${size.height}px`);
    expect(await page.getByRole('main').boundingBox()).toEqual({ x: 0, y: 0, ...size });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('주소창 변화에 해당하는 높이 변경 후에도 내용이 잘리지 않는다', async ({ page }) => {
  await page.goto('./');
  for (const height of [600, 932, 440]) {
    await page.setViewportSize({ width: 390, height });
    await expect(page.getByRole('main')).toHaveCSS('min-height', `${height}px`);
    const bounds = (await page.getByTestId('fixture').boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(24);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 24);
  }
});

test('네 방향 safe area 값을 콘텐츠 안쪽 여백에 더한다', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('./');
  // Synthetic insets verify layout arithmetic, not a real iPhone's system UI.
  await page.addStyleTag({
    content:
      ':root { --safe-area-top: 20px; --safe-area-right: 47px; --safe-area-bottom: 34px; --safe-area-left: 47px; }',
  });
  const shell = page.getByRole('main');
  await expect(shell).toHaveCSS('padding-top', '44px');
  await expect(shell).toHaveCSS('padding-right', '71px');
  await expect(shell).toHaveCSS('padding-bottom', '58px');
  await expect(shell).toHaveCSS('padding-left', '71px');
  const bounds = (await page.getByTestId('fixture').boundingBox())!;
  const shellBounds = (await shell.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(71);
  expect(bounds.y).toBeGreaterThanOrEqual(44);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(844 - 71);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(shellBounds.height - 58);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(844);
});

test('문자 확대와 짧은 화면에서 내용 끝까지 스크롤할 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 320 });
  await page.goto('./');
  await page.addStyleTag({ content: ':root { font-size: 200%; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  expect((await page.getByTestId('fixture').boundingBox())!.y).toBeGreaterThanOrEqual(24);
  await page.getByText('준비하고 있습니다.', { exact: false }).scrollIntoViewIfNeeded();
  const paragraph = (await page.locator('.welcome p').boundingBox())!;
  expect(paragraph.y + paragraph.height).toBeLessThanOrEqual(320);
});

test('reduced motion에서 지속적인 화면 애니메이션이 없다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--motion-short').trim(),
    ),
  ).toMatch(/^0(?:ms|s)$/);
});

test('화면을 열어둔 채 한국 날짜가 바뀌면 표시도 갱신된다', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T23:59:30+09:00') });
  await page.goto('./');
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-12-31');
  await page.clock.fastForward(60_000);
  await expect(page.locator('time')).toHaveText('1월 1일 금요일');
  await expect(page.locator('time')).toHaveAttribute('datetime', '2027-01-01');
});
