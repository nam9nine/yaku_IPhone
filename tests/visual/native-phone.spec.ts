import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';
import { mockStoryAi, openStoryAi } from '../helpers/mock-story-ai';

test.beforeEach(async ({ page }) => {
  await mockStoryAi(page);
});
const scenes = [
  'phone',
  'keypad',
  'contacts',
  'settings',
  'profile',
  'messages',
  'thread',
  'gallery',
  'incoming',
  'locked-call',
  'missed-lock',
] as const;
for (const width of [360, 390, 430])
  for (const scene of scenes) {
    if (width !== 390 && !['phone', 'keypad', 'settings', 'incoming'].includes(scene)) continue;
    test(`실사용 캡처 기준 다크 ${scene} ${width}`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: width === 360 ? 800 : width === 390 ? 844 : 932,
      });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
      await page.clock.install({ time: new Date('2026-10-24T16:40:00+09:00') });
      await page.goto('./');
      await unlockPhone(page);
      if (scene === 'incoming' || scene === 'locked-call' || scene === 'missed-lock') {
        await launchHomeApp(page, 'notes');
        await page.locator('[data-note-id=curry]').tap();
        for (const name of ['감자', '양파', '고기', '카레'])
          await page.getByRole('checkbox', { name: `${name} 완료`, exact: true }).check();
        if (scene === 'missed-lock') {
          await page.getByRole('button', { name: '전화 거절' }).tap();
          const followup = page.getByRole('status', { name: '새 메시지 도착', exact: true });
          await expect(followup).toContainText('검증용 마지마 전화 후속 문자');
          await followup.getByRole('button', { name: '메시지 알림 닫기', exact: true }).tap();
          const storyDismiss = page.getByRole('button', {
            name: '이야기 메시지 알림 닫기',
            exact: true,
          });
          while (await storyDismiss.count()) await storyDismiss.tap();
          await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
        }
        if (scene !== 'incoming') {
          await page.keyboard.press('Alt+Home');
          const lock = page.getByRole('button', { name: '다시 잠그기', exact: true });
          await lock.focus();
          await lock.press('Enter');
        }
      } else {
        const app =
          scene === 'keypad'
            ? 'phone'
            : scene === 'profile'
              ? 'settings'
              : scene === 'thread'
                ? 'messages'
                : scene === 'gallery'
                  ? 'photos'
                  : scene;
        await launchHomeApp(page, app);
        if (scene === 'keypad')
          await page.getByRole('button', { name: '키패드', exact: true }).tap();
        if (scene === 'profile')
          await page.getByRole('button', { name: '키류 카즈마 프로필' }).tap();
        if (scene === 'thread')
          await openStoryAi(page, () => page.locator('[data-conversation=haruka]').tap());
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => img.decode()));
      });
      await page.screenshot({
        path: test.info().outputPath(`native-${scene}-${width}-actual.png`),
        animations: 'disabled',
      });
      await expect(page).toHaveScreenshot(`native-${scene}-${width}.png`);
    });
  }
