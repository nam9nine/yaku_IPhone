import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '../helpers/browser-test';
import { launchHomeApp } from '../helpers/home';
for (const scene of ['contact', 'thread'] as const) {
  test(`다테 형사 ${scene} 390`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('./');
    await unlockPhone(page);
    await launchHomeApp(page, 'contacts');
    await page.locator('[data-contact=date]').tap();
    if (scene === 'thread')
      await page.getByRole('button', { name: '다테 마코토에게 메시지 보내기' }).tap();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    await expect(page).toHaveScreenshot(`date-${scene}-390.png`);
  });
}
