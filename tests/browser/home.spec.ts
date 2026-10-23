import { expect, test, type Locator, type Page } from '@playwright/test';

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function openHome(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
  });
}

async function center(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  return { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
}

async function expectPage(page: Page, number: 1 | 2) {
  await expect(page.getByRole('button', { name: `${number}페이지로 이동` })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.getByRole('button', { name: number === 1 ? 'FaceTime' : '날씨' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: number === 1 ? '날씨' : 'FaceTime' })).toHaveCount(
    0,
  );
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

test('잠금 해제 후 홈으로 포커스를 옮기고 다시 잠글 수 있다', async ({ page }) => {
  await openHome(page);
  await expect(page.getByRole('heading', { name: '홈 화면', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '다시 잠그기' }).tap();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.getByTestId('home-screen')).toHaveCount(0);
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expectPage(page, 1);
});

for (const size of viewports) {
  test(`위젯 2개·앱 16개·Dock 4개가 잘림 없이 보인다 ${size.width}x${size.height}`, async ({
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
    await expect(widgets).toHaveCount(2);
    await expect(apps).toHaveCount(16);
    await expect(dock.getByRole('button')).toHaveCount(4);
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
    expect(new Set(appCenters.map(({ y }) => y)).size).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    const photo = page.getByRole('button', { name: '사진 위젯' }).locator('img');
    await expect(photo).toHaveJSProperty('complete', true);
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(
      page.getByRole('button', { name: '캘린더 위젯, 10월 23일 금요일, 일정 없음' }),
    ).toBeVisible();
    expect(failedResources).toEqual([]);
  });
}

test('앱을 누르는 동안 작아졌다가 복구되고 앱 준비 안내를 닫을 수 있다', async ({ page }) => {
  await openHome(page);
  const app = page.getByRole('button', { name: '사진', exact: true });
  const icon = app.locator('.app-icon');
  const normalWidth = (await icon.boundingBox())!.width;
  const point = await center(app);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect.poll(async () => (await icon.boundingBox())!.width).toBeLessThan(normalWidth * 0.95);
  await page.mouse.up();
  await expect(page.getByRole('status')).toHaveText('사진 앱은 곧 만나요');
  await expect.poll(async () => (await icon.boundingBox())!.width).toBeCloseTo(normalWidth, 1);
  await page.getByRole('button', { name: '앱 안내 닫기' }).tap();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: '전화' }).tap();
  await expect(page.getByRole('status')).toHaveText('전화 앱은 곧 만나요');
});

test('실제 pointer 좌우 스와이프로 페이지를 넘기고 양 끝을 넘어가지 않는다', async ({ page }) => {
  await openHome(page);
  await swipe(page, 'right');
  await expectPage(page, 1);
  await swipe(page, 'left');
  await expectPage(page, 2);
  await swipe(page, 'left');
  await expectPage(page, 2);
  await swipe(page, 'right');
  await expectPage(page, 1);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('짧은·세로·방향을 되돌린 드래그는 페이지 이동이나 앱 실행 없이 복구된다', async ({ page }) => {
  await openHome(page);
  const app = page.getByRole('button', { name: 'FaceTime' });
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
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect.poll(async () => (await center(app)).x).toBeCloseTo(origin.x, 1);
  }
  const camera = await center(page.getByRole('button', { name: '카메라', exact: true }));
  await page.mouse.move(camera.x, camera.y);
  await page.mouse.down();
  await page.mouse.move(camera.x - 120, camera.y, { steps: 5 });
  await page.mouse.move(camera.x - 20, camera.y, { steps: 5 });
  await page.mouse.up();
  await expectPage(page, 1);
  await expect(page.getByRole('status')).toHaveCount(0);
  await app.tap();
  await expect(page.getByRole('status')).toHaveText('FaceTime 앱은 곧 만나요');
});

test('앱 아이콘에서 시작한 충분한 스와이프는 앱 안내 없이 다음 페이지를 연다', async ({ page }) => {
  await openHome(page);
  const point = await center(page.getByRole('button', { name: '카메라', exact: true }));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 120, point.y, { steps: 8 });
  await page.mouse.up();
  await expectPage(page, 2);
  await expect(page.getByRole('status')).toHaveCount(0);
});

for (const interruption of ['pointercancel', 'capture-loss', 'blur', 'hidden'] as const) {
  test(`${interruption} 이후 페이지 드래그를 취소하고 다음 입력을 받는다`, async ({ page }) => {
    await openHome(page);
    const pages = page.getByTestId('home-pages');
    const app = page.getByRole('button', { name: '카메라', exact: true });
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
    await page.mouse.move(origin.x - 100, origin.y, { steps: 5 });
    const pointerId = Number(await pages.getAttribute('data-test-pointer'));
    if (interruption === 'pointercancel') {
      await pages.dispatchEvent('pointercancel', {
        pointerId,
        clientX: origin.x - 100,
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
      // Inject visibility only; this is not evidence of an actual iPhone app switch.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'hidden');
      });
    }
    await page.mouse.up();
    await expectPage(page, 1);
    await expect.poll(async () => (await center(app)).x).toBeCloseTo(origin.x, 1);
    await expect(page.getByRole('status')).toHaveCount(0);
    await swipe(page, 'left');
    await expectPage(page, 2);
  });
}

test('화살표 키와 페이지 버튼으로 이동하고 숨겨진 앱은 포커스 탐색에서 제외한다', async ({
  page,
}) => {
  await openHome(page);
  const pages = page.getByRole('region', { name: '앱 페이지, 좌우 화살표로 이동' });
  await pages.focus();
  await page.keyboard.press('ArrowRight');
  await expectPage(page, 2);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '날씨' })).toBeFocused();
  await pages.focus();
  await page.keyboard.press('ArrowLeft');
  await expectPage(page, 1);
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await expectPage(page, 2);
  await page.getByRole('button', { name: '1페이지로 이동' }).tap();
  await expectPage(page, 1);
});

test('높이 600과 합성 safe area에서 Dock을 보존하고 마지막 앱까지 스크롤한다', async ({ page }) => {
  await openHome(page);
  await page.setViewportSize({ width: 390, height: 600 });
  await page.addStyleTag({
    content:
      ':root { --safe-area-top: 20px; --safe-area-right: 12px; --safe-area-bottom: 34px; --safe-area-left: 12px; }',
  });
  const pages = page.getByTestId('home-pages');
  const dock = page.getByRole('navigation', { name: 'Dock' });
  const dockBounds = (await dock.boundingBox())!;
  expect(dockBounds.x).toBeGreaterThanOrEqual(12);
  expect(dockBounds.x + dockBounds.width).toBeLessThanOrEqual(390 - 12);
  expect(dockBounds.y + dockBounds.height).toBeLessThanOrEqual(600 - 34);
  expect(await pages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const settings = page.getByRole('button', { name: '설정', exact: true });
  await settings.scrollIntoViewIfNeeded();
  const settingsBounds = (await settings.boundingBox())!;
  const pagesBounds = (await pages.boundingBox())!;
  expect(settingsBounds.y).toBeGreaterThanOrEqual(pagesBounds.y - 1);
  expect(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(
    pagesBounds.y + pagesBounds.height + 1,
  );
  await settings.tap();
  await expect(page.getByRole('status')).toHaveText('설정 앱은 곧 만나요');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: '앱 안내 닫기' }).tap();
  await page.screenshot({ path: test.info().outputPath('home-short.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectInsideViewport(dock.getByRole('button'), 390, 844 - 34);
});

test('reduced motion에서도 페이지 이동과 앱 눌림이 완료된다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  await swipe(page, 'left');
  await expectPage(page, 2);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const app = page.getByRole('button', { name: '날씨', exact: true });
  await app.tap();
  await expect(page.getByRole('status')).toHaveText('날씨 앱은 곧 만나요');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('세로 스크롤은 페이지를 유지하며 다른 페이지에서 돌아오면 처음부터 보인다', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openHome(page);
  const pages = page.getByTestId('home-pages');
  const region = (await pages.boundingBox())!;
  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    const x = region.x + region.width * 0.5;
    const startY = region.y + region.height * 0.85;
    const endY = region.y + region.height * 0.2;
    const point = (y: number) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 });
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point(startY)],
      });
      for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [point(startY + ((endY - startY) * step) / 8)],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else {
    // Mobile WebKit exposes neither CDP touch-drag nor wheel; check scroll policy and container.
    await expect(pages).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    await pages.evaluate((element) => element.scrollBy(0, 350));
  }
  await expect.poll(async () => pages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expectPage(page, 1);
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: '2페이지로 이동' }).tap();
  await expectPage(page, 2);
  await page.getByRole('button', { name: '1페이지로 이동' }).tap();
  await expectPage(page, 1);
  await expect.poll(async () => pages.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByRole('button', { name: '사진 위젯' })).toBeInViewport();
});

test('글자 200%에서도 달력의 요일·날짜·일정 안내가 서로 겹치거나 잘리지 않는다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openHome(page);
  await page.addStyleTag({ content: ':root { font-size: 200%; }' });
  const calendar = page.locator('.home-calendar-widget');
  await calendar.scrollIntoViewIfNeeded();
  const container = (await calendar.boundingBox())!;
  let previousBottom = container.y;
  for (const text of ['금요일', '23', '오늘은 일정이 없어요']) {
    const content = (await calendar.getByText(text, { exact: true }).boundingBox())!;
    expect(content.x).toBeGreaterThanOrEqual(container.x);
    expect(content.x + content.width).toBeLessThanOrEqual(container.x + container.width + 1);
    expect(content.y).toBeGreaterThanOrEqual(previousBottom - 1);
    expect(content.y + content.height).toBeLessThanOrEqual(container.y + container.height + 1);
    previousBottom = content.y + content.height;
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.screenshot({ path: test.info().outputPath('calendar-200.png') });
  const settings = page.getByRole('button', { name: '설정', exact: true });
  await settings.scrollIntoViewIfNeeded();
  await settings.tap();
  await expect(page.getByRole('status')).toHaveText('설정 앱은 곧 만나요');
});

test('브라우저별 실제 입력으로 홈 페이지를 넘긴다: Chromium touch / WebKit pointer', async ({
  page,
  browserName,
}) => {
  await openHome(page);
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
      for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [point(startX + ((endX - startX) * step) / 8)],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else {
    // Desktop WebKit pointer execution is not actual iPhone Safari touch validation.
    await swipe(page, 'left');
  }
  await expectPage(page, 2);
  await expect(page.getByRole('status')).toHaveCount(0);
});
