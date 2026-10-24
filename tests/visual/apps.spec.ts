import { expect, test, type Page } from '@playwright/test';
import { checkPaged, firstContentPage, tapPaged } from '../helpers/paged-content';

async function start(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
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
for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`설정 목록 ${size.width}x${size.height}`, async ({ page }) => {
    await start(page, size);
    await page.locator('[data-launch-app=settings]').tap();
    await capture(page, `settings-main-${size.width}x${size.height}.png`);
  });
  for (const scene of ['start', 'guide'] as const) {
    test(`Safari ${scene} ${size.width}x${size.height}`, async ({ page }) => {
      await start(page, size);
      await page.locator('[data-launch-app=safari]').tap();
      if (scene === 'guide')
        await page.getByRole('button', { name: '휴대폰 사용법', exact: true }).tap();
      await capture(page, `safari-${scene}-${size.width}x${size.height}.png`);
    });
  }
}
test('다크 설정과 큰 글자', async ({ page }) => {
  await start(page, { width: 390, height: 844 });
  await page.locator('[data-launch-app=settings]').tap();
  await tapPaged(page.locator('[data-settings-page=appearance]'));
  await checkPaged(page.getByRole('radio', { name: '다크 모드', exact: true }));
  await checkPaged(page.getByRole('radio', { name: '더 크게 130%' }));
  await firstContentPage(page.getByTestId('settings-content'));
  await capture(page, 'settings-dark-large-390x844.png');
});
test('Safari 두 탭', async ({ page }) => {
  await start(page, { width: 390, height: 844 });
  await page.locator('[data-launch-app=safari]').tap();
  await page.getByRole('button', { name: '휴대폰 사용법', exact: true }).tap();
  await page.getByRole('button', { name: '페이지 메뉴', exact: true }).tap();
  await page.getByRole('dialog').getByRole('button', { name: '새 탭', exact: true }).tap();
  await page.getByRole('button', { name: '주말 산책', exact: true }).tap();
  await page.getByRole('button', { name: '탭 보기, 2개', exact: true }).tap();
  await capture(page, 'safari-tabs-390x844.png');
});
