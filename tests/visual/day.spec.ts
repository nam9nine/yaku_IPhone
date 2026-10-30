import { enterPasscode, unlockPhone } from '../helpers/unlock';
import { expect, test } from '@playwright/test';
import { mockStoryAi, openStoryAi } from '../helpers/mock-story-ai';

test.beforeEach(async ({ page }) => {
  await mockStoryAi(page);
});

for (const scene of ['lock', 'haruka'] as const) {
  test(`PC 프레임 ${scene}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.goto('./');
    if (scene === 'haruka') {
      await page.getByRole('button', { name: '하루카의 메시지 알림 열기' }).click();
      await openStoryAi(page, () => enterPasscode(page));
    }
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
  await openStoryAi(page, () => enterPasscode(page));
  await page.getByRole('button', { name: '오늘 저녁 카레 열기' }).tap();
  for (const name of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${name} 완료`, exact: true }).check();
  await page.getByRole('button', { name: '전화 거절' }).tap();
  const followup = page.getByRole('status', { name: '새 메시지 도착', exact: true });
  await expect(followup).toContainText('검증용 마지마 전화 후속 문자');
  await followup.getByRole('button', { name: '메시지 알림 닫기', exact: true }).tap();
  const storyDismiss = page.getByRole('button', { name: '이야기 메시지 알림 닫기', exact: true });
  while (await storyDismiss.count()) await storyDismiss.tap();
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  await page.keyboard.press('Alt+Home');
  const lock = page.getByRole('button', { name: '다시 잠그기' });
  await lock.focus();
  await lock.press('Enter');
  await expect(page.getByRole('button', { name: '남은 할 일 4개' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('day-completed-lock-actual.png'),
    animations: 'disabled',
  });
  await expect(page).toHaveScreenshot('day-completed-lock.png');
});

test('작은 화면의 두 번째 홈 페이지', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('./');
  await unlockPhone(page);
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await expect(page).toHaveScreenshot('day-home-small-page2.png');
});
