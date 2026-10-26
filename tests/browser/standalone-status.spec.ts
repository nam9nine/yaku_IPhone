import { expect, test, type Page } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';
import { finishAiReply } from '../helpers/ai-clock';
import { mockStoryAi } from '../helpers/mock-story-ai';
import { enterPasscode, unlockPhone } from '../helpers/unlock';

type Device = 'iphone' | 'ipad' | 'desktop';

async function boot(page: Page, device: Device, standalone: boolean) {
  await page.addInitScript(
    ({ device, standalone }) => {
      Object.defineProperties(navigator, {
        userAgent: {
          value:
            device === 'iphone'
              ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
              : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15',
        },
        platform: { value: device === 'iphone' ? 'iPhone' : 'MacIntel' },
        maxTouchPoints: { value: device === 'desktop' ? 0 : 5 },
        // Exercise iPad's desktop UA and the legacy standalone property too.
        standalone: { value: device === 'ipad' && standalone },
      });
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const media = original(query);
        if (query === '(display-mode: standalone)')
          Object.defineProperty(media, 'matches', {
            value: device !== 'ipad' && standalone,
          });
        return media;
      };
    },
    { device, standalone },
  );
  await mockStoryAi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  // Synthetic insets verify preservation; desktop engines do not emulate iOS safe areas.
  await page.addStyleTag({
    content: ':root { --safe-area-top: 44px; --safe-area-bottom: 34px; }',
  });
  await expect(page.getByTestId('lock-screen')).toBeVisible();
}

async function expectNativeLayout(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-native-status-bar', '');
  await expect(page.locator('.phone-status-bar:visible')).toHaveCount(0);
  await expect(page.locator('.mobile-shell')).toHaveCSS('padding-top', '56px');
  expect(
    await page.locator('.mobile-shell').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        row: style.getPropertyValue('--status-row-height').trim(),
        top: style.getPropertyValue('--safe-area-top').trim(),
        bottom: style.getPropertyValue('--safe-area-bottom').trim(),
      };
    }),
  ).toEqual({ row: '0px', top: '44px', bottom: '34px' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
}

test('합성 iPhone standalone은 잠금·암호·홈·메시지·전화의 웹 상태바만 제거한다', async ({
  page,
}, testInfo) => {
  await boot(page, 'iphone', true);
  await expectNativeLayout(page);
  await page.screenshot({ path: testInfo.outputPath('standalone-lock.png') });
  await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '암호 입력', exact: true })).toBeVisible();
  await expectNativeLayout(page);
  await enterPasscode(page);
  await expectNativeLayout(page);
  await expect(page.locator('.system-top-edge').first()).toHaveCSS('top', '50px');

  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=haruka]').tap();
  await expect(page.getByRole('textbox', { name: '하루카에게 메시지 입력' })).toBeEnabled();
  await expectNativeLayout(page);
  await expect(page.locator('[data-app-window=messages]')).toHaveCSS('padding-top', '44px');
  await page.screenshot({ path: testInfo.outputPath('standalone-messages.png') });
  await page.getByRole('textbox', { name: '하루카에게 메시지 입력' }).fill('잘 지내고 있니?');
  await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
  await page.keyboard.press('Alt+Home');
  await finishAiReply(page, 'haruka');
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
  await expect(page.locator('.ai-reply-banner')).toHaveCSS('top', '48px');
  await page.getByRole('button', { name: '메시지 알림 닫기', exact: true }).tap();
  await launchHomeApp(page, 'phone');
  await expect(page.getByRole('region', { name: '전화 내용' })).toBeVisible();
  await expectNativeLayout(page);
  await expect(page.locator('[data-app-window=phone]')).toHaveCSS('padding-top', '44px');

  await page.keyboard.press('Alt+Home');
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  for (const name of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${name} 완료`, exact: true }).check();
  await expect(page.locator('.incoming-call-banner')).toHaveCSS('top', '48px');
  await page.getByRole('button', { name: '수신 전화 전체 화면', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '마지마 형님 전화 수신' })).toBeVisible();
  await expectNativeLayout(page);
});

test('합성 iPad 데스크톱 UA와 legacy standalone에서도 native 상태바 공간을 보존한다', async ({
  page,
}) => {
  await boot(page, 'ipad', true);
  await expectNativeLayout(page);
  await unlockPhone(page);
  await expectNativeLayout(page);
});

for (const [device, standalone] of [
  ['iphone', false],
  ['desktop', true],
] as const) {
  test(`${device} standalone=${standalone}: 기존 웹 상태바와 레이아웃을 유지한다`, async ({
    page,
  }) => {
    await boot(page, device, standalone);
    await expect(page.locator('html')).not.toHaveAttribute('data-native-status-bar');
    await expect(page.locator('.mobile-shell > .phone-status-bar')).toBeVisible();
    await expect(page.locator('.mobile-shell')).toHaveCSS('padding-top', '90px');
    await unlockPhone(page);
    await expect(page.locator('.system-top-edge').first()).toHaveCSS('top', '84px');
    await launchHomeApp(page, 'messages');
    await expect(page.locator('.mobile-shell > .phone-status-bar')).toBeVisible();
    await expect(page.locator('[data-app-window=messages]')).toHaveCSS('padding-top', '78px');
  });
}
