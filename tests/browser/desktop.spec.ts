import { unlockPhone } from '../helpers/unlock';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { releaseFastSwipe } from '../helpers/gestureClock';

test.use({ isMobile: false, hasTouch: false });

async function ready(page: Page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
}
async function openSettings(page: Page) {
  await page.locator('[data-launch-app=settings]').click();
  await expect(page.getByTestId('settings-app')).toBeVisible();
}
async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}
async function insidePhone(page: Page, locator: Locator) {
  const outer = await bounds(page.locator('.mobile-shell'));
  const inner = await bounds(locator);
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
}
async function fillsPhone(page: Page, locator: Locator) {
  const outer = await bounds(page.locator('.mobile-shell'));
  for (const key of ['x', 'y', 'width', 'height'] as const)
    await expect.poll(async () => (await bounds(locator))[key]).toBeCloseTo(outer[key], 0);
}
async function gestureAreasInside(page: Page) {
  await expect(page.locator('.home-indicator')).toHaveCount(0);
  const zones = page.locator(
    '.home-system-bottom:visible, .app-home-gesture:visible, .system-dismiss-gesture:visible',
  );
  expect(await zones.count()).toBeGreaterThan(0);
  for (const zone of await zones.all()) await insidePhone(page, zone);
}
async function beginBottom(page: Page) {
  const zone = page.getByTestId('settings-home-gesture');
  await zone.click({ trial: true });
  const box = await bounds(zone);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

test('PC에서는 390×844 폰이 중앙에 있고 모바일 크기 변경 시 앱도 화면을 채운다', async ({
  page,
}) => {
  await ready(page);
  const phone = page.locator('.mobile-shell');
  await expect(phone).toHaveAttribute('data-framed', 'true');
  expect(await bounds(phone)).toEqual({ x: 445, y: 78, width: 390, height: 844 });
  await gestureAreasInside(page);
  await insidePhone(page, page.getByTestId('control-edge'));
  await insidePhone(page, page.getByTestId('notification-edge'));
  await openSettings(page);
  await fillsPhone(page, page.getByTestId('settings-app'));
  await fillsPhone(page, page.getByTestId('brightness-overlay'));
  await gestureAreasInside(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(phone).toHaveAttribute('data-framed', 'false');
  expect(await bounds(phone)).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await fillsPhone(page, page.getByTestId('settings-app'));
  await gestureAreasInside(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect(phone).toHaveAttribute('data-framed', 'true');
  await fillsPhone(page, page.getByTestId('settings-app'));
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
});

test('PC 폰의 빠른 하단 스와이프는 홈으로, 느린 스와이프는 폰 안의 최근 앱으로 간다', async ({
  page,
}) => {
  await page.clock.install();
  await ready(page);
  await openSettings(page);
  await page.locator('[data-settings-page=wifi]').click();
  const fast = await beginBottom(page);
  await releaseFastSwipe(page, fast.x, fast.y - 170);
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await gestureAreasInside(page);
  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  const slow = await beginBottom(page);
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(slow.x, slow.y - step * 30);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(180);
  await page.mouse.up();
  await expect(page.getByTestId('system-switcher')).toBeVisible();
  await fillsPhone(page, page.getByTestId('system-switcher'));
  await gestureAreasInside(page);
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await fillsPhone(page, page.getByTestId('settings-app'));
});

test('PC 폰에서 카드를 중간부터 끝까지 줄이며 올려도 배경과 홈 복귀는 프레임 안에 머문다', async ({
  page,
}) => {
  await ready(page);
  await openSettings(page);
  const phone = await bounds(page.locator('.mobile-shell'));
  const start = await beginBottom(page);
  await page.mouse.move(start.x, start.y - 300, { steps: 8 });
  await page.waitForTimeout(180);
  await expect(page.getByTestId('settings-app')).toHaveAttribute('data-dragging', 'true');
  const middle = await bounds(page.getByTestId('settings-app'));
  expect(middle.width).toBeLessThan(phone.width);
  await insidePhone(page, page.locator('.gesture-stage-backdrop'));
  await page.mouse.move(start.x, phone.y + 70, { steps: 12 });
  await expect
    .poll(async () => (await bounds(page.getByTestId('settings-app'))).width)
    .toBeLessThan(middle.width);
  await page.mouse.up();
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await gestureAreasInside(page);
});

test('PC 폰 오른쪽 위 제어 센터와 키보드 조작은 프레임을 벗어나지 않는다', async ({ page }) => {
  await ready(page);
  await openSettings(page);
  const edge = await bounds(page.getByTestId('control-edge'));
  const x = edge.x + edge.width / 2;
  const y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 120, { steps: 8 });
  await page.mouse.up();
  const control = page.getByTestId('system-control');
  await expect(control).toBeVisible();
  await expect
    .poll(async () => (await control.boundingBox())?.y)
    .toBeCloseTo((await bounds(page.getByRole('main'))).y, 0);
  await fillsPhone(page, control);
  await gestureAreasInside(page);
  const wifi = control.getByRole('switch', { name: 'Wi-Fi', exact: true });
  await insidePhone(page, wifi);
  await wifi.click();
  await expect(wifi).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(control).toHaveCount(0);
  await expect(page.getByTestId('settings-app')).toBeVisible();
  const keyboardControl = page
    .getByTestId('settings-app')
    .getByRole('button', { name: '제어 센터 열기', exact: true });
  await keyboardControl.focus();
  await insidePhone(page, keyboardControl);
  await keyboardControl.press('Enter');
  await expect(control).toBeVisible();
  await expect
    .poll(async () => (await control.boundingBox())?.y)
    .toBeCloseTo((await bounds(page.getByRole('main'))).y, 0);
  await fillsPhone(page, control);
  await page.keyboard.press('Escape');
  const left = await bounds(page.getByTestId('notification-edge'));
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await page.mouse.down();
  await page.mouse.move(left.x + left.width / 2, left.y + 130, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('system-notifications')).toBeVisible();
  await fillsPhone(page, page.getByTestId('system-notifications'));
  await gestureAreasInside(page);
});
