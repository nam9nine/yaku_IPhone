import { expect, test, type Page } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';
import { tapPaged, checkPaged, revealPagedControl } from '../helpers/paged-content';

async function finishMotion(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
  });
}

async function launchSettings(page: Page) {
  await launchHomeApp(page, 'settings');
  await expect(page.getByTestId('settings-app')).toBeVisible();
  await finishMotion(page);
}

async function openSettings(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await tapPaged(page.getByRole('button', { name: '잠금 해제', exact: true }));
  await launchSettings(page);
}

async function backToList(page: Page) {
  await tapPaged(page.getByRole('button', { name: '설정 목록으로 돌아가기' }));
}

test('연결 토글은 에어플레인 규칙을 따르고 새로고침 후 잠금 화면에서 복원된다', async ({
  page,
}) => {
  await openSettings(page);
  await tapPaged(page.getByRole('button', { name: 'Bluetooth 켬', exact: true }));
  await page.getByRole('switch', { name: 'Bluetooth', exact: true }).uncheck();
  await backToList(page);
  await tapPaged(page.getByRole('button', { name: '셀룰러 켬', exact: true }));
  await page.getByRole('switch', { name: '셀룰러 데이터' }).uncheck();
  await backToList(page);

  const airplane = page.getByRole('switch', { name: '에어플레인 모드' });
  await airplane.check();
  await expect(page.getByRole('button', { name: 'Wi-Fi 끔', exact: true })).toBeVisible();
  await airplane.uncheck();
  // Leaving airplane mode must not turn an intentionally disabled cellular preference on.
  await tapPaged(page.getByRole('button', { name: '셀룰러 끔', exact: true }));
  await expect(page.getByRole('switch', { name: '셀룰러 데이터' })).not.toBeChecked();
  await page.getByRole('switch', { name: '셀룰러 데이터' }).check();
  await backToList(page);
  await airplane.check();
  await tapPaged(page.getByRole('button', { name: '셀룰러 끔', exact: true }));
  await expect(page.getByRole('switch', { name: '셀룰러 데이터' })).toBeDisabled();
  await backToList(page);
  await tapPaged(page.getByRole('button', { name: 'Wi-Fi 끔', exact: true }));
  await page.getByRole('switch', { name: 'Wi-Fi', exact: true }).check();
  await backToList(page);
  await expect(airplane).toBeChecked();
  await expect(page.getByRole('button', { name: 'Wi-Fi 켬', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toHaveCount(0);
  await tapPaged(page.getByRole('button', { name: '잠금 해제', exact: true }));
  await launchSettings(page);
  await expect(airplane).toBeChecked();
  await expect(page.getByRole('button', { name: 'Wi-Fi 켬', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bluetooth 끔', exact: true })).toBeVisible();
  await airplane.uncheck();
  await expect(page.getByRole('button', { name: '셀룰러 켬', exact: true })).toBeVisible();
});

test('저장이 거부되어도 현재 세션의 설정 조작과 앱 재진입은 유지된다', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage quota unavailable', 'QuotaExceededError');
    };
  });
  await openSettings(page);
  await page.getByRole('switch', { name: '에어플레인 모드' }).check();
  await tapPaged(page.getByRole('button', { name: '홈으로 돌아가기' }));
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await launchSettings(page);
  await expect(page.getByRole('switch', { name: '에어플레인 모드' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Wi-Fi 끔', exact: true })).toBeVisible();
});

test('손상된 저장값은 유효한 기본 설정으로 복구된다', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('yaku-iphone.preferences.v1', '{broken');
  });
  await openSettings(page);
  await expect(page.getByRole('switch', { name: '에어플레인 모드' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Wi-Fi 켬', exact: true })).toBeVisible();
  await tapPaged(page.getByRole('button', { name: '디스플레이 및 밝기', exact: true }));
  await expect(page.getByRole('slider', { name: '화면 밝기' })).toHaveValue('100');
});

test('설정 상세 화면과 가로 페이지를 유지하고 목록 복귀 시 실행 행에 포커스를 돌린다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 500 });
  await openSettings(page);
  await tapPaged(page.getByRole('button', { name: '화면 모드', exact: true }));
  await expect(page.getByRole('heading', { name: '화면 모드', exact: true })).toBeFocused();
  const content = page.getByTestId('settings-content');
  await revealPagedControl(page.getByRole('radio', { name: '더 크게 130%' }).locator('..'));
  const position = await content.getAttribute('data-page');
  expect(Number(position)).toBeGreaterThan(1);
  await tapPaged(page.getByRole('button', { name: '홈으로 돌아가기' }));
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await launchSettings(page);
  await expect(page.getByRole('heading', { name: '화면 모드', exact: true })).toBeFocused();
  await expect(content).toHaveAttribute('data-page', position!);
  await expect(content).toHaveJSProperty('scrollTop', 0);
  await backToList(page);
  await expect(page.getByRole('button', { name: '화면 모드', exact: true })).toBeFocused();
});

test('화면 모드·텍스트 크기는 전역 화면에 적용되고 자동 모드는 기기 설정을 따른다', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openSettings(page);
  const shell = page.locator('.mobile-shell');
  const app = page.getByTestId('settings-app');
  await expect(shell).toHaveAttribute('data-theme', 'light');
  const lightColor = await app.evaluate((element) => getComputedStyle(element).backgroundColor);
  await tapPaged(page.getByRole('button', { name: '화면 모드', exact: true }));
  await checkPaged(page.getByRole('radio', { name: '다크 모드', exact: true }));
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() => app.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(lightColor);
  await checkPaged(page.getByRole('radio', { name: '라이트 모드', exact: true }));
  await expect(shell).toHaveAttribute('data-theme', 'light');
  await expect(app).toHaveCSS('background-color', lightColor);
  await checkPaged(page.getByRole('radio', { name: '자동', exact: true }));
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(shell).toHaveAttribute('data-theme', 'light');

  const heading = page.getByRole('heading', { name: '화면 모드', exact: true });
  const beforeSize = await heading.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  await checkPaged(page.getByRole('radio', { name: '더 크게 130%' }));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.fontSize))
    .toBe('130%');
  expect(
    await heading.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThan(beforeSize * 1.2);
  await checkPaged(page.getByRole('radio', { name: '기본 100%' }));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.fontSize))
    .toBe('100%');
});

test('선택한 배경은 홈과 잠금 화면에 적용되고 밝기 조절은 다시 원래 밝기로 복구된다', async ({
  page,
}) => {
  await openSettings(page);
  const shell = page.locator('.mobile-shell');
  await tapPaged(page.getByRole('button', { name: '디스플레이 및 밝기', exact: true }));
  const slider = page.getByRole('slider', { name: '화면 밝기' });
  const overlay = page.getByTestId('brightness-overlay');
  await slider.fill('50');
  await expect
    .poll(() => overlay.evaluate((element) => Number(getComputedStyle(element).opacity)))
    .toBeGreaterThan(0);
  const opacityAt50 = await overlay.evaluate((element) =>
    Number(getComputedStyle(element).opacity),
  );
  expect(opacityAt50).toBeGreaterThan(0);
  await slider.fill('75');
  await expect
    .poll(() => overlay.evaluate((element) => Number(getComputedStyle(element).opacity)))
    .toBeLessThan(opacityAt50);
  await slider.fill('100');
  await expect(overlay).toHaveCSS('opacity', '0');
  await backToList(page);
  await tapPaged(page.getByRole('button', { name: '배경화면', exact: true }));
  await checkPaged(page.getByRole('radio', { name: '슬레이트', exact: true }));
  await expect(shell).toHaveAttribute('data-wallpaper', 'solid');
  await tapPaged(page.getByRole('button', { name: '홈으로 돌아가기' }));
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await expect(page.locator('.mobile-shell-wallpaper img')).toBeHidden();
  const surfaceColors = await page
    .locator('.mobile-shell, .mobile-shell-wallpaper')
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(surfaceColors).toContain('rgb(51, 65, 85)');
  await tapPaged(page.getByRole('button', { name: '다시 잠그기' }));
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(shell).toHaveAttribute('data-wallpaper', 'solid');
  await expect(page.locator('.mobile-shell-foreground')).toBeHidden();
  await tapPaged(page.getByRole('button', { name: '잠금 해제', exact: true }));
  await launchSettings(page);
  await checkPaged(page.getByRole('radio', { name: '기본', exact: true }));
  await expect(shell).toHaveAttribute('data-wallpaper', 'default');
  await tapPaged(page.getByRole('button', { name: '홈으로 돌아가기' }));
  await expect(page.locator('.mobile-shell-wallpaper img')).toBeVisible();
});

test('동작 줄이기를 전역에 적용하며 기기의 reduced motion을 끌 수 없다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSettings(page);
  await tapPaged(page.getByRole('button', { name: '손쉬운 사용', exact: true }));
  const control = page.getByRole('switch', { name: '동작 줄이기' });
  const shell = page.locator('.mobile-shell');
  await control.check();
  await expect(shell).toHaveAttribute('data-reduced-motion', 'true');
  await expect
    .poll(() =>
      shell.evaluate((element) =>
        parseFloat(getComputedStyle(element).getPropertyValue('--motion-settle')),
      ),
    )
    .toBe(0);
  await tapPaged(page.getByRole('button', { name: '홈으로 돌아가기' }));
  await launchSettings(page);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === 'running').length,
    ),
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await control.uncheck();
  await expect(control).not.toBeChecked();
  await expect(shell).toHaveAttribute('data-reduced-motion', 'true');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(shell).toHaveAttribute('data-reduced-motion', 'false');
});

test('밝기 슬라이더와 본문 드래그는 홈 복귀 제스처로 처리하지 않는다', async ({ page }) => {
  await openSettings(page);
  await tapPaged(page.getByRole('button', { name: '디스플레이 및 밝기', exact: true }));
  const slider = page.getByRole('slider', { name: '화면 밝기' });
  await slider.fill('50');
  const bounds = (await slider.boundingBox())!;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 8, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, y, { steps: 8 });
  await page.mouse.up();
  expect(Number(await slider.inputValue())).toBeGreaterThan(50);
  const app = page.getByTestId('settings-app');
  await expect(app).toBeVisible();
  await expect(app).toHaveAttribute('data-dragging', 'false');
  const content = (await page.getByTestId('settings-content').boundingBox())!;
  const x = content.x + content.width / 2;
  await page.mouse.move(x, content.y + content.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(x, content.y + content.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(app).toBeVisible();
  await expect(app).toHaveAttribute('data-dragging', 'false');
  await tapPaged(page.getByRole('button', { name: '홈으로 돌아가기' }));
  await expect(app).toBeHidden();
});

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`설정 목록과 하단 홈 제어를 잘림 없이 사용한다 ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openSettings(page);
    const app = (await page.getByTestId('settings-app').boundingBox())!;
    expect(app.x).toBe(0);
    expect(app.y).toBe(0);
    expect(app.width).toBe(size.width);
    expect(app.height).toBe(size.height);
    const content = (await page.getByTestId('settings-content').boundingBox())!;
    for (const control of await page.locator('.settings-content .settings-row').all()) {
      await revealPagedControl(control);
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y).toBeGreaterThanOrEqual(content.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(content.y + content.height + 1);
    }
    const home = (await page.getByRole('button', { name: '홈으로 돌아가기' }).boundingBox())!;
    expect(home.width).toBeGreaterThanOrEqual(44);
    expect(home.height).toBeGreaterThanOrEqual(44);
    expect(home.y + home.height).toBeLessThanOrEqual(size.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('Tab·Space·Enter로 연결을 바꾸고 상세 화면에서 돌아올 수 있다', async ({ page }) => {
  await openSettings(page);
  await page.keyboard.press('Tab');
  const airplane = page.getByRole('switch', { name: '에어플레인 모드' });
  await expect(airplane).toBeFocused();
  await page.keyboard.press('Space');
  await expect(airplane).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Wi-Fi 끔', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('switch', { name: 'Wi-Fi', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('switch', { name: 'Wi-Fi', exact: true })).toBeChecked();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '설정 목록으로 돌아가기' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Wi-Fi 켬', exact: true })).toBeFocused();
});
