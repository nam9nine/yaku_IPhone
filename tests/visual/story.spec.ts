import { expect, test } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';
for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  for (const scene of [
    'contacts',
    'profile',
    'messages',
    'thread',
    'notes',
    'note',
    'photos',
    'photo',
    'reminders',
    'calendar',
    'phone',
  ] as const) {
    test(`키류 ${scene} ${size.width}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
      await page.clock.setFixedTime(new Date('2026-10-24T16:40:00+09:00'));
      await page.goto('./');
      await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
      const app =
        scene === 'profile'
          ? 'contacts'
          : scene === 'thread'
            ? 'messages'
            : scene === 'note'
              ? 'notes'
              : scene === 'photo'
                ? 'photos'
                : scene;
      await launchHomeApp(page, app);
      if (scene === 'profile')
        await page.getByRole('button', { name: '사와무라 하루카', exact: true }).tap();
      if (scene === 'thread') await page.locator('[data-conversation=haruka]').tap();
      if (scene === 'note') await page.locator('[data-note-id=curry]').tap();
      if (scene === 'photo')
        await page.getByRole('button', { name: '나팔꽃의 식사 시간', exact: true }).tap();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => img.decode()));
      });
      await page.screenshot({
        path: test.info().outputPath(`story-${scene}-${size.width}-actual.png`),
        animations: 'disabled',
      });
      await expect(page).toHaveScreenshot(`story-${scene}-${size.width}.png`);
    });
  }
}
