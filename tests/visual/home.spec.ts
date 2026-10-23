import { expect, test } from '@playwright/test';

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  for (const pageNumber of [1]) {
    test(`홈 ${pageNumber}페이지 ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      // Capture a static scene without transient compositor layers from the entry motion.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
      await page.goto('./');
      await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
      await expect(page.getByTestId('home-screen')).toBeVisible();
      for (const img of await page.locator('main img').all()) {
        await expect(img).toHaveJSProperty('complete', true);
        expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
        await img.evaluate((el: HTMLImageElement) => el.decode());
      }
      if (pageNumber === 2) await page.getByRole('button', { name: '2페이지로 이동' }).tap();
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().map((animation) => animation.finished));
      });
      await page.screenshot({ path: test.info().outputPath('capture.png') });
      await expect(page).toHaveScreenshot(`home-${pageNumber}-${size.width}x${size.height}.png`);
    });
  }
}
