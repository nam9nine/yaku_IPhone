import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';

async function openApp(page: Page, name: '설정' | 'Safari') {
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await launchHomeApp(page, name === '설정' ? 'settings' : 'safari');
  await expect(page.getByTestId(name === '설정' ? 'settings-app' : 'safari-app')).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
  });
}

const settingsBody = (page: Page) => page.getByTestId('settings-content');
const safariBody = (page: Page) => page.locator('.safari-document:not([hidden]) .paged-content');
const address = (page: Page) =>
  page.getByRole('button', { name: '주소 또는 검색어 입력', exact: true });

async function enterAddress(page: Page, value: string) {
  await address(page).tap();
  await page.getByRole('textbox', { name: '주소 또는 검색어', exact: true }).fill(value);
  await page.getByRole('button', { name: '이동', exact: true }).tap();
}

async function edgeSwipe(page: Page, app: Locator, direction: 'back' | 'forward') {
  const rect = (await app.boundingBox())!;
  const x = direction === 'back' ? rect.x + 20 : rect.x + rect.width - 20;
  const y = rect.y + Math.min(190, rect.height * 0.45);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (direction === 'back' ? 100 : -100), y + 2, { steps: 8 });
  await page.mouse.up();
}

async function revealWithPages(pager: Locator, target: Locator, nextName: string) {
  if (await pager.evaluate((el) => el.classList.contains('settings-content'))) {
    await target.scrollIntoViewIfNeeded();
    return;
  }
  for (let index = 0; index < 40; index += 1) {
    if (
      await target.evaluate((element) => {
        const viewport = element
          .closest('.paged-content')!
          .querySelector('.paged-viewport')!
          .getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= viewport.left - 1 &&
          bounds.right <= viewport.right + 1 &&
          bounds.top >= viewport.top - 1 &&
          bounds.bottom <= viewport.bottom + 1
        );
      })
    )
      return;
    const before = await target.evaluate(
      (element) =>
        element.getBoundingClientRect().right <
        element.closest('.paged-content')!.querySelector('.paged-viewport')!.getBoundingClientRect()
          .right,
    );
    const next = pager.getByRole('button', {
      name: before ? nextName.replace('다음', '이전') : nextName,
      exact: true,
    });
    await expect(next).toBeEnabled();
    await next.tap();
  }
  throw new Error('페이지를 모두 넘겨도 조작 요소가 노출되지 않았습니다.');
}

async function expectNoVerticalClip(pager: Locator) {
  if (await pager.evaluate((el) => el.classList.contains('settings-content'))) {
    await expect(pager).toHaveCSS('overflow-y', 'auto');
    return;
  }
  expect(
    await pager.evaluate((element) => {
      const viewport = element.querySelector('.paged-viewport')!.getBoundingClientRect();
      const flow = element.querySelector('.paged-flow')!;
      const nodes = document.createNodeIterator(flow, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      const clipped: string[] = [];
      while ((node = nodes.nextNode())) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.height && (rect.top < viewport.top - 1 || rect.bottom > viewport.bottom + 1))
            clipped.push(node.textContent);
        }
      }
      return clipped;
    }),
  ).toEqual([]);
}

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 360, height: 420 },
]) {
  test(`설정은 세로로 Safari는 가로로 모든 내용에 도달한다 ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openApp(page, '설정');
    const settings = settingsBody(page);
    await expectNoVerticalClip(settings);
    const accessibility = page.getByRole('button', { name: '손쉬운 사용', exact: true });
    await revealWithPages(settings, accessibility, '설정 내용 다음 페이지');
    await expect(settings).toHaveCSS('overflow-y', 'auto');
    if (size.height === 420)
      expect(await settings.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await accessibility.tap();
    await expect(page.getByRole('heading', { name: '손쉬운 사용', exact: true })).toBeVisible();

    await page.keyboard.press('Alt+Home');
    await page.getByRole('button', { name: 'Safari', exact: true }).tap();
    await enterAddress(page, 'https://yaku.test/guide');
    await expectNoVerticalClip(safariBody(page));
    const link = page.getByRole('button', { name: '주말 산책 읽기', exact: true });
    await revealWithPages(safariBody(page), link, 'Safari 본문 다음 페이지');
    await link.tap();
    await expect(address(page)).toHaveText('yaku.test/example');
    await expectNoVerticalClip(safariBody(page));
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  });
}

test('200% 글자와 짧은 높이에서도 설정 조작과 Safari 마지막 링크에 도달한다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await openApp(page, '설정');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  const appearance = page.getByRole('button', { name: '화면 모드', exact: true });
  await revealWithPages(settingsBody(page), appearance, '설정 내용 다음 페이지');
  await appearance.tap();
  await expectNoVerticalClip(settingsBody(page));
  const larger = page.getByRole('radio', { name: '더 크게 130%', exact: true });
  await revealWithPages(settingsBody(page), larger.locator('..'), '설정 내용 다음 페이지');
  await larger.check();
  await expect(larger).toBeChecked();
  await page.getByRole('button', { name: '설정 목록으로 돌아가기', exact: true }).tap();
  const wallpaper = page.getByRole('button', { name: '배경화면', exact: true });
  await revealWithPages(settingsBody(page), wallpaper, '설정 내용 다음 페이지');
  await wallpaper.tap();
  await expectNoVerticalClip(settingsBody(page));
  const solid = page.getByRole('radio', { name: '슬레이트', exact: true });
  await revealWithPages(settingsBody(page), solid.locator('..'), '설정 내용 다음 페이지');
  await solid.check();
  await expect(solid).toBeChecked();
  await page.keyboard.press('Alt+Home');
  await page.getByRole('button', { name: 'Safari', exact: true }).tap();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await enterAddress(page, 'https://yaku.test/guide');
  await expectNoVerticalClip(safariBody(page));
  const link = page.getByRole('button', { name: '주말 산책 읽기', exact: true });
  await revealWithPages(safariBody(page), link, 'Safari 본문 다음 페이지');
  await link.tap();
  await expect(address(page)).toHaveText('yaku.test/example');
});

test('키보드가 화면 밖 설정으로 이동하면 해당 행으로 세로 스크롤한다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await openApp(page, '설정');
  const target = page.getByRole('button', { name: '손쉬운 사용', exact: true });
  for (let count = 0; count < 30; count += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
  expect(await settingsBody(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(target).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '손쉬운 사용', exact: true })).toBeFocused();
});

test('설정의 버튼과 왼쪽 안쪽 가장자리는 실제 방문 순서에서 한 단계만 돌아간다', async ({
  page,
}) => {
  await openApp(page, '설정');
  await page.getByRole('button', { name: '손쉬운 사용', exact: true }).tap();
  await page.getByRole('button', { name: '텍스트 크기', exact: true }).tap();
  await page.getByRole('button', { name: '손쉬운 사용으로 돌아가기', exact: true }).tap();
  await expect(page.getByRole('heading', { name: '손쉬운 사용', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '텍스트 크기', exact: true }).tap();
  await edgeSwipe(page, page.locator('.settings-app'), 'back');
  await expect(page.getByRole('heading', { name: '손쉬운 사용', exact: true })).toBeVisible();
  await edgeSwipe(page, page.locator('.settings-app'), 'back');
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await edgeSwipe(page, page.locator('.settings-app'), 'back');
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
});

test('Safari 본문 가로 이동과 양쪽 가장자리 방문 기록을 구분하고 재진입 위치를 보존한다', async ({
  page,
}) => {
  await openApp(page, 'Safari');
  await enterAddress(page, 'https://yaku.test/guide');
  await page.getByRole('button', { name: 'Safari 본문 다음 페이지', exact: true }).tap();
  await expect(safariBody(page)).toHaveAttribute('data-page', '2');
  await enterAddress(page, 'https://yaku.test/example');
  await edgeSwipe(page, page.locator('.safari-app'), 'back');
  await expect(address(page)).toHaveText('yaku.test/guide');
  await expect(safariBody(page)).toHaveAttribute('data-page', '2');
  await edgeSwipe(page, page.locator('.safari-app'), 'forward');
  await expect(address(page)).toHaveText('yaku.test/example');
  await edgeSwipe(page, page.locator('.safari-app'), 'back');
  await expect(address(page)).toHaveText('yaku.test/guide');
  await page.keyboard.press('Alt+Home');
  await page.getByRole('button', { name: 'Safari', exact: true }).tap();
  await expect(address(page)).toHaveText('yaku.test/guide');
  await expect(safariBody(page)).toHaveAttribute('data-page', '2');
});

test('Safari 가장자리 뒤로는 메뉴·입력·탭·오류를 먼저 닫고 방문 기록을 유지한다', async ({
  page,
}) => {
  await openApp(page, 'Safari');
  await enterAddress(page, 'https://yaku.test/guide');
  const app = page.locator('.safari-app');
  await page.getByRole('button', { name: '페이지 메뉴', exact: true }).tap();
  await edgeSwipe(page, app, 'back');
  await expect(page.getByRole('dialog', { name: '페이지 메뉴', exact: true })).toHaveCount(0);
  await address(page).tap();
  await edgeSwipe(page, app, 'back');
  await expect(page.getByRole('textbox', { name: '주소 또는 검색어', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '탭 보기, 1개', exact: true }).tap();
  await edgeSwipe(page, app, 'back');
  await expect(page.getByRole('region', { name: '열린 탭', exact: true })).toHaveCount(0);
  await enterAddress(page, 'javascript:alert(1)');
  await edgeSwipe(page, app, 'back');
  await expect(page.getByRole('heading', { name: '주소를 열 수 없습니다' })).toHaveCount(0);
  await expect(address(page)).toHaveText('yaku.test/guide');
});

for (const interruption of [
  'pointercancel',
  'capture-loss',
  'blur',
  'resize',
  'hidden',
  'second-pointer',
] as const) {
  test(`앱 가장자리 pointer ${interruption}는 이동을 취소하고 다음 제스처를 받는다`, async ({
    page,
  }) => {
    await openApp(page, '설정');
    await page.getByRole('button', { name: 'Wi-Fi ASAGAO_HOME', exact: true }).tap();
    const app = page.locator('.settings-app');
    await app.evaluate((element) => {
      window.addEventListener(
        'pointerdown',
        (event) => element.setAttribute('data-pointer-id', String(event.pointerId)),
        { once: true, capture: true },
      );
    });
    const bounds = (await app.boundingBox())!;
    const x = bounds.x + 20,
      y = bounds.y + 190;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 85, y, { steps: 6 });
    const pointerId = Number(await app.getAttribute('data-pointer-id'));
    if (interruption === 'pointercancel')
      await app.dispatchEvent('pointercancel', { pointerId, bubbles: true });
    if (interruption === 'capture-loss')
      await app.evaluate((element, id) => element.releasePointerCapture(id), pointerId);
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (interruption === 'resize') await page.setViewportSize({ width: 389, height: 844 });
    if (interruption === 'hidden')
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'hidden');
      });
    if (interruption === 'second-pointer')
      await app.dispatchEvent('pointerdown', {
        pointerId: pointerId + 100,
        isPrimary: false,
        pointerType: 'touch',
        bubbles: true,
      });
    await page.mouse.up();
    await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
    await edgeSwipe(page, app, 'back');
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  });
}

test('본문의 짧은 가로 드래그는 링크 클릭을 억제하고 다음 탭은 정상 동작한다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await openApp(page, 'Safari');
  const link = page.getByRole('button', { name: '휴대폰 사용법', exact: true });
  await revealWithPages(safariBody(page), link, 'Safari 본문 다음 페이지');
  const before = await safariBody(page).getAttribute('data-page');
  const rect = (await link.boundingBox())!;
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: '시작 페이지', exact: true })).toBeVisible();
  await expect(safariBody(page)).toHaveAttribute('data-page', before!);
  await link.tap();
  await expect(address(page)).toHaveText('yaku.test/guide');
});

test('본문 페이지와 가장자리는 실제 터치에서도 구분하고 세로 드래그는 이동하지 않는다', async ({
  page,
  browserName,
}) => {
  await openApp(page, 'Safari');
  await enterAddress(page, 'https://yaku.test/guide');
  const viewport = (await safariBody(page).locator('.paged-viewport').boundingBox())!;
  const app = (await page.locator('.safari-app').boundingBox())!;
  const session = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  async function drag(x: number, y: number, dx: number, dy: number) {
    if (session) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8 }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      // Desktop WebKit does not expose native touch dispatch. This branch checks pointer handling only.
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      await page.mouse.up();
    }
  }
  const x = viewport.x + viewport.width * 0.7,
    y = viewport.y + viewport.height * 0.55;
  await drag(x, y, 0, -100);
  await expect(safariBody(page)).toHaveAttribute('data-page', '1');
  await expect(safariBody(page)).toHaveJSProperty('scrollTop', 0);
  await drag(x, y, -100, 0);
  await expect(safariBody(page)).toHaveAttribute('data-page', '2');
  await expect(address(page)).toHaveText('yaku.test/guide');
  const link = page.getByRole('button', { name: '주말 산책 읽기', exact: true });
  await revealWithPages(safariBody(page), link, 'Safari 본문 다음 페이지');
  const linkBox = (await link.boundingBox())!;
  await drag(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2, 25, 0);
  await expect(safariBody(page)).toHaveAttribute('data-page', '2');
  await expect(address(page)).toHaveText('yaku.test/guide');
  await drag(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2, 100, 0);
  await expect(safariBody(page)).toHaveAttribute('data-page', '1');
  await expect(address(page)).toHaveText('yaku.test/guide');
  await drag(app.x + 20, app.y + 190, 100, 0);
  await expect(address(page)).toHaveText('검색 또는 웹 사이트 이름');
  await session?.detach();
});

test('선택한 텍스트를 가장자리 제스처가 가로채지 않고 선택 해제 후 다시 동작한다', async ({
  page,
}) => {
  await openApp(page, 'Safari');
  await enterAddress(page, 'https://yaku.test/guide');
  await page.getByRole('heading', { name: /아저씨,/ }).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
  await edgeSwipe(page, page.locator('.safari-app'), 'back');
  await expect(address(page)).toHaveText('yaku.test/guide');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await edgeSwipe(page, page.locator('.safari-app'), 'back');
  await expect(address(page)).toHaveText('검색 또는 웹 사이트 이름');
});

test('작은 높이와 200% 글자에서 Safari 메뉴·탭·오류도 세로 스크롤 없이 조작한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await openApp(page, 'Safari');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await enterAddress(page, 'https://yaku.test/guide');
  await page.getByRole('button', { name: '페이지 메뉴', exact: true }).tap();
  let pager = page.getByRole('region', { name: '페이지 메뉴', exact: true });
  await expectNoVerticalClip(pager);
  const add = page.getByRole('dialog').getByRole('button', { name: '새 탭', exact: true });
  await revealWithPages(pager, add, '페이지 메뉴 다음 페이지');
  await add.tap();
  await enterAddress(page, 'https://yaku.test/example');
  await expect(page.getByTestId('safari-app')).toHaveCSS('width', '360px');
  await page.getByRole('button', { name: '탭 보기, 2개', exact: true }).tap();
  pager = page.getByRole('region', { name: '탭 목록', exact: true });
  await expectNoVerticalClip(pager);
  const select = page.getByRole('button', { name: '주말 산책 탭 선택', exact: true });
  await revealWithPages(pager, select, '탭 목록 다음 페이지');
  await select.tap();
  await enterAddress(page, 'javascript:alert(1)');
  pager = page.getByRole('region', { name: '오류 안내', exact: true });
  await expectNoVerticalClip(pager);
  const close = page.getByRole('button', { name: '닫기', exact: true });
  await revealWithPages(pager, close, '오류 안내 다음 페이지');
  await close.tap();
  await expect(address(page)).toHaveText('yaku.test/example');
});

test('설정의 실제 세로 입력과 가장자리 뒤로는 목록 위치와 홈 고정을 유지한다', async ({
  page,
  browserName,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 500 });
  await openApp(page, '설정');
  const content = settingsBody(page);
  if (browserName === 'chromium') {
    const bounds = (await content.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height * 0.8;
    expect(await content.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(
      await content.evaluate(
        (el, point) => el.contains(document.elementFromPoint(point.x, point.y)),
        { x, y },
      ),
    ).toBe(true);
    const client = await page.context().newCDPSession(page);
    // Native touch events exercise browser scrolling without assigning scrollTop.
    // Send each finger position explicitly instead of the experimental scroll synthesizer.
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 12; step++) {
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 20 }],
      });
    }
    // Hold before lifting so this checks a drag, not platform-dependent inertia.
    for (let frame = 0; frame < 6; frame++)
      await page.evaluate(() => new Promise(requestAnimationFrame));
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
    await testInfo.attach('native-scroll-geometry', {
      body: JSON.stringify(
        await content.evaluate((el) => ({
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          touchAction: getComputedStyle(el).touchAction,
          documentY: window.scrollY,
        })),
      ),
      contentType: 'application/json',
    });
  } else {
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if (
        await page
          .getByRole('button', { name: '손쉬운 사용', exact: true })
          .evaluate((el) => el === document.activeElement)
      )
        break;
    }
  }
  await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // New device/demo rows make the target lower. Its native reveal position is the
  // position to restore when returning from the detail screen.
  await page.getByRole('button', { name: '손쉬운 사용', exact: true }).scrollIntoViewIfNeeded();
  const offset = await content.evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: '손쉬운 사용', exact: true }).tap();
  await edgeSwipe(page, page.locator('.settings-app'), 'back');
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await expect(content).toHaveJSProperty('scrollTop', offset);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('한 단계 뒤로 화면은 손가락을 따라오고 짧은 입력은 원래 위치로 복귀한다', async ({
  page,
}, testInfo) => {
  await openApp(page, '설정');
  const app = page.locator('.settings-app');
  await page.getByRole('button', { name: 'Wi-Fi ASAGAO_HOME', exact: true }).tap();
  const rect = (await app.boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + 190);
  await page.mouse.down();
  await page.mouse.move(rect.x + 62, rect.y + 192, { steps: 6 });
  await expect(app).toHaveAttribute('data-edge-motion', 'dragging');
  expect(
    await app
      .locator(':scope > header')
      .evaluate((el) => parseFloat(getComputedStyle(el).translate)),
  ).toBeCloseTo(42);
  await testInfo.attach('edge-drag-follow', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await expect(app).not.toHaveAttribute('data-edge-motion');
  await expect(app).toHaveCSS('translate', 'none');
  await edgeSwipe(page, app, 'back');
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await expect(app).not.toHaveAttribute('data-edge-motion');
  await edgeSwipe(page, app, 'back');
  await expect(app).not.toHaveAttribute('data-edge-motion');
});

test('뒤로 정착 중 반복 입력은 중복 pop 없이 한 단계만 이동한다', async ({ page }) => {
  await openApp(page, '설정');
  await page.getByRole('button', { name: '손쉬운 사용', exact: true }).tap();
  await page.getByRole('button', { name: '텍스트 크기', exact: true }).tap();
  const app = page.locator('.settings-app');
  await edgeSwipe(page, app, 'back');
  await page.keyboard.press('Escape');
  await app.dispatchEvent('pointerdown', {
    isPrimary: true,
    button: 0,
    pointerId: 99,
    clientX: 20,
    clientY: 190,
  });
  await app.dispatchEvent('pointerup', { pointerId: 99, clientX: 120, clientY: 190 });
  await expect(page.getByRole('heading', { name: '손쉬운 사용', exact: true })).toBeVisible();
  await expect(app).not.toHaveAttribute('data-edge-motion');
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await launchHomeApp(page, 'settings');
  await expect(page.getByRole('heading', { name: '손쉬운 사용', exact: true })).toBeVisible();
});

test('뒤로 정착 중 홈으로 나가면 늦은 탐색 콜백이 재진입 화면을 바꾸지 않는다', async ({
  page,
}) => {
  await openApp(page, '설정');
  await page.getByRole('button', { name: 'Wi-Fi ASAGAO_HOME', exact: true }).tap();
  const app = page.locator('.settings-app');
  await edgeSwipe(page, app, 'back');
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await launchHomeApp(page, 'settings');
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await expect(app).not.toHaveAttribute('data-edge-motion');
});

test('뒤로 정착 중 실제 하단 바를 끝까지 올리면 홈 복귀 후에도 기존 화면을 유지한다', async ({
  page,
}) => {
  await openApp(page, '설정');
  await page.getByRole('button', { name: 'Wi-Fi ASAGAO_HOME', exact: true }).tap();
  const app = page.locator('.settings-app');
  const bar = (await page.getByTestId('settings-home-gesture').boundingBox())!;
  const x = bar.x + bar.width / 2;
  const y = bar.y + bar.height / 2;
  await edgeSwipe(page, app, 'back');
  await expect(app).toHaveAttribute('data-edge-motion', 'leaving');
  await page.mouse.move(x, y);
  await page.mouse.down();
  // This case checks interruption at the real bar, not flick velocity. A full
  // stroke returns Home even if CI protocol delivery pauses between input events.
  await page.mouse.move(x, y * 0.2, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await launchHomeApp(page, 'settings');
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await expect(app).not.toHaveAttribute('data-edge-motion');
});

test('동작 줄이기에서는 화면을 끌지 않으며 뒤로 탐색 결과는 유지한다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, '설정');
  await page.getByRole('button', { name: 'Wi-Fi ASAGAO_HOME', exact: true }).tap();
  const app = page.locator('.settings-app');
  const rect = (await app.boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + 190);
  await page.mouse.down();
  await page.mouse.move(rect.x + 120, rect.y + 190, { steps: 8 });
  await expect(app).toHaveCSS('translate', 'none');
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await expect(app).not.toHaveAttribute('data-edge-motion');
});

for (const interruption of ['resize', 'control'] as const) {
  test(`완료 모션 도중 ${interruption}는 지연된 뒤로 탐색을 취소한다`, async ({ page }) => {
    await openApp(page, '설정');
    await page.getByRole('button', { name: 'Wi-Fi ASAGAO_HOME', exact: true }).tap();
    const app = page.locator('.settings-app');
    await edgeSwipe(page, app, 'back');
    if (interruption === 'resize') {
      await page.setViewportSize({ width: 360, height: 800 });
    } else {
      await page.keyboard.press('Alt+c');
      await expect(page.getByRole('dialog', { name: '제어 센터', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(app).not.toHaveAttribute('data-edge-motion');
    await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
    await edgeSwipe(page, app, 'back');
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  });
}
