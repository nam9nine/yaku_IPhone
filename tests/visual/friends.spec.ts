import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';
for (const friend of [
  { id: 'akiyama', name: '아키야마 슌' },
  { id: 'nishiki', name: '니시키야마 아키라' },
]) {
  for (const scene of ['contact', 'thread'] as const) {
    test(`${friend.name} ${scene} 390`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
      await page.goto('./');
      await unlockPhone(page);
      await launchHomeApp(page, 'contacts');
      await page.locator(`[data-contact=${friend.id}]`).tap();
      if (scene === 'thread')
        await page.getByRole('button', { name: `${friend.name}에게 메시지 보내기` }).tap();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => img.decode()));
      });
      await expect(page).toHaveScreenshot(`${friend.id}-${scene}-390.png`);
    });
  }
}
