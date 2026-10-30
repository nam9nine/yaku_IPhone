import { expect, test } from '../helpers/browser-test';

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`잠금 화면 ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
    await page.goto('./');
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('capture.png') });
    await expect(page).toHaveScreenshot(`lock-${size.width}x${size.height}.png`);
  });
}
