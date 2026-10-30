import { expect, test } from '../helpers/browser-test';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';
for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`생활 앱 탐색과 상태 유지 ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('./');
    await unlockPhone(page);
    await launchHomeApp(page, 'karaoke');
    await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
    await expect(page.locator('[data-launch-app=karaoke] image')).toHaveAttribute(
      'href',
      /apps\/karaokekan.jpg$/,
    );
    await launchHomeApp(page, 'music');
    await page.getByRole('button', { name: /Judgement/ }).tap();
    await expect(page.getByRole('link', { name: /Apple Music에서 듣기/ })).toHaveAttribute(
      'href',
      /music.apple.com/,
    );
    await page.keyboard.press('Alt+Home');
    await launchHomeApp(page, 'music');
    await expect(page.getByRole('link', { name: /Apple Music에서 듣기/ })).toBeVisible();
    await page.getByRole('button', { name: '이전 화면', exact: true }).tap();
    await page.getByRole('searchbox', { name: '보관함 검색' }).fill('Machinegun');
    await expect(page.locator('.music-library .lifestyle-list button')).toHaveCount(1);
    await page.keyboard.press('Alt+Home');
    await launchHomeApp(page, 'taxi');
    await expect(page.getByRole('button', { name: /바닷가/ })).toHaveCount(0);
    await expect(page.getByText('현재 위치', { exact: true })).toBeVisible();
    await expect(page.getByText(/실제 위치 조회나 택시 호출은 하지 않습니다/)).toHaveCount(0);
    await page.getByRole('button', { name: /류큐 거리/ }).tap();
    await expect(page.getByLabel('선택한 목적지 류큐 거리')).toBeVisible();
    await page.keyboard.press('Alt+Home');
    await launchHomeApp(page, 'taxi');
    await expect(page.getByLabel('선택한 목적지 류큐 거리')).toBeVisible();
    await page.getByRole('button', { name: '다른 목적지 선택' }).tap();
    await page.getByRole('button', { name: /카무로쵸/ }).tap();
    await expect(page.getByLabel('선택한 목적지 카무로쵸')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /류큐 거리/ })).toBeVisible();
    await page.keyboard.press('Alt+Home');
    await launchHomeApp(page, 'cooking');
    await expect(page.getByRole('heading', { name: '나팔꽃키친', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /드래곤 카레 아이들/ }).tap();
    await page.getByRole('button', { name: '만드는 순서' }).tap();
    await page.getByRole('button', { name: '다음', exact: true }).tap();
    await expect(page.getByRole('heading', { name: /냄비에 고기/ })).toBeVisible();
    await page.getByRole('button', { name: '이전 화면', exact: true }).tap();
    await page.getByRole('button', { name: '장보기 메모 열기' }).tap();
    await expect(page.getByRole('checkbox', { name: '감자 완료', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('짧은 화면에서 레시피 하단을 눌러도 조리 단계는 맨 위에서 열린다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
  await launchHomeApp(page, 'cooking');
  await page.getByRole('button', { name: /드래곤 카레 아이들/ }).tap();
  await page.getByRole('button', { name: '만드는 순서' }).tap();
  await expect(page.locator('.cooking-app .lifestyle-content')).toHaveJSProperty('scrollTop', 0);
  await expect(page.getByRole('heading', { name: /채소를 씻어/ })).toBeInViewport();
});
