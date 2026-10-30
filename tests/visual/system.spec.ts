import { unlockPhone } from '../helpers/unlock';
import { expect, test, type Page } from '../helpers/browser-test';
async function start(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await unlockPhone(page);
}
async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
  });
  await page.screenshot({ path: test.info().outputPath('capture.png') });
  await expect(page).toHaveScreenshot(name);
}
for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
]) {
  test(`제어 센터 ${width}x${height}`, async ({ page }) => {
    await start(page, width, height);
    await page.keyboard.press('Alt+c');
    await capture(page, `control-${width}x${height}.png`);
  });
  test(`최근 앱 ${width}x${height}`, async ({ page }) => {
    await start(page, width, height);
    await page.locator('[data-launch-app=settings]').tap();
    await page.locator('[data-settings-page=wifi]').tap();
    await page.keyboard.press('Alt+Home');
    await page.locator('[data-launch-app=safari]').tap();
    await page.getByRole('button', { name: '휴대폰 사용법', exact: true }).tap();
    await page.keyboard.press('Alt+a');
    await capture(page, `switcher-${width}x${height}.png`);
  });
}
for (const [kind, key] of [
  ['notifications', 'n'],
  ['search', 's'],
]) {
  test(`${kind} 390x844`, async ({ page }) => {
    await start(page, 390, 844);
    await page.keyboard.press(`Alt+${key}`);
    await capture(page, `${kind}-390x844.png`);
  });
}

for (const group of [1, 2, 3]) {
  test(`제어 센터 큰 글자 200% 360x420 ${group}그룹`, async ({ page }) => {
    await start(page, 360, 420);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.keyboard.press('Alt+c');
    await page.getByRole('button', { name: `제어 센터 ${group}페이지`, exact: true }).tap();
    await capture(page, `control-large-${group}-360x420.png`);
  });
}
