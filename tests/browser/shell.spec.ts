import { expect, test, type Page } from '@playwright/test';

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
  const box = (await page.getByTestId('settings-home-gesture').boundingBox())!;
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
  test(`앱은 전체 면에서 열리고 전용 스와이프로 복귀한다 ${size.width}`, async ({ page }) => {
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
    await page.mouse.move(start.x, start.y - 130, { steps: 8 });
    await page.mouse.up();
    await expect(app).toBeHidden();
    await expect(page.getByRole('button', { name: '설정', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('짧은·수평·취소·resize·blur 드래그 후에도 다시 홈으로 갈 수 있다', async ({ page }) => {
  await home(page);
  await open(page);
  for (const mode of ['short', 'horizontal', 'cancel', 'resize', 'blur']) {
    const { x, y } = await begin(page);
    await page.mouse.move(mode === 'horizontal' ? x + 140 : x, y - (mode === 'short' ? 40 : 110), {
      steps: 5,
    });
    if (mode === 'cancel')
      await page
        .getByTestId('settings-home-gesture')
        .dispatchEvent('pointercancel', { pointerId: 1 });
    if (mode === 'resize') await page.setViewportSize({ width: 390, height: 700 });
    if (mode === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    // A diagonal with greater horizontal travel must not qualify as a home swipe.
    await expect(page.getByTestId('settings-app')).toBeVisible();
    await expect(page.getByTestId('settings-app')).toHaveAttribute('data-dragging', 'false');
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('settings-app')).toBeHidden();
});

test('홈 페이지와 스크롤·포커스가 유지되고 비활성 앱은 입력에서 제외된다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 500 });
  await home(page);
  const settings = page.getByRole('button', { name: '설정', exact: true });
  await settings.scrollIntoViewIfNeeded();
  const scroll = await page.getByTestId('home-pages').evaluate((el) => el.scrollTop);
  await open(page);
  await page.getByRole('button', { name: '홈으로 돌아가기' }).tap();
  await expect(settings).toBeFocused();
  expect(await page.getByTestId('home-pages').evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await open(page, 'safari');
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '홈으로 돌아가기' }).tap();
  await expect(page.getByTestId('home-pages')).toHaveAttribute('data-page', '2');
  await expect(page.locator('[data-launch-app="safari"]')).toBeFocused();
});

test('본문 드래그는 홈 복귀가 아니며 reduced motion과 반복 복귀는 안정적이다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await home(page);
  await open(page);
  await page.mouse.move(180, 400);
  await page.mouse.down();
  await page.mouse.move(180, 200, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await page
    .getByRole('button', { name: '홈으로 돌아가기' })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await open(page);
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeFocused();
});

test('브라우저별 홈 제스처: Chromium touch / WebKit pointer', async ({ page, browserName }) => {
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
    await expect(page.getByTestId('settings-app')).toBeHidden();
    return;
  }
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - i * 16 }],
    });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('settings-app')).toBeHidden();
});

test('다른 홈 페이지에서 다시 잠금을 해제하면 표시 중인 홈 제목에 포커스한다', async ({ page }) => {
  await home(page);
  await open(page);
  await page.getByRole('button', { name: '홈으로 돌아가기' }).tap();
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await page.getByRole('button', { name: '다시 잠그기' }).tap();
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(page.getByTestId('home-pages')).toHaveAttribute('data-page', '2');
  await expect(page.locator('[data-home-title]')).toBeFocused();
});
