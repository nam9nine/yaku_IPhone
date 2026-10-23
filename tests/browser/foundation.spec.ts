import { expect, test } from '@playwright/test';

test('프로젝트 경로에서 빌드된 준비 화면과 자산이 로드된다', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'yaku iPhone' })).toBeVisible();
  await expect(page.getByTestId('fixture')).toBeVisible();
  await expect(page.getByRole('main')).toHaveCSS('display', 'grid');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(failures).toEqual([]);
});

test('뷰포트 높이 변경 후에도 내용이 잘리지 않는다', async ({ page }) => {
  await page.goto('./');
  await page.setViewportSize({ width: 360, height: 600 });
  const bounds = await page.getByTestId('fixture').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
