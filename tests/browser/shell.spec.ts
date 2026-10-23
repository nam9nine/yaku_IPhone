import { expect, test, type Page } from '@playwright/test';
import { dragTouchWithoutFling } from '../helpers/touch';

async function home(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}
async function open(page: Page, app: 'settings' | 'safari' = 'settings') {
  await page.locator(`[data-launch-app="${app}"]`).tap();
  await expect(page.getByTestId(`${app}-app`)).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished));
  });
}
async function begin(page: Page) {
  const zone = page.getByTestId('settings-home-gesture');
  // Wait for the returning app transform before choosing the next gesture origin.
  // A stale coordinate can land in selectable app content instead of this surface.
  await zone.click({ trial: true });
  const box = (await zone.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`앱은 전체 면에서 열리고 빠르게 위로 밀면 바로 홈으로 복귀한다 ${size.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await home(page);
    await open(page);
    const app = page.getByTestId('settings-app');
    const box = (await app.boundingBox())!;
    expect(box.width).toBe(size.width);
    expect(box.height).toBe(size.height);
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: '다시 잠그기' })).toHaveCount(0);
    const start = await begin(page);
    await page.mouse.move(start.x, start.y - 130, { steps: 3 });
    await page.mouse.up();

    await expect(page.getByTestId('system-switcher')).toHaveCount(0);
    await expect(app).toBeHidden();
    await expect(page.getByRole('button', { name: '설정', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('짧은·수평·취소·resize·blur 드래그는 앱을 유지하고 다음 스와이프로 최근 앱을 연다', async ({
  page,
}) => {
  await home(page);
  await open(page);
  for (const mode of ['short', 'horizontal', 'cancel', 'resize', 'blur']) {
    const { x, y } = await begin(page);
    await page.mouse.move(mode === 'horizontal' ? x + 140 : x, y - (mode === 'short' ? 40 : 110), {
      steps: 5,
    });
    await expect(page.getByTestId('settings-app')).toHaveAttribute('data-dragging', 'true');
    if (mode === 'cancel')
      await page
        .getByTestId('settings-home-gesture')
        .dispatchEvent('pointercancel', { pointerId: 1 });
    if (mode === 'resize') await page.setViewportSize({ width: 390, height: 700 });
    if (mode === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    // A diagonal with greater horizontal travel must not open the app switcher.
    await expect(page.getByTestId('settings-app')).toBeVisible();
    await expect(page.getByTestId('system-switcher')).toHaveCount(0);
    await expect(page.getByTestId('settings-app')).toHaveAttribute('data-dragging', 'false');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  }
  const retry = await begin(page);
  await page.mouse.move(retry.x, retry.y - 130, { steps: 8 });
  await page.waitForTimeout(180);
  await page.mouse.up();
  await expect(page.getByTestId('system-switcher')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-app')).toBeHidden();
});

test('홈 페이지와 포커스가 유지되고 비활성 앱은 입력에서 제외된다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  const settings = page.getByRole('button', { name: '설정', exact: true });
  await expect(settings).toBeInViewport();
  const homePage = await page.getByTestId('home-pages').getAttribute('data-page');
  await open(page);
  await page.keyboard.press('Alt+Home');
  await expect(settings).toBeFocused();
  await expect(page.getByTestId('home-pages')).toHaveAttribute('data-page', homePage!);
  expect(await page.getByTestId('home-pages').evaluate((el) => el.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await open(page, 'safari');
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toHaveCount(0);
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('home-pages')).toHaveAttribute('data-page', '2');
  await expect(page.locator('[data-launch-app="safari"]')).toBeFocused();
});

test('본문 드래그는 최근 앱을 열지 않으며 reduced motion과 반복 키보드 복귀는 안정적이다', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await home(page);
  await open(page);
  await page.mouse.move(180, 400);
  await page.mouse.down();
  await page.mouse.move(180, 200, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await page.keyboard.press('Alt+Home');
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await open(page);
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeFocused();
});

test('브라우저별 정지한 터치와 빠른 포인터가 최근 앱과 홈을 구분한다', async ({
  page,
  browserName,
}) => {
  await home(page);
  await open(page);
  const bounds = (await page.getByTestId('settings-home-gesture').boundingBox())!;
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  if (browserName !== 'chromium') {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 128, { steps: 8 });
    await page.mouse.up();
  } else {
    const client = await page.context().newCDPSession(page);
    try {
      // A physical touch drag ending at rest keeps the following card tap distinct
      // from Linux Chromium's synthetic burst/fling cancellation tap.
      await dragTouchWithoutFling(page, client, x, y, -128);
    } finally {
      await client.detach();
    }
  }
  if (browserName === 'chromium') {
    await expect(page.getByTestId('system-switcher')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await expect(page.getByTestId('settings-app')).toBeHidden();
});

test('실행 아이콘이 다른 페이지에 있으면 다시 잠금 해제할 때 홈 제목에 포커스한다', async ({
  page,
}) => {
  await home(page);
  await open(page);
  await page.keyboard.press('Alt+Home');
  await page.setViewportSize({ width: 390, height: 400 });
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await page.getByRole('button', { name: '1페이지로 이동' }).tap();
  await page.getByRole('button', { name: '다시 잠그기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(page.getByTestId('home-pages')).toHaveAttribute('data-page', '1');
  await expect(page.locator('[data-home-title]')).toBeFocused();
});
