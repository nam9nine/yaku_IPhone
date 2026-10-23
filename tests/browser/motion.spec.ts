import { expect, test, type Page } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';

async function open(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await launchHomeApp(page, 'settings');
  await page.evaluate(async () =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );
}
async function start(page: Page) {
  const box = (await page.getByTestId('settings-home-gesture').boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}
async function frame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const height of [800, 844, 932]) {
  test(`천천히 중간까지 올리면 카드가 보이고 계속 끝까지 올리면 더 작아져 홈으로 간다 ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: height === 800 ? 360 : height === 844 ? 390 : 430,
      height,
    });
    await open(page);
    const { x, y } = await start(page);
    const app = page.getByTestId('settings-app');
    const full = (await app.boundingBox())!;
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(x, y - (height * 0.4 * step) / 6);
      await page.waitForTimeout(45);
    }
    await frame(page);
    const middle = (await app.boundingBox())!;
    expect(middle.width).toBeLessThan(full.width * 0.65);
    await expect(page.locator('.gesture-stage')).toBeVisible();
    await expect(page.getByTestId('system-switcher')).toHaveCount(0);
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(x, y - height * (0.4 + (0.4 * step) / 6));
      await page.waitForTimeout(45);
    }
    await frame(page);
    expect((await app.boundingBox())!.width).toBeLessThan(middle.width * 0.5);
    await page.waitForTimeout(170);
    await page.mouse.up();
    await expect(app).toBeHidden();
    await expect(page.getByTestId('system-switcher')).toHaveCount(0);
    await expect(page.locator('[data-launch-app=settings]')).toBeFocused();
  });
}

test('멈추지 않고 느리게 올린 중간 release는 최근 앱, 짧은 드래그는 원래 크기로 복귀한다', async ({
  page,
}) => {
  await open(page);
  let point = await start(page);
  await page.mouse.move(point.x, point.y - 45, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('settings-app')).toHaveAttribute('data-dragging', 'false');
  await frame(page);
  await page.getByTestId('settings-home-gesture').click({ trial: true });
  point = await start(page);
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(point.x, point.y - 16 * step);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await expect(page.getByTestId('system-switcher')).toBeVisible();
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByTestId('settings-app')).toBeVisible();
});

test('release 모션이 현재 크기에서 홈까지 이어지고 전체 크기로 튀지 않는다', async ({ page }) => {
  await open(page);
  const { x, y } = await start(page);
  await page.mouse.move(x, y - 170, { steps: 3 });
  await frame(page);
  const before = (await page.getByTestId('settings-app').boundingBox())!;
  expect(before.width).toBeLessThan(390 * 0.9);
  const widths = await page.getByTestId('settings-home-gesture').evaluate(
    (surface, point) => {
      const app = surface.closest<HTMLElement>('[data-app-window]')!;
      const originalAnimate = app.animate;
      const widths: number[] = [];
      app.animate = function (...args: Parameters<Element['animate']>) {
        app.animate = originalAnimate;
        const animation = originalAnimate.apply(this, args);
        const duration = Number(animation.effect!.getComputedTiming().duration);
        animation.pause();
        // Inspect the browser's actual animation geometry, without waiting for a
        // particular number of compositor frames on a shared CI runner.
        for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
          animation.currentTime = duration * progress;
          widths.push(app.getBoundingClientRect().width);
        }
        animation.currentTime = 0;
        animation.play();
        return animation;
      };
      // Measurement round trips must not turn the final flick into a 140ms hold.
      // Native fast/slow input classification is covered by the other gesture tests.
      const init = {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        clientX: point.x,
        clientY: point.y - 200,
      };
      surface.dispatchEvent(new PointerEvent('pointermove', { ...init, buttons: 1 }));
      surface.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      app.animate = originalAnimate;
      return widths;
    },
    { x, y },
  );
  await page.mouse.up();
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await expect(page.locator('[data-launch-app=settings]')).toBeFocused();
  expect(widths).toHaveLength(6);
  expect(Math.abs(widths[0] - before.width)).toBeLessThanOrEqual(2);
  expect(Math.max(...widths)).toBeLessThanOrEqual(before.width + 2);
  for (let index = 1; index < widths.length; index++) {
    expect(widths[index]).toBeLessThanOrEqual(widths[index - 1] + 2);
  }
  expect(widths.at(-1)).toBeLessThan(before.width * 0.5);
});

test('최근 앱 미리보기가 실제 읽던 스크롤 위치를 유지한다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 430 });
  await open(page);
  await page.locator('.settings-content').evaluate((element) => {
    element.scrollTop = 180;
  });
  const offset = await page.locator('.settings-content').evaluate((element) => element.scrollTop);
  expect(offset).toBeGreaterThan(0);
  await page.keyboard.press('Alt+a');
  const preview = page.locator('[data-recent-app=settings] .settings-content');
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((element) => element.scrollTop)).toBe(offset);
});

test('최근 앱으로 전환해도 제목의 정렬과 글꼴이 바뀌지 않는다', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await launchHomeApp(page, 'messages');
  const original = await page.locator('[data-app-window=messages] h1').evaluate((element) => {
    const style = getComputedStyle(element);
    return { align: style.textAlign, font: style.font, spacing: style.letterSpacing };
  });
  await page.keyboard.press('Alt+a');
  const preview = await page
    .locator('[data-recent-app=messages] .recent-snapshot h1')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { align: style.textAlign, font: style.font, spacing: style.letterSpacing };
    });
  expect(preview).toEqual(original);
});

test('하단을 누르고 대기한 뒤 빠르게 올리면 대기 시간을 느린 이동으로 오인하지 않는다', async ({
  page,
}) => {
  await open(page);
  const { x, y } = await start(page);
  await page.waitForTimeout(400);
  await page.mouse.move(x, y - 140);
  await page.mouse.up();
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
});
