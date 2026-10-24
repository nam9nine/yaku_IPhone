import { expect, test } from '@playwright/test';

for (const width of [360, 390, 430]) {
  test(`암호 숫자판 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : width === 390 ? 844 : 932 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('./');
    await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
    await page.getByRole('dialog', { name: '암호 입력' }).waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page).toHaveScreenshot(`personal-passcode-${width}.png`);
  });
}
