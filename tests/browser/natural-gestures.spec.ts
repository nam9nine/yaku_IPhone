import { unlockPhone } from '../helpers/unlock';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { dragTimedPath } from '../helpers/gestureClock';
import { launchHomeApp } from '../helpers/home';

async function ready(page: Page) {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
}

const curve = [
  { dx: -90, dy: -4, afterMs: 16 },
  { dx: -120, dy: -20, afterMs: 16 },
  { dx: -120, dy: -60, afterMs: 16 },
];
const quarterArc = Array.from({ length: 10 }, (_, index) => {
  const angle = ((index + 1) / 10) * (Math.PI / 2);
  return { dx: 80 * (1 - Math.cos(angle)), dy: -80 * Math.sin(angle), afterMs: 50 };
});

for (const scenario of [
  { name: '빠른 곡선', points: curve, home: true, holdMs: 0 },
  { name: '멈춘 곡선', points: curve, home: false, holdMs: 180 },
  {
    name: '왼쪽에서 위로 휘는 느린 사분원',
    points: quarterArc,
    home: false,
    holdMs: 0,
    originX: 0.15,
  },
  {
    name: '48px 직선에서 멈춤',
    points: [{ dx: 0, dy: -48, afterMs: 40 }],
    home: false,
    holdMs: 180,
  },
  { name: '빠른 48px 직선', points: [{ dx: 0, dy: -48, afterMs: 40 }], home: true, holdMs: 0 },
]) {
  test(`${scenario.name}을 하단 막대 없이 구분한다`, async ({ page }) => {
    await ready(page);
    await launchHomeApp(page, 'settings');
    await expect(page.locator('.home-indicator')).toHaveCount(0);
    await dragTimedPath(page, page.getByTestId('settings-home-gesture'), scenario.points, scenario);
    if (scenario.home) {
      await expect(page.getByTestId('settings-app')).toBeHidden();
      await expect(page.getByTestId('system-switcher')).toHaveCount(0);
      await expect(page.locator('[data-launch-app=settings]')).toBeFocused();
    } else {
      await expect(page.getByTestId('system-switcher')).toBeVisible();
      await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
      await expect(page.getByTestId('settings-app')).toBeVisible();
    }
  });
}

test('짧은 상승 중에도 카드와 이전 앱을 보여 주고 놓기 전에는 전환하지 않는다', async ({
  page,
}) => {
  await ready(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await launchHomeApp(page, 'safari');
  await page.keyboard.press('Alt+Home');
  await expect(page.getByTestId('safari-app')).toBeHidden();
  await launchHomeApp(page, 'settings');
  await dragTimedPath(
    page,
    page.getByTestId('settings-home-gesture'),
    [{ dx: 0, dy: -48, afterMs: 40 }],
    {
      holdMs: 180,
      atEnd: async () => {
        const app = (await page.getByTestId('settings-app').boundingBox())!;
        expect(app.width).toBeLessThan(390 * 0.85);
        await expect(page.locator('.gesture-previous-card')).toBeVisible();
        await expect(page.locator('.gesture-current-title')).toBeVisible();
        await expect(page.getByTestId('system-switcher')).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath('short-lift.png') });
      },
    },
  );
  await expect(page.getByTestId('system-switcher')).toBeVisible();
});

async function twoApps(page: Page) {
  await ready(page);
  await launchHomeApp(page, 'settings');
  await page.locator('[data-settings-page=wifi]').tap();
  await page.keyboard.press('Alt+Home');
  await launchHomeApp(page, 'safari');
  await page.keyboard.press('Alt+a');
}

test('최근 카드는 마지막 구간이 옆으로 향하는 사분원으로도 닫힌다', async ({ page }) => {
  await twoApps(page);
  const safari = page.getByRole('button', { name: 'Safari 앱으로 전환', exact: true });
  await dragTimedPath(
    page,
    safari,
    quarterArc.map((point) => ({ ...point, dx: point.dx * 1.5, dy: point.dy * 1.5 })),
    { originX: 0.2 },
  );
  await expect(safari).toHaveCount(0);
  await expect(page.getByRole('button', { name: '설정 앱으로 전환', exact: true })).toBeVisible();
});

test('최근 카드 곡선은 해당 카드만 닫고 짧은 상승은 삭제하지 않는다', async ({ page }) => {
  await twoApps(page);
  const safari = page.getByRole('button', { name: 'Safari 앱으로 전환', exact: true });
  await dragTimedPath(page, safari, [{ dx: -20, dy: -60, afterMs: 80 }]);
  await expect(safari).toBeVisible();
  await expect(page.getByTestId('system-switcher')).toBeVisible();
  await dragTimedPath(
    page,
    safari,
    [
      { dx: -75, dy: -4, afterMs: 40 },
      { dx: -95, dy: -40, afterMs: 40 },
      { dx: -95, dy: -140, afterMs: 40 },
    ],
    {
      atEnd: async () => {
        await expect(page.locator('[data-recent-app=safari]')).toHaveAttribute(
          'data-dragging',
          'true',
        );
        await expect(page.locator('[data-recent-app=settings]')).toHaveAttribute(
          'data-dragging',
          'false',
        );
        expect(
          await page
            .locator('[data-recent-app=settings]')
            .evaluate((el) => el.style.getPropertyValue('--card-drag-x')),
        ).toBe('0px');
      },
    },
  );
  await expect(safari).toHaveCount(0);
  await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Wi-Fi', exact: true })).toBeVisible();
});

test('최근 카드의 취소 뒤 탭은 막히지 않고 순수 좌우 넘기기는 앱을 삭제하지 않는다', async ({
  page,
}) => {
  await twoApps(page);
  const safari = page.getByRole('button', { name: 'Safari 앱으로 전환', exact: true });
  await dragTimedPath(
    page,
    safari,
    [
      { dx: -90, dy: -5, afterMs: 40 },
      { dx: -100, dy: -140, afterMs: 40 },
    ],
    {
      atEnd: async (point) => {
        await page
          .locator('.recent-viewport')
          .dispatchEvent('pointercancel', { pointerId: 1, clientX: point.x, clientY: point.y });
      },
    },
  );
  await expect(page.locator('[data-recent-app=safari]')).toHaveAttribute('data-dragging', 'false');
  await safari.tap();
  await expect(page.getByTestId('safari-app')).toBeVisible();
  await page.keyboard.press('Alt+a');
  await dragTimedPath(page, safari, [{ dx: 110, dy: -8, afterMs: 60 }]);
  await expect(page.locator('[data-recent-app=settings]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.recent-card')).toHaveCount(2);
});

async function driftTap(page: Page, button: Locator, browserName: string, dx: number, dy: number) {
  await button.click({ trial: true });
  const box = (await button.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(Math.abs(dx)).toBeLessThan(box.width / 2);
  expect(Math.abs(dy)).toBeLessThan(box.height / 2);
  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx, y: y + dy }],
      });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
  }
}

for (const app of ['settings', 'messages', 'contacts', 'notes', 'photos'] as const) {
  test(`${app} 뒤로 버튼 안에서 9px 움직인 탭을 시스템 제스처가 빼앗지 않는다`, async ({
    page,
    browserName,
  }) => {
    await ready(page);
    await launchHomeApp(page, app);
    for (const [dx, dy] of [
      [0, 9],
      [9, 0],
    ]) {
      let back: Locator;
      if (app === 'settings') {
        await page.locator('[data-settings-page=wifi]').tap();
        back = page.getByRole('button', { name: '설정 목록으로 돌아가기', exact: true });
      } else if (app === 'messages') {
        await page.locator('[data-conversation=haruka]').tap();
        back = page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true });
      } else if (app === 'contacts') {
        await page.getByRole('button', { name: '사와무라 하루카', exact: true }).tap();
        back = page.getByRole('button', { name: '연락처 목록으로 돌아가기', exact: true });
      } else if (app === 'notes') {
        await page.locator('[data-note-id=phone-help]').tap();
        back = page.getByRole('button', { name: '메모 목록으로 돌아가기', exact: true });
      } else {
        await page.getByRole('button', { name: '아이들과 함께', exact: true }).tap();
        back = page.getByRole('button', { name: '사진 보관함으로 돌아가기', exact: true });
      }
      await driftTap(page, back, browserName, dx, dy);
      await expect(back).toHaveCount(0);
      await expect(page.locator('.system-panel')).toHaveCount(0);
    }
  });
}

test('홈·최근 앱·제어 센터와 Safari의 닫기 버튼을 작은 이동이 있는 탭으로 조작한다', async ({
  page,
  browserName,
}) => {
  await ready(page);
  await launchHomeApp(page, 'settings');
  const home = page.getByRole('button', { name: '홈으로 돌아가기', exact: true });
  await home.focus();
  await driftTap(page, home, browserName, 9, 0);
  await expect(page.getByTestId('settings-app')).toBeHidden();
  await page.keyboard.press('Alt+a');
  const closeApp = page.getByRole('button', { name: '설정 앱 닫기', exact: true });
  await closeApp.focus();
  await driftTap(page, closeApp, browserName, 0, 9);
  await expect(page.locator('[data-recent-app=settings]')).toHaveCount(0);
  await expect(page.getByTestId('system-switcher')).toHaveCount(0);
  await page.keyboard.press('Alt+c');
  const closeControl = page.getByRole('button', { name: '제어 센터 닫기', exact: true });
  await closeControl.focus();
  await driftTap(page, closeControl, browserName, 0, 9);
  await expect(page.getByTestId('system-control')).toHaveCount(0);
  await launchHomeApp(page, 'safari');
  await page.getByRole('button', { name: '페이지 메뉴', exact: true }).tap();
  await driftTap(
    page,
    page.getByRole('button', { name: '페이지 메뉴 닫기', exact: true }),
    browserName,
    9,
    0,
  );
  await expect(page.getByRole('dialog', { name: '페이지 메뉴' })).toHaveCount(0);
  await page.getByRole('button', { name: '탭 보기, 1개', exact: true }).tap();
  await driftTap(
    page,
    page.getByRole('button', { name: '시작 페이지 탭 닫기', exact: true }),
    browserName,
    0,
    9,
  );
  await expect(page.getByRole('heading', { name: '시작 페이지', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '탭 보기, 1개', exact: true }).tap();
  await driftTap(page, page.getByRole('button', { name: '완료', exact: true }), browserName, 9, 0);
  await expect(page.getByRole('region', { name: '열린 탭' })).toHaveCount(0);
  await page.getByRole('button', { name: '주소 또는 검색어 입력', exact: true }).tap();
  await driftTap(page, page.getByRole('button', { name: '취소', exact: true }), browserName, 0, 9);
  await expect(page.getByRole('textbox', { name: '주소 또는 검색어', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '휴대폰 사용법', exact: true }).tap();
  await driftTap(page, page.getByRole('button', { name: '뒤로', exact: true }), browserName, 9, 0);
  await expect(page.getByRole('heading', { name: '시작 페이지', exact: true })).toBeVisible();
});

test('통화 화면의 막대 없이 통화 종료 버튼이 작은 이동이 있는 탭에 응답한다', async ({
  page,
  browserName,
}) => {
  await ready(page);
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  for (const item of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${item} 완료`, exact: true }).check();
  await page.getByRole('button', { name: '전화 응답', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '마지마 형님 통화' })).toBeVisible();
  await expect(page.locator('.home-indicator')).toHaveCount(0);
  await driftTap(
    page,
    page.getByRole('button', { name: '통화 종료', exact: true }),
    browserName,
    0,
    9,
  );
  await expect(page.getByRole('dialog', { name: '마지마 형님 통화' })).toHaveCount(0);
});
