import { expect, test, type Page } from '@playwright/test';
import { dragTouchWithoutFling } from '../helpers/touch';
import { launchHomeApp } from '../helpers/home';

async function pull(page: Page, browserName: string, x: number, y: number, distance = 180) {
  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    try {
      await dragTouchWithoutFling(page, session, x, y, distance);
    } finally {
      await session.detach();
    }
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + distance, { steps: 12 });
    await page.mouse.up();
  }
}
async function boot(page: Page, unlock = true) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  if (unlock) await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
}
for (const width of [360, 390, 430]) {
  for (const screen of ['lock', 'home', 'settings'] as const) {
    test(`${screen} 상단의 터치 capture 이전이 제어 센터를 취소하지 않는다 ${width}`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await boot(page, screen !== 'lock');
      if (screen === 'settings') await launchHomeApp(page, 'settings');
      await pull(page, browserName, width * 0.82, 76);
      const panel = page.getByTestId('system-control');
      await expect(panel).toHaveAttribute('data-preview', 'false');
      await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(0, 0);
      await page.mouse.click(20, 750);
      await expect(panel).toHaveCount(0);
      await expect(page.getByTestId('lock-screen')).toHaveCount(screen === 'lock' ? 1 : 0);
      if (screen === 'settings') await expect(page.getByTestId('settings-app')).toBeVisible();
    });
  }
}
test('상태바와 사진 위젯의 터치로 패널을 열고 위젯 탭도 유지한다', async ({
  page,
  browserName,
}) => {
  await boot(page);
  await pull(page, browserName, 322, 18);
  await expect(page.getByTestId('system-control')).toHaveAttribute('data-preview', 'false');
  await page.keyboard.press('Escape');
  const widget = page.getByRole('button', { name: '사진 위젯', exact: true });
  const box = (await widget.boundingBox())!;
  await pull(page, browserName, box.x + 20, Math.max(60, box.y + 10));
  await expect(page.getByTestId('system-notifications')).toHaveAttribute('data-preview', 'false');
  await expect(page.getByTestId('system-search')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  await widget.tap();
  await expect(page.getByTestId('photo-viewer')).toBeVisible();
});
test('헤더 버튼의 탭은 유지하고 하향 드래그와 짧은 취소는 버튼을 실행하지 않는다', async ({
  page,
  browserName,
}) => {
  await boot(page);
  await launchHomeApp(page, 'contacts');
  const add = page.getByRole('button', { name: '새로운 연락처', exact: true });
  const box = (await add.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await pull(page, browserName, x, y);
  await expect(page.getByTestId('system-control')).toHaveAttribute('data-preview', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await pull(page, browserName, x, y, 25);
  await expect(page.getByTestId('system-control')).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await add.tap();
  await expect(page.getByRole('dialog')).toBeVisible();
});
test('shell 자신의 pointer capture를 잃으면 미리보기를 취소하고 다시 당길 수 있다', async ({
  page,
}) => {
  await boot(page);
  await page.mouse.move(322, 76);
  await page.mouse.down();
  await page.mouse.move(322, 120);
  await expect(page.getByTestId('system-control')).toHaveAttribute('data-preview', 'true');
  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.mobile-shell')!;
    // Native mouse pointer id is 1 in both tested engines.
    shell.releasePointerCapture(1);
  });
  await page.mouse.move(322, 125);
  await page.mouse.up();
  await expect(page.getByTestId('system-control')).toHaveCount(0);
  await pull(page, 'webkit', 322, 76);
  await expect(page.getByTestId('system-control')).toHaveAttribute('data-preview', 'false');
});
test('설정·사진·Safari에 데모나 출처 안내가 없고 사진 배경 설정은 유지된다', async ({ page }) => {
  await boot(page);
  await launchHomeApp(page, 'settings');
  await expect(page.getByRole('button', { name: '데모 안내', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('settings-app')).not.toContainText(/팬메이드|웹 체험|가상 통신사/);
  await page.getByRole('button', { name: '키류 카즈마 프로필' }).tap();
  await expect(page.getByTestId('settings-app')).not.toContainText(/팬메이드|실제 Apple/);
  await page.keyboard.press('Alt+Home');
  await launchHomeApp(page, 'photos');
  await page.getByRole('button', { name: '나팔꽃의 식사 시간', exact: true }).tap();
  await expect(page.getByLabel('사진 정보')).not.toContainText(/출처|SEGA|공식|임시|팬 창작/);
  await expect(page.getByLabel('사진 정보').getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: '배경화면으로 설정', exact: true }).tap();
  await expect(page.getByRole('status')).toContainText('배경화면으로 설정되었습니다.');
  await page.keyboard.press('Alt+Home');
  await launchHomeApp(page, 'safari');
  await expect(page.locator('.safari-start')).not.toContainText(/가상 페이지|실제 인터넷/);
  await page.getByRole('button', { name: '휴대폰 사용법', exact: true }).tap();
  await expect(page.locator('.safari-guide')).toContainText('아저씨,');
  await expect(page.locator('.safari-guide')).not.toContainText(/예제|팬메이드|웹 체험/);
});

test('날씨 상세의 드래그와 시스템 단축키는 뒤의 잠금을 해제하지 않는다', async ({ page }) => {
  await boot(page, false);
  await page.getByRole('button', { name: '나팔꽃 날씨 27도 열기', exact: true }).tap();
  const detail = page.getByRole('dialog', { name: '나팔꽃 날씨', exact: true });
  const box = (await detail.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y - 190, { steps: 10 });
  await page.mouse.up();
  await expect(detail).toBeVisible();
  await page.keyboard.press('Alt+c');
  await expect(page.getByTestId('system-control')).toHaveCount(0);
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '나팔꽃 날씨 27도 열기', exact: true }),
  ).toBeFocused();
});
