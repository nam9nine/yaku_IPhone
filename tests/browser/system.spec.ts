import { unlockPhone } from '../helpers/unlock';
import { expect, test, type Page, type Locator } from '../helpers/browser-test';
import { releaseFastSwipe } from '../helpers/gestureClock';
async function ready(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
}
async function drag(page: Page, locator: Locator, dx: number, dy: number, pause = 0, steps = 8) {
  const r = (await locator.boundingBox())!;
  const x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (pause === 0 && steps === 1) {
    await releaseFastSwipe(page, x + dx, y + dy);
    return;
  }
  await page.mouse.move(x + dx, y + dy, { steps });
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
  await expect(page.getByRole('button', { name: '하루카의 메시지 알림 열기' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('system-notifications')).toHaveCount(0);
});

test('화면 하단을 빠르게 올리면 홈, 멈춘 뒤 놓으면 최근 앱이 열리고 상태를 유지한다', async ({
  page,
}) => {
  await page.clock.install();
  await ready(page);
  await open(page, 'settings');
  await page.locator('[data-settings-page=wifi]').tap();
  // Keep the trusted fast release at 16ms even when the CI protocol is delayed.
  await drag(page, page.getByTestId('settings-home-gesture'), 0, -140, 0, 1);
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await open(page, 'settings');
  await recent(page);
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await open(page, 'safari');
  await page.getByRole('button', { name: '휴대폰 사용법', exact: true }).tap();
  await recent(page);
  await drag(page, page.getByRole('button', { name: 'Safari 앱으로 전환', exact: true }), 110, 0);
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
});

test('하단 좌우는 최근 앱을 왕복하고 카드 위로 닫기는 해당 앱 세션만 초기화한다', async ({
  page,
}) => {
  await ready(page);
  await open(page, 'settings');
  await page.locator('[data-settings-page=wifi]').tap();
  await page.keyboard.press('Alt+Home');
  await open(page, 'safari');
  await page.getByRole('button', { name: '휴대폰 사용법', exact: true }).tap();
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
  await page.keyboard.press('Alt+Home');
  await open(page, 'safari');
  await expect(page.getByRole('button', { name: '휴대폰 사용법', exact: true })).toBeVisible();
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
  [360, 320, 200],
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
    for (let i = 0; i < 3; i++) {
      const numbered = panel.getByRole('button', { name: `제어 센터 ${i + 1}페이지`, exact: true });
      if (await numbered.count()) await numbered.tap();
      else if (i > 0) break;
      for (const control of await panel
        .locator(
          '.cc-page:not([inert]) button:not([disabled]),.cc-page:not([inert]) input,.cc-grid--all button:not([disabled]),.cc-grid--all input',
        )
        .all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(height - 30);
        seen.add((await control.getAttribute('aria-label'))!);
      }
      const display = panel.getByRole('button', { name: '디스플레이 설정', exact: true });
      if (await display.isVisible()) {
        await display.tap();
        const dark = panel.getByRole('switch', { name: '다크 모드', exact: true });
        await expect(dark).toBeInViewport();
        await dark.click();
        await expect(dark).toBeChecked();
        await panel.getByRole('button', { name: '제어 상세 닫기', exact: true }).tap();
      }
    }
    for (const label of ['에어플레인 모드', 'Wi-Fi', '셀룰러 데이터', 'Bluetooth', '화면 밝기'])
      expect(seen.has(label)).toBe(true);
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
    const results = search.locator('.system-search-results');
    await search.getByRole('textbox').focus();
    // Short screens use a horizontal result strip. Keyboard focus must reveal
    // every app even as the catalog grows beyond the initially visible items.
    const apps = await results.getByRole('button').all();
    for (const item of apps) {
      await page.keyboard.press('Tab');
      await expect(item).toBeFocused();
      await expect(item).toBeInViewport({ ratio: 1 });
    }
    if (height <= 480) expect(await results.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('system-search-keyboard-end.png') });
    for (const item of apps.slice(0, -1).reverse()) {
      await page.keyboard.press('Shift+Tab');
      await expect(item).toBeFocused();
      await expect(item).toBeInViewport({ ratio: 1 });
    }
    if (height <= 480) expect(await results.evaluate((el) => el.scrollLeft)).toBeLessThanOrEqual(3);
    expect(await results.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await search.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
    for (const [name, app] of [
      ['설정', 'settings-app'],
      ['Safari', 'safari-app'],
    ]) {
      await search.getByRole('textbox').fill(name);
      await expect(results.getByRole('button')).toHaveCount(1);
      await expect(results.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Enter');
      await expect(page.getByTestId(app)).toBeVisible();
      await expect(search).toHaveCount(0);
      await page.keyboard.press('Alt+Home');
      await page.keyboard.press('Alt+s');
    }
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
  await page.keyboard.press('Alt+Home');
  await page.keyboard.press('Alt+c');
  await expect(page.getByTestId('system-control')).toBeVisible();
  await page.waitForTimeout(360);
  await expect(page.getByTestId('system-control')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('system-control')).toHaveCount(0);
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('settings-app')).toBeHidden();
});

for (const screen of ['lock', 'home'] as const) {
  test(`${screen} 드래그 중 시스템 화면을 열면 뒤의 입력을 취소한다`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    if (screen === 'home') await unlockPhone(page);
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

test('최근 앱의 카드 바깥 탭과 하단 영역 상승은 홈으로 돌아간다', async ({ page }) => {
  await ready(page);
  await open(page, 'settings');
  await recent(page);
  await page.getByTestId('system-switcher').click({ position: { x: 20, y: 50 } });
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await recent(page);
  await drag(page, page.getByTestId('system-dismiss-gesture'), 0, -130);
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await recent(page);
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByTestId('settings-app')).toBeVisible();
});

for (const kind of ['control', 'switcher'] as const) {
  test(`${kind} 하단을 조금 벗어나 놓은 뒤 다음 제스처도 즉시 동작한다`, async ({ page }) => {
    await ready(page);
    await open(page, 'settings');
    await page.keyboard.press(kind === 'control' ? 'Alt+c' : 'Alt+a');
    const handle = page.getByTestId('system-dismiss-gesture');
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 6);
    await page.mouse.up();
    await expect(page.getByTestId(`system-${kind}`)).toBeVisible();
    await drag(page, handle, 0, -130);
    await expect(page.getByTestId(`system-${kind}`)).toHaveCount(0);
    await expect(page.getByTestId('settings-app'))[
      kind === 'control' ? 'toBeVisible' : 'toBeHidden'
    ]();
  });
}

test('제어 상세의 Escape는 제어 센터로 복귀하고 세로 밝기 입력은 패널을 닫지 않는다', async ({
  page,
}) => {
  await ready(page);
  await page.keyboard.press('Alt+c');
  const panel = page.getByTestId('system-control');
  const brightness = panel.getByRole('slider', { name: '화면 밝기', exact: true });
  await brightness.focus();
  await page.keyboard.press('ArrowDown');
  await expect(brightness).toHaveValue('99');
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: '디스플레이 설정', exact: true }).tap();
  await expect(panel.getByRole('region', { name: '제어 상세' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('region', { name: '제어 상세' })).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: '디스플레이 설정', exact: true })).toBeFocused();
});

test('제어 센터를 다시 열어도 음량과 회전·무음 표시가 유지된다', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Alt+c');
  const volume = page.getByRole('slider', { name: '음량' });
  await volume.focus();
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: '화면 회전 잠금', exact: true }).tap();
  await page.getByRole('button', { name: '무음 모드', exact: true }).tap();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+c');
  await expect(volume).toHaveValue('51');
  await expect(page.getByRole('button', { name: '화면 회전 잠금', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '무음 모드', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('최근 앱에서 키보드로 선택한 뒤쪽 카드와 닫기 조작이 앞으로 드러난다', async ({ page }) => {
  await ready(page);
  await open(page, 'settings');
  await page.keyboard.press('Alt+Home');
  await open(page, 'safari');
  await page.keyboard.press('Alt+a');
  const closeSettings = page.getByRole('button', { name: '설정 앱 닫기', exact: true });
  for (
    let i = 0;
    i < 8 && !(await closeSettings.evaluate((el) => el === document.activeElement));
    i++
  )
    await page.keyboard.press('Tab');
  await expect(closeSettings).toBeFocused();
  await expect(closeSettings.locator('..').locator('..')).toHaveAttribute('data-active', 'true');
  await expect
    .poll(() =>
      closeSettings.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    )
    .toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Safari 앱으로 전환', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('safari-app')).toBeVisible();
});

test('보이는 뒤쪽 카드를 누르는 도중 카드 위치가 바뀌지 않고 해당 앱을 연다', async ({ page }) => {
  await ready(page);
  await open(page, 'settings');
  await page.locator('[data-settings-page=wifi]').tap();
  await page.keyboard.press('Alt+Home');
  await open(page, 'safari');
  await page.keyboard.press('Alt+a');
  const card = page.getByRole('button', { name: '설정 앱으로 전환', exact: true });
  const before = (await card.boundingBox())!;
  const x = 20,
    y = before.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  expect((await card.boundingBox())!.x).toBe(before.x);
  await page.mouse.up();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
});

test('키보드로 드러낸 보조 버튼을 마우스로 누르는 동안 표시와 동작을 유지한다', async ({
  page,
}) => {
  await ready(page);
  await open(page, 'settings');
  await page.keyboard.press('Alt+Home');
  await open(page, 'safari');
  await page.keyboard.press('Alt+a');
  const next = page.getByRole('button', { name: '다음 최근 앱 페이지', exact: true });
  await page.keyboard.press('Tab');
  await next.focus();
  const box = (await next.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(next).toHaveCSS('clip-path', 'none');
  expect((await next.boundingBox())!.width).toBeGreaterThan(44);
  await page.mouse.up();
  await expect(page.getByTestId('system-switcher')).toBeVisible();
  await expect(page.locator('[data-recent-app=settings]')).toHaveAttribute('data-active', 'true');
});

test('빈 최근 앱은 잠깐 흐려졌다 홈으로 돌아오고 이전 타이머는 다른 패널을 닫지 않는다', async ({
  page,
}) => {
  await ready(page);
  await page.clock.install();
  await page.keyboard.press('Alt+a');
  const panel = page.getByTestId('system-switcher');
  await expect(panel).toHaveAttribute('data-empty-switcher', 'true');
  await page.clock.runFor(300);
  await expect(panel).toBeVisible();
  await page.clock.runFor(450);
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.keyboard.press('Alt+a');
  await page.clock.runFor(100);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+c');
  await page.clock.runFor(800);
  await expect(page.getByTestId('system-control')).toBeVisible();
});

test('마지막 앱을 닫으면 홈으로 복귀하고 카드가 있으면 최근 앱을 유지한다', async ({ page }) => {
  await ready(page);
  await open(page, 'settings');
  await page.clock.install();
  await page.keyboard.press('Alt+a');
  await page.clock.runFor(1000);
  await expect(page.getByTestId('system-switcher')).toBeVisible();
  const close = page.getByRole('button', { name: '설정 앱 닫기', exact: true });
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('system-switcher')).toHaveAttribute('data-empty-switcher', 'true');
  await page.clock.runFor(750);
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
});

test('제어 센터 빈 공간은 닫고 연결 버튼과 밝기 입력은 유지한다', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Alt+c');
  const panel = page.getByTestId('system-control');
  await panel.getByRole('switch', { name: 'Wi-Fi', exact: true }).tap();
  await expect(panel).toBeVisible();
  await panel.getByRole('slider', { name: '화면 밝기', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(panel).toBeVisible();
  const rect = (await page.locator('.cc-pages').boundingBox())!;
  await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height - 12);
  await expect(panel).toHaveCount(0);
});
