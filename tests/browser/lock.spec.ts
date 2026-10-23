import { expect, test, type Page } from '@playwright/test';

async function drag(page: Page, x: number, y: number, endX: number, endY: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('위로 충분히 밀면 홈으로 한 번 전환한다', async ({ page }) => {
  await drag(page, 195, 620, 195, 420);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('lock-screen')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '홈 화면', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '다시 잠그기' }).click();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
});

for (const [name, x, y] of [
  ['짧은 이동', 195, 580],
  ['가로 이동', 320, 600],
  ['아래 이동', 195, 700],
] as const) {
  test(`${name}은 잠금을 유지한다`, async ({ page }) => {
    await drag(page, 195, 620, x, y);
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await expect(page.locator('.lock-clock-group')).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)',
    );
  });
}

for (const event of ['pointercancel', 'lostpointercapture']) {
  test(`${event} 후에 잠금으로 복귀하고 다시 해제할 수 있다`, async ({ page }) => {
    await page.mouse.move(195, 620);
    await page.mouse.down();
    await page.mouse.move(195, 480);
    await page
      .getByTestId('lock-screen')
      .dispatchEvent(event, { pointerId: 1, isPrimary: true, pointerType: 'mouse' });
    await page.mouse.up();
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await drag(page, 195, 620, 195, 420);
    await expect(page.getByTestId('home-screen')).toBeVisible();
  });
}

test('키보드 해제와 reduced motion은 애니메이션 완료에 의존하지 않는다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '잠금 해제', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('home-screen')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('바로가기는 실제 기기 권한을 사용하지 않고 안내한다', async ({ page }) => {
  await page.getByRole('button', { name: '손전등 안내' }).click();
  await expect(page.getByRole('status')).toContainText('사용할 수 없어요');
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await page.getByRole('button', { name: '카메라 안내' }).click();
  await expect(page.getByRole('status')).toContainText('준비 중');
});

for (const distance of [40, 180]) {
  test(`해제 안내에서 시작한 ${distance}px 스와이프`, async ({ page }) => {
    const hint = page.getByRole('button', { name: '잠금 해제', exact: true });
    const box = (await hint.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await drag(page, x, y, x, y - distance);
    if (distance < 96) {
      await expect(page.getByTestId('lock-screen')).toBeVisible();
      await hint.focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('home-screen')).toBeVisible();
  });
}

test('안내를 터치 탭해서도 해제한다', async ({ page }) => {
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(page.getByTestId('home-screen')).toBeVisible();
});

test('모바일 입력으로 위로 쓸어올려 해제한다', async ({ page, browserName }) => {
  if (browserName === 'chromium') {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 195, y: 620 }],
    });
    for (let y = 600; y >= 420; y -= 20)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 195, y }],
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  } else {
    // Desktop WebKit has no CDP touch-drag API; pointer input checks the same handler.
    await drag(page, 195, 620, 195, 420);
  }
  await expect(page.getByTestId('home-screen')).toBeVisible();
});
