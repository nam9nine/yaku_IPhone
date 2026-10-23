import { expect, test, type Page, type Locator } from '@playwright/test';
async function ready(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
}
async function drag(page: Page, locator: Locator, dx: number, dy: number, pause = 0) {
  const r = (await locator.boundingBox())!;
  const x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  if (pause) await page.waitForTimeout(pause);
  await page.mouse.up();
}
async function open(page: Page, app: 'settings' | 'safari') {
  await page.locator(`[data-launch-app=${app}]`).tap();
  await expect(page.getByTestId(`${app}-app`)).toBeVisible();
}
async function recent(page: Page) {
  const active = page.locator('.app-host:not([hidden]) [data-testid$="home-gesture"]');
  await drag(
    page,
    (await active.count()) ? active : page.getByTestId('home-system-gesture'),
    0,
    -140,
    300,
  );
  await expect(page.getByTestId('system-switcher')).toBeVisible();
}

test('상단의 시작 위치가 제어 센터와 알림 센터를 구분하고 현재 앱을 보존한다', async ({ page }) => {
  await ready(page);
  await open(page, 'settings');
  await drag(page, page.getByTestId('control-edge'), 0, 120);
  const control = page.getByTestId('system-control');
  await expect(control).toBeVisible();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toHaveCount(0);
  await control.getByRole('switch', { name: '에어플레인 모드', exact: true }).click();
  await expect(control.getByRole('switch', { name: 'Wi-Fi', exact: true })).not.toBeChecked();
  await control.getByRole('switch', { name: 'Wi-Fi', exact: true }).click();
  await page.keyboard.press('Alt+Home');
  await expect(control).toBeVisible();
  await drag(page, page.getByTestId('system-dismiss-gesture'), 0, -120);
  await expect(control).toHaveCount(0);
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await expect(page.getByRole('switch', { name: '에어플레인 모드', exact: true })).toBeChecked();
  await drag(page, page.getByTestId('notification-edge'), 0, 120);
  await expect(page.getByText('알림이 없어요')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('system-notifications')).toHaveCount(0);
});

test('짧은 하단 상승은 홈이고 멈춘 상승은 최근 앱이며 재진입 상태가 유지된다', async ({ page }) => {
  await ready(page);
  await open(page, 'settings');
  await page.locator('[data-settings-page=wifi]').tap();
  await drag(page, page.getByTestId('settings-home-gesture'), 0, -140);
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await recent(page);
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '홈으로 돌아가기' }).tap();
  await open(page, 'safari');
  await page.getByRole('button', { name: '시작 안내', exact: true }).tap();
  await recent(page);
  await page.getByRole('button', { name: '다음 최근 앱 페이지' }).tap();
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
});

test('하단 좌우는 최근 앱을 왕복하고 카드 위로 닫기는 해당 앱 세션만 초기화한다', async ({
  page,
}) => {
  await ready(page);
  await open(page, 'settings');
  await page.locator('[data-settings-page=wifi]').tap();
  await page.getByRole('button', { name: '홈으로 돌아가기' }).tap();
  await open(page, 'safari');
  await page.getByRole('button', { name: '시작 안내', exact: true }).tap();
  await drag(page, page.getByTestId('safari-home-gesture'), 100, 0);
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await drag(page, page.getByTestId('settings-home-gesture'), -100, 0);
  await expect(page.getByTestId('safari-app')).toBeVisible();
  await recent(page);
  await drag(page, page.getByRole('button', { name: 'Safari 앱으로 전환', exact: true }), 0, -160);
  await expect(page.getByRole('button', { name: 'Safari 앱으로 전환', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '홈으로 돌아가기' }).tap();
  await open(page, 'safari');
  await expect(page.getByRole('button', { name: '시작 안내', exact: true })).toBeVisible();
});

test('홈 아래 당김 검색은 지원 앱을 열고 입력창은 누르기 전 포커스되지 않는다', async ({
  page,
}) => {
  await ready(page);
  const region = page.getByTestId('home-pages');
  const r = (await region.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + 50);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2, r.y + 180, { steps: 8 });
  await page.mouse.up();
  const search = page.getByTestId('system-search');
  await expect(search).toBeVisible();
  await expect(search.getByRole('textbox', { name: '앱 검색' })).not.toBeFocused();
  await search.getByRole('textbox').fill('Safari');
  await expect(search.getByRole('button', { name: '설정', exact: true })).toHaveCount(0);
  await search.getByRole('button', { name: 'Safari', exact: true }).tap();
  await expect(page.getByTestId('safari-app')).toBeVisible();
});

for (const interrupt of ['pointercancel', 'resize', 'blur', 'second-pointer'] as const) {
  test(`시스템 드래그 ${interrupt} 취소 후에 오래 멈춰도 전환되지 않는다`, async ({ page }) => {
    await ready(page);
    await open(page, 'settings');
    const zone = page.getByTestId('settings-home-gesture');
    const r = (await zone.boundingBox())!;
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 130, { steps: 5 });
    await expect(page.getByTestId('settings-app')).toHaveAttribute('data-dragging', 'true');
    if (interrupt === 'pointercancel')
      await zone.dispatchEvent('pointercancel', { pointerId: 1, clientX: x, clientY: y - 130 });
    if (interrupt === 'resize') await page.setViewportSize({ width: 390, height: 700 });
    if (interrupt === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (interrupt === 'second-pointer')
      await zone.dispatchEvent('pointerdown', { pointerId: 22, isPrimary: false, button: 0 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect(page.getByTestId('settings-app')).toBeVisible();
    await expect(page.getByTestId('system-switcher')).toHaveCount(0);
    await expect(page.getByTestId('settings-app')).toHaveAttribute('data-dragging', 'false');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    await recent(page);
    await expect(page.getByTestId('system-switcher')).toBeVisible();
  });
}

test('시스템 화면은 포커스를 가두며 배경 앱 키보드 조작이 실행되지 않는다', async ({ page }) => {
  await ready(page);
  await open(page, 'safari');
  await page.keyboard.press('Alt+c');
  const dialog = page.getByTestId('system-control');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Alt+Home');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('safari-app')).toBeVisible();
});

test('Chromium 실제 touch와 WebKit pointer로 상단 당김과 멈춘 하단 상승을 구별한다', async ({
  page,
  browserName,
}) => {
  await ready(page);
  await open(page, 'settings');
  if (browserName !== 'chromium') {
    await drag(page, page.getByTestId('control-edge'), 0, 120);
    await page.keyboard.press('Escape');
    await recent(page);
    return;
  }
  const client = await page.context().newCDPSession(page);
  for (const [id, distance, pause] of [
    ['control-edge', 120, 0],
    ['settings-home-gesture', -140, 300],
  ] as const) {
    const r = (await page.getByTestId(id).boundingBox())!;
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + (distance * i) / 8 }],
      });
    if (pause) await page.waitForTimeout(pause);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(
      page.getByTestId(id === 'control-edge' ? 'system-control' : 'system-switcher'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await client.detach();
});

for (const [width, height, font] of [
  [360, 420, 200],
  [360, 500, 130],
  [430, 932, 100],
]) {
  test(`시스템 패널의 큰 글자·짧은 화면에서 세로 스크롤 없이 조작한다 ${width}x${height}/${font}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await ready(page);
    await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), font);
    await page.keyboard.press('Alt+c');
    const panel = page.getByTestId('system-control');
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      for (const control of await panel
        .locator('.system-slide:not([inert]) button,.system-slide:not([inert]) input')
        .all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(height - 40);
        seen.add((await control.getAttribute('aria-label'))!);
      }
      const next = panel.getByRole('button', { name: '다음 제어 센터 페이지' });
      if (!(await next.count()) || (await next.isDisabled())) break;
      await next.tap();
    }
    expect([...seen].sort()).toEqual(
      ['에어플레인 모드', 'Wi-Fi', '셀룰러 데이터', 'Bluetooth', '화면 밝기', '다크 모드'].sort(),
    );
    await panel.evaluate((el) => el.scrollBy(0, 400));
    expect(await panel.evaluate((el) => el.scrollTop)).toBe(0);
    expect(
      await page.evaluate(() => ({
        x: scrollX,
        y: scrollY,
        width: document.documentElement.scrollWidth,
      })),
    ).toEqual({ x: 0, y: 0, width });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+s');
    const search = page.getByTestId('system-search');
    await expect(search.getByRole('textbox')).toBeInViewport();
    for (const item of await search.getByRole('button', { name: /^(설정|Safari)$/ }).all())
      await expect(item).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('system-small.png') });
  });
}

test('홈 닫힘 애니메이션 중 패널을 열어도 오래된 완료가 패널과 앱을 닫지 않는다', async ({
  page,
}) => {
  await ready(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, 'settings');
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished));
  });
  await page.getByRole('button', { name: '홈으로 돌아가기' }).click();
  await page.keyboard.press('Alt+c');
  await expect(page.getByTestId('system-control')).toBeVisible();
  await page.waitForTimeout(360);
  await expect(page.getByTestId('system-control')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await page.getByRole('button', { name: '홈으로 돌아가기' }).tap();
  await expect(page.getByTestId('settings-app')).toBeHidden();
});

for (const screen of ['lock', 'home'] as const) {
  test(`${screen} 드래그 중 시스템 화면을 열면 뒤의 입력을 취소한다`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    if (screen === 'home') await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
    await page.mouse.move(screen === 'lock' ? 200 : 300, screen === 'lock' ? 600 : 350);
    await page.mouse.down();
    await page.mouse.move(screen === 'lock' ? 200 : 190, screen === 'lock' ? 430 : 350, {
      steps: 8,
    });
    await page.keyboard.press('Alt+c');
    await expect(page.getByTestId('system-control')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('system-control')).toBeVisible();
    await page.keyboard.press('Escape');
    if (screen === 'lock') await expect(page.getByTestId('lock-screen')).toBeVisible();
    else await expect(page.getByTestId('home-pages')).toHaveAttribute('data-page', '1');
  });
}
