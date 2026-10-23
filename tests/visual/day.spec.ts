import { expect, test } from '@playwright/test';

for (const scene of ['lock', 'haruka'] as const) {
  test(`PC 프레임 ${scene}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.goto('./');
    if (scene === 'haruka')
      await page.getByRole('button', { name: '하루카의 메시지 알림 열기' }).click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    await expect(page).toHaveScreenshot(`day-desktop-${scene}.png`);
  });
}

test('장보기 완료 후 잠금 위젯', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('./');
  await page.getByRole('button', { name: '하루카의 메시지 알림 열기' }).tap();
  await page.getByRole('button', { name: '장보기 목록: 오늘 저녁 카레 메모 열기' }).tap();
  for (const name of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${name} 완료`, exact: true }).check();
  await page.getByRole('button', { name: '부재중 전화 알림 닫기' }).tap();
  await page.keyboard.press('Alt+Home');
  const lock = page.getByRole('button', { name: '다시 잠그기' });
  await lock.focus();
  await lock.press('Enter');
  await expect(page.getByRole('button', { name: '남은 할 일 2개' })).toBeVisible();
  await expect(page).toHaveScreenshot('day-completed-lock.png');
});

test('작은 화면의 두 번째 홈 페이지', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await expect(page).toHaveScreenshot('day-home-small-page2.png');
});
