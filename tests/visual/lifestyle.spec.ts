import { expect, test, type Page } from '../helpers/browser-test';
import { launchHomeApp } from '../helpers/home';
import { unlockPhone } from '../helpers/unlock';

const scenes = [
  'music-library',
  'music-song',
  'taxi-destinations',
  'taxi-route',
  'cooking-ingredients',
  'cooking-step',
] as const;

async function openScene(page: Page, scene: (typeof scenes)[number]) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.clock.setFixedTime(new Date('2026-10-24T16:40:00+09:00'));
  await page.goto('./');
  await unlockPhone(page);
  if (scene.startsWith('music')) {
    await launchHomeApp(page, 'music');
    if (scene === 'music-song') {
      await page.getByRole('button', { name: /Judgement/ }).tap();
      await expect(page.getByRole('link', { name: /Apple Music에서 듣기/ })).toBeVisible();
    } else {
      await expect(page.locator('.music-library .lifestyle-list button')).toHaveCount(3);
    }
  } else if (scene.startsWith('taxi')) {
    await launchHomeApp(page, 'taxi');
    if (scene === 'taxi-route') {
      await page.getByRole('button', { name: /류큐 거리/ }).tap();
      await expect(page.getByLabel('선택한 목적지 류큐 거리')).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: /카무로쵸/ })).toBeVisible();
    }
  } else {
    await launchHomeApp(page, 'cooking');
    await page.getByRole('button', { name: /드래곤 카레 아이들/ }).tap();
    if (scene === 'cooking-step') {
      await page.getByRole('button', { name: '만드는 순서', exact: true }).tap();
      await page.getByRole('button', { name: '다음', exact: true }).tap();
      await expect(page.getByRole('heading', { name: /냄비에 고기/ })).toBeInViewport();
    } else {
      await expect(page.getByRole('button', { name: '장보기 메모 열기' })).toBeVisible();
    }
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
}

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  for (const scene of scenes) {
    test(`생활 앱 ${scene} ${size.width}`, async ({ page }) => {
      await page.setViewportSize(size);
      await openScene(page, scene);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
      await expect(page).toHaveScreenshot(`lifestyle-${scene}-${size.width}.png`);
    });
  }
}

test('짧은 화면의 카레 조리 단계 390x400', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  await openScene(page, 'cooking-step');
  await expect(page.locator('.cooking-app .lifestyle-content')).toHaveJSProperty('scrollTop', 0);
  await expect(page.getByRole('button', { name: '이전', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '다음', exact: true })).toBeInViewport();
  await expect(page).toHaveScreenshot('lifestyle-cooking-step-390x400.png');
});
