import { unlockPhone } from '../helpers/unlock';
import { expect, test, type Locator, type Page } from '../helpers/browser-test';
import { attachFailedInput, recordInput } from '../helpers/input-diagnostics';
import { dragTouchWithoutFling } from '../helpers/touch';

test.afterEach(async ({ page }, info) => attachFailedInput(page, info));
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function openHome(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-24T16:40:00+09:00'));
  await page.goto('./');
  await unlockPhone(page);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
  });
}

async function compactHome(page: Page) {
  // The product has only four grid apps. Limited height splits the photo widget and app row.
  await page.setViewportSize({ width: 390, height: 400 });
  await openHome(page);
  await expect(page.locator('.home-page')).toHaveCount(2);
}

async function center(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  return { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
}

async function expectPage(page: Page, number: 1 | 2) {
  await expect(page.getByTestId('home-pages')).toHaveAttribute('data-page', String(number));
  await expect(page.getByRole('button', { name: `${number}페이지로 이동` })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.locator('.home-page-track').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
}

async function swipe(page: Page, direction: 'left' | 'right') {
  const region = (await page.getByTestId('home-pages').boundingBox())!;
  const startX = region.x + region.width * (direction === 'left' ? 0.8 : 0.2);
  const endX = region.x + region.width * (direction === 'left' ? 0.2 : 0.8);
  const y = region.y + region.height * 0.55;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
}

async function expectInsideViewport(locator: Locator, width: number, bottom: number) {
  for (const item of await locator.all()) {
    const bounds = (await item.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(bottom + 1);
  }
}

async function expectNoLaunch(page: Page) {
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  await expect(page.locator('.home-notice')).toHaveCount(0);
}

test('잠금 해제 후 홈으로 포커스를 옮기고 숨겨진 키보드 보조 조작으로 다시 잠근다', async ({
  page,
}) => {
  await openHome(page);
  await expect(page.getByRole('heading', { name: '홈 화면', exact: true })).toBeFocused();
  const home = page.getByTestId('home-screen');
  for (const name of ['제어 센터 열기', '최근 앱 열기', '다시 잠그기']) {
    const control = home.getByRole('button', { name, exact: true });
    await expect(control).toHaveCSS('width', '1px');
    await expect(control).toHaveCSS('height', '1px');
    await expect(control).toHaveCSS('clip-path', 'inset(50%)');
  }
  const lock = home.getByRole('button', { name: '다시 잠그기', exact: true });
  await page.keyboard.press('Tab');
  await lock.focus();
  await expect(lock).toBeFocused();
  await expect(lock).toHaveCSS('clip-path', 'none');
  await expect(lock).toHaveCSS('height', '44px');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.getByTestId('home-screen')).toBeHidden();
  await unlockPhone(page);
  await expectPage(page, 1);
});

for (const size of viewports) {
  test(`사진 위젯 1개·앱 아이콘 9개·Dock 4개가 잘림 없이 보인다 ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const failedResources: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failedResources.push(response.url());
    });
    await openHome(page);
    const widgets = page.locator('.home-widget-button');
    const apps = page.locator('.home-page[aria-hidden="false"] .home-app-grid button');
    const dock = page.getByRole('navigation', { name: 'Dock' });
    const pageBounds = (await page.getByTestId('home-pages').boundingBox())!;
    await expect(widgets).toHaveCount(1);
    await expect(apps).toHaveCount(9);
    expect(
      await apps.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))),
    ).toEqual([
      '사진',
      '캘린더',
      '미리 알림',
      '설정',
      '연락처',
      '음악',
      '택시',
      '나팔꽃키친',
      '가라오케관',
    ]);
    expect(
      await dock
        .getByRole('button')
        .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))),
    ).toEqual(['전화', '메시지', 'Safari', '메모']);
    await expectInsideViewport(widgets, size.width, pageBounds.y + pageBounds.height);
    await expectInsideViewport(apps, size.width, pageBounds.y + pageBounds.height);
    await expectInsideViewport(dock.getByRole('button'), size.width, size.height - 24);
    const appCenters = await apps.evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y) };
      }),
    );
    expect(new Set(appCenters.map(({ x }) => x)).size).toBe(4);
    expect(new Set(appCenters.map(({ y }) => y)).size).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    const photo = page.getByRole('button', { name: '사진 위젯' }).locator('img');
    await expect(photo).toHaveAttribute('src', /\/asagao\//);
    await expect(photo).toHaveJSProperty('complete', true);
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(failedResources).toEqual([]);
  });
}

test('앱을 누르는 동안 작아졌다가 실제 설정을 열고 홈 복귀 후 아이콘이 복구된다', async ({
  page,
}) => {
  await openHome(page);
  const app = page.getByRole('button', { name: '설정', exact: true });
  const icon = app.locator('.app-icon');
  const normalWidth = (await icon.boundingBox())!.width;
  const point = await center(app);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect.poll(async () => (await icon.boundingBox())!.width).toBeLessThan(normalWidth * 0.95);
  await page.mouse.up();
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await expect(app).toBeFocused();
  await expect.poll(async () => (await icon.boundingBox())!.width).toBeCloseTo(normalWidth, 1);
  await expect(page.locator('.home-notice')).toHaveCount(0);
});

test('사진 위젯은 현재 표시된 생활사진을 실제 사진 앱에서 연다', async ({ page }) => {
  await openHome(page);
  const widget = page.getByRole('button', { name: '사진 위젯' });
  const source = await widget.locator('img').getAttribute('src');
  expect(source).not.toBeNull();
  await widget.tap();
  await expect(page.getByTestId('photos-app')).toBeVisible();
  await expect(page.getByTestId('photo-viewer').locator('img')).toHaveAttribute('src', source!);
  await expect(page.getByRole('heading').filter({ hasText: '아이들과 함께' })).toBeVisible();
});

test('한 페이지뿐인 일반 높이에서 좌우 스와이프는 가장자리를 넘어가지 않는다', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('.home-page')).toHaveCount(1);
  await swipe(page, 'left');
  await expectPage(page, 1);
  await swipe(page, 'right');
  await expectPage(page, 1);
  await expectNoLaunch(page);
});

test('짧은 화면의 실제 pointer 좌우 스와이프는 사진과 앱 페이지를 넘기고 양 끝을 지킨다', async ({
  page,
}) => {
  await compactHome(page);
  await swipe(page, 'right');
  await expectPage(page, 1);
  await swipe(page, 'left');
  await expectPage(page, 2);
  await expect(page.getByRole('button', { name: '설정', exact: true })).toBeInViewport();
  await swipe(page, 'left');
  await expectPage(page, 2);
  await swipe(page, 'right');
  await expectPage(page, 1);
  await expect(page.getByRole('button', { name: '사진 위젯' })).toBeInViewport();
  await expectNoLaunch(page);
});

test('짧은·세로·방향을 되돌린 드래그는 페이지 이동이나 앱 실행 없이 복구된다', async ({ page }) => {
  await openHome(page);
  const app = page.getByRole('button', { name: '캘린더', exact: true });
  const origin = await center(app);
  for (const movement of [
    { x: 25, y: 0 },
    { x: 0, y: 18 },
  ]) {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + movement.x, origin.y + movement.y, { steps: 4 });
    await page.mouse.up();
    await expectPage(page, 1);
    await expectNoLaunch(page);
    await expect.poll(async () => (await center(app)).x).toBeCloseTo(origin.x, 1);
  }
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 120, origin.y, { steps: 5 });
  await page.mouse.move(origin.x + 20, origin.y, { steps: 5 });
  await page.mouse.up();
  await expectPage(page, 1);
  await expectNoLaunch(page);
  await app.tap();
  await expect(page.getByTestId('calendar-app')).toBeVisible();
});

test('앱 아이콘에서 시작한 충분한 스와이프는 앱 실행 없이 이전 페이지를 연다', async ({ page }) => {
  await compactHome(page);
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await expectPage(page, 2);
  const point = await center(page.getByRole('button', { name: '캘린더', exact: true }));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 120, point.y, { steps: 8 });
  await page.mouse.up();
  await expectPage(page, 1);
  await expectNoLaunch(page);
});

for (const interruption of ['pointercancel', 'capture-loss', 'blur', 'hidden'] as const) {
  test(`${interruption} 이후 페이지 드래그를 취소하고 다음 입력을 받는다`, async ({ page }) => {
    await compactHome(page);
    await page.getByRole('button', { name: '2페이지로 이동' }).tap();
    await expectPage(page, 2);
    const pages = page.getByTestId('home-pages');
    const app = page.getByRole('button', { name: '캘린더', exact: true });
    const origin = await center(app);
    await pages.evaluate((element) => {
      element.addEventListener(
        'pointerdown',
        (event) => {
          element.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId));
        },
        { once: true },
      );
    });
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 100, origin.y, { steps: 5 });
    const pointerId = Number(await pages.getAttribute('data-test-pointer'));
    if (interruption === 'pointercancel') {
      await pages.dispatchEvent('pointercancel', {
        pointerId,
        clientX: origin.x + 100,
        clientY: origin.y,
        bubbles: true,
      });
    } else if (interruption === 'capture-loss') {
      expect(await pages.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(
        true,
      );
      await pages.evaluate((element, id) => element.releasePointerCapture(id), pointerId);
    } else if (interruption === 'blur') {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    } else {
      // Synthetic visibility checks cleanup; this is not a real iPhone app switch.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'hidden');
      });
    }
    await page.mouse.up();
    await expectPage(page, 2);
    await expect.poll(async () => (await center(app)).x).toBeCloseTo(origin.x, 1);
    await expectNoLaunch(page);
    await swipe(page, 'right');
    await expectPage(page, 1);
  });
}

test('짧은 화면에서 화살표·페이지 버튼으로 이동하고 숨겨진 앱은 포커스 탐색에서 제외한다', async ({
  page,
}) => {
  await compactHome(page);
  const pages = page.getByRole('region', { name: '앱 페이지, 좌우 화살표로 이동' });
  await expect(page.getByRole('button', { name: '사진', exact: true })).toHaveCount(0);
  await pages.focus();
  await page.keyboard.press('ArrowRight');
  await expectPage(page, 2);
  await expect(page.getByRole('button', { name: '사진 위젯' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '사진', exact: true })).toBeFocused();
  await pages.focus();
  await page.keyboard.press('ArrowLeft');
  await expectPage(page, 1);
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await expectPage(page, 2);
  await page.getByRole('button', { name: '1페이지로 이동' }).tap();
  await expectPage(page, 1);
});

test('높이 600과 합성 safe area에서 Dock·설정 접근과 홈 포커스를 보존한다', async ({ page }) => {
  await openHome(page);
  await page.setViewportSize({ width: 390, height: 600 });
  await page.addStyleTag({
    content:
      ':root { --safe-area-top: 20px; --safe-area-right: 12px; --safe-area-bottom: 34px; --safe-area-left: 12px; }',
  });
  await expect(page.getByRole('main')).toHaveCSS('height', '600px');
  const pages = page.getByTestId('home-pages');
  const dock = page.getByRole('navigation', { name: 'Dock' });
  const dockBounds = (await dock.boundingBox())!;
  expect(dockBounds.x).toBeGreaterThanOrEqual(12);
  expect(dockBounds.x + dockBounds.width).toBeLessThanOrEqual(390 - 12);
  expect(dockBounds.y + dockBounds.height).toBeLessThanOrEqual(600 - 34);
  expect(await pages.evaluate((element) => element.scrollTop)).toBe(0);
  const settings = page.getByRole('button', { name: '설정', exact: true });
  const settingsBounds = (await settings.boundingBox())!;
  const pagesBounds = (await pages.boundingBox())!;
  expect(settingsBounds.y).toBeGreaterThanOrEqual(pagesBounds.y - 1);
  expect(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(
    pagesBounds.y + pagesBounds.height + 1,
  );
  await settings.tap();
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await expect(settings).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: test.info().outputPath('home-short.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectInsideViewport(dock.getByRole('button'), 390, 844 - 34);
});

test('reduced motion에서도 페이지 이동과 실제 앱 실행이 완료된다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await compactHome(page);
  await swipe(page, 'left');
  await expectPage(page, 2);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.getByRole('button', { name: '설정', exact: true }).tap();
  await expect(page.getByTestId('settings-app')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('홈 본문의 세로 이동은 스크롤을 만들지 않고 짧은 화면의 가로 페이지는 유지된다', async ({
  page,
  browserName,
}) => {
  await recordInput(page);
  await compactHome(page);
  const pages = page.getByTestId('home-pages');
  const region = (await pages.boundingBox())!;
  const session = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  try {
    if (session) {
      const x = region.x + region.width * 0.5;
      const startY = region.y + region.height * 0.85;
      const endY = region.y + region.height * 0.2;
      await dragTouchWithoutFling(page, session, x, startY, endY - startY);
    } else {
      // Desktop WebKit has no CDP touch-drag API; verify its scroll policy and container.
      await expect(pages).toHaveCSS('touch-action', 'pinch-zoom');
      await pages.evaluate((element) => element.scrollBy(0, 350));
    }
    await expect.poll(async () => pages.evaluate((element) => element.scrollTop)).toBe(0);
    await expectPage(page, 1);
    await expectNoLaunch(page);
    await page.getByRole('button', { name: '2페이지로 이동' }).tap();
    await expectPage(page, 2);
    await page.getByRole('button', { name: '1페이지로 이동' }).tap();
    await expectPage(page, 1);
    await expect.poll(async () => pages.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(page.getByRole('button', { name: '사진 위젯' })).toBeInViewport();
  } finally {
    await session?.detach();
  }
});

test('글자 200%에서도 사진 위젯과 앱 이름·Dock이 잘리지 않고 설정으로 이동한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openHome(page);
  const originalSize = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(
    await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
  ).toBe(originalSize * 2);
  await expect(page.getByRole('button', { name: '사진 위젯' })).toBeInViewport();
  await expectInsideViewport(page.locator('.home-page[aria-hidden="false"] .home-app'), 360, 800);
  await expectInsideViewport(
    page.getByRole('navigation', { name: 'Dock' }).getByRole('button'),
    360,
    800,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.screenshot({ path: test.info().outputPath('home-200.png') });
  const settings = page.getByRole('button', { name: '설정', exact: true });
  await settings.tap();
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await expect(settings).toBeFocused();
});

test('브라우저별 실제 입력으로 짧은 화면의 홈 페이지를 넘긴다: Chromium touch / WebKit pointer', async ({
  page,
  browserName,
}) => {
  await compactHome(page);
  if (browserName === 'chromium') {
    const region = (await page.getByTestId('home-pages').boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const y = region.y + region.height * 0.55;
    const startX = region.x + region.width * 0.8;
    const endX = region.x + region.width * 0.2;
    const point = (x: number) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 });
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point(startX)],
      });
      for (let step = 1; step <= 8; step++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [point(startX + ((endX - startX) * step) / 8)],
        });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else {
    await swipe(page, 'left');
  }
  await expectPage(page, 2);
  await expectNoLaunch(page);
});

test('화면을 늘려 페이지 수가 줄어들면 현재 페이지를 보정하고 첫 방향키도 경계를 지킨다', async ({
  page,
}) => {
  await compactHome(page);
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await expectPage(page, 2);
  await page.setViewportSize({ width: 430, height: 932 });
  const pages = page.getByTestId('home-pages');
  await expect(page.locator('.home-page')).toHaveCount(1);
  await expectPage(page, 1);
  await pages.focus();
  await page.keyboard.press('ArrowLeft');
  await expectPage(page, 1);
  await page.keyboard.press('ArrowRight');
  await expectPage(page, 1);
  await expect(page.getByRole('button', { name: '설정', exact: true })).toBeInViewport();
});

test('짧은 화면에서도 실제 Tab 순회로 검색과 다음 페이지 버튼에 접근한다', async ({ page }) => {
  await compactHome(page);
  await page.locator('[data-home-title]').focus();
  const names = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    names.add(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
  }
  expect(names.has('홈 앱 검색')).toBe(true);
  expect(names.has('2페이지로 이동')).toBe(true);
});

test('홈 진입의 시각 변환은 페이지 용량과 렌더링에 영향을 주지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await compactHome(page);
  const home = page.getByTestId('home-screen');
  const pageCount = await home.locator('.home-page').count();
  expect(pageCount).toBe(2);
  const style = await page.addStyleTag({
    content: '.home-screen { animation: none !important; transform: scale(.5); }',
  });
  await page.setViewportSize({ width: 390, height: 401 });
  await expect(page.getByRole('main')).toHaveCSS('height', '401px');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(home.locator('.home-page')).toHaveCount(pageCount);
  await style.evaluate((element) => element.parentNode?.removeChild(element));
  await page.setViewportSize({ width: 390, height: 400 });
  await expect(home.locator('.home-page')).toHaveCount(pageCount);
  expect(errors).toEqual([]);
});
