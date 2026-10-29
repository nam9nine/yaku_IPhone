import { unlockPhone } from '../helpers/unlock';
import { expect, test, type Page } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';
async function boot(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('./');
  await unlockPhone(page);
}
async function trigger(page: Page) {
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  for (const name of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${name} 완료`, exact: true }).check();
  await expect(page.getByRole('region', { name: '마지마 형님 전화 수신' })).toBeVisible();
}
for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`전화 다섯 탭·검색·키패드·연락처와 설정 프로필 ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await boot(page);
    await launchHomeApp(page, 'phone');
    await expect(
      page.getByRole('navigation', { name: '전화 보기' }).getByRole('button'),
    ).toHaveCount(5);
    await page.getByRole('button', { name: '부재중 전화', exact: true }).tap();
    await expect(page.locator('.phone-call')).toHaveCount(1);
    await page.getByRole('button', { name: '모두', exact: true }).tap();
    await page.getByRole('searchbox', { name: '통화 검색' }).fill('하루카');
    await expect(page.locator('.phone-call')).toHaveCount(3);
    await page.getByRole('button', { name: '키패드', exact: true }).tap();
    for (const digit of ['0', '1', '0'])
      await page.getByRole('button', { name: digit, exact: true }).tap();
    await expect(page.getByLabel('입력한 전화번호')).toHaveText('010');
    await page.getByRole('button', { name: '번호 한 자리 지우기' }).tap();
    await expect(page.getByLabel('입력한 전화번호')).toHaveText('01');
    await page.getByRole('button', { name: '전화 걸기', exact: true }).tap();
    await expect(page.getByRole('dialog')).toContainText('연결할 수 없습니다.');
    await page.getByRole('button', { name: '확인', exact: true }).tap();
    await page.keyboard.press('Alt+Home');
    await page.locator('[data-launch-app=contacts]').tap();
    await page.getByRole('button', { name: '키류 카즈마 내 카드' }).tap();
    await expect(page.getByRole('img', { name: '키류 카즈마 프로필' })).toBeVisible();
    await page.keyboard.press('Alt+Home');
    await launchHomeApp(page, 'settings');
    await page.getByRole('button', { name: '키류 카즈마 프로필' }).tap();
    await expect(page.getByText('키류의 iPhone', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}
test('별도 연락처와 전화 연락처는 추가한 연락처를 공유하고 새로고침에도 보존한다', async ({
  page,
}) => {
  await boot(page);
  await page.locator('[data-launch-app=contacts]').tap();
  await page.getByRole('button', { name: '새로운 연락처' }).tap();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('이름', { exact: true }).fill('나팔꽃 상점');
  await dialog.getByLabel('전화번호').fill('내선 1');
  await dialog.getByRole('button', { name: '완료', exact: true }).tap();
  await expect(page.getByRole('button', { name: '나팔꽃 상점', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await launchHomeApp(page, 'phone');
  await page.getByRole('button', { name: '연락처', exact: true }).tap();
  await expect(page.getByRole('button', { name: '나팔꽃 상점', exact: true })).toBeVisible();
  await page.reload();
  await unlockPhone(page);
  await page.locator('[data-launch-app=contacts]').tap();
  await expect(page.getByRole('button', { name: '나팔꽃 상점', exact: true })).toBeVisible();
});
test('전화 응답은 통화 화면으로 이어지고 종료하면 기존 메모로 복귀한다', async ({ page }) => {
  await boot(page);
  await trigger(page);
  await page.getByRole('button', { name: '전화 응답', exact: true }).tap();
  const call = page.getByRole('dialog', { name: '마지마 형님 통화' });
  await expect(call).toBeVisible();
  await call.getByRole('button', { name: '글로 입력', exact: true }).tap();
  await expect(call.getByRole('textbox', { name: '통화에서 보낼 말', exact: true })).toBeFocused();
  await call.getByRole('button', { name: '통화 종료' }).tap();
  await expect(call).not.toBeVisible();
  await expect(page.locator('.note-paper h2')).toHaveText('오늘 저녁 카레');
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('[data-launch-app=phone] .home-badge')).toHaveCount(0);
  await launchHomeApp(page, 'phone');
  await expect(page.locator('.phone-call').first()).toHaveAttribute('data-missed', 'false');
});
test('거절하면 알림·배지·통화 기록이 일치하고 알림을 읽으면 배지가 사라진다', async ({ page }) => {
  await boot(page);
  await trigger(page);
  await page.getByRole('button', { name: '전화 거절', exact: true }).tap();
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('[data-launch-app=phone] .home-badge')).toHaveText('1');
  await page.keyboard.press('Alt+n');
  await page.getByRole('button', { name: '마지마 형님 부재중 전화 알림 열기' }).tap();
  await expect(page.locator('.phone-call').first()).toHaveAttribute('data-missed', 'true');
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('[data-launch-app=phone] .home-badge')).toHaveCount(0);
  await page.keyboard.press('Alt+n');
  await expect(page.getByRole('button', { name: '마지마 형님 부재중 전화 알림 열기' })).toHaveCount(
    0,
  );
});
test('잠금 상태 수신 화면과 시간 초과, 새로고침 후 재수신 방지', async ({ page }) => {
  await page.clock.install();
  await boot(page);
  await trigger(page);
  await page.keyboard.press('Alt+Home');
  const lock = page.getByRole('button', { name: '다시 잠그기', exact: true });
  await lock.focus();
  await lock.press('Enter');
  await expect(page.getByRole('dialog', { name: '마지마 형님 전화 수신' })).toBeVisible();
  await page.clock.runFor(20_001);
  await expect(page.getByRole('dialog', { name: '마지마 형님 전화 수신' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '마지마 형님 부재중 전화 알림 열기' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: '마지마 형님 전화 수신' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '마지마 형님 부재중 전화 알림 열기' }),
  ).toBeVisible();
});
test('상단 드래그는 안쪽에서 시작하고 이동 중 패널이 손가락을 추적하며 취소 후 버튼이 눌린다', async ({
  page,
}) => {
  await boot(page);
  await launchHomeApp(page, 'settings');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const edge = (await page.getByTestId('control-edge').boundingBox())!;
  expect(edge.y).toBeGreaterThanOrEqual(40);
  const x = edge.x + edge.width / 2,
    y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 40, { steps: 5 });
  const panel = page.getByTestId('system-control');
  await expect(panel).toHaveAttribute('data-preview', 'true');
  const first = (await panel.boundingBox())!.y;
  await page.mouse.move(x, y + 160, { steps: 8 });
  await expect.poll(async () => (await panel.boundingBox())!.y).toBeGreaterThan(first);
  await page.mouse.up();
  await expect(panel).toHaveAttribute('data-preview', 'false');
  await expect.poll(async () => (await panel.boundingBox())!.y).toBeCloseTo(0, 0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 25, { steps: 4 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: '키류 카즈마 프로필' }).tap();
  await expect(page.getByRole('heading', { name: 'Apple 계정', exact: true })).toBeVisible();
});
test('갤러리는 선택한 6개의 서로 다른 로컬 게임 원본을 표시한다', async ({ page }) => {
  await boot(page);
  await launchHomeApp(page, 'photos');
  const images = page.locator('.photo-grid img');
  await expect(images).toHaveCount(6);
  const sources = await images.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src));
  expect(new Set(sources).size).toBe(6);
  for (const source of sources) expect(source).toContain('/asagao/');
  await expect(page.getByRole('button', { name: '마메', exact: true })).toBeVisible();
});

test('제어 센터 위에 전체 수신 화면이 떠도 키보드 포커스는 수신 화면에서 순환한다', async ({
  page,
}) => {
  await boot(page);
  await trigger(page);
  await page.keyboard.press('Alt+c');
  await page.getByRole('button', { name: '수신 전화 전체 화면' }).click();
  const dialog = page.getByRole('dialog', { name: '마지마 형님 전화 수신' });
  const buttons = dialog.getByRole('button');
  await buttons.first().focus();
  await page.keyboard.press('Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Alt+Home');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '전화 거절' }).click();
  await expect(page.getByTestId('system-control')).toBeVisible();
});

test('부재중 알림은 이전 키패드 대신 최근 통화 기록으로 연결된다', async ({ page }) => {
  await boot(page);
  await launchHomeApp(page, 'phone');
  await page.getByRole('button', { name: '키패드', exact: true }).tap();
  await page.keyboard.press('Alt+Home');
  await trigger(page);
  await page.getByRole('button', { name: '전화 거절' }).tap();
  await page.keyboard.press('Alt+n');
  await page.getByRole('button', { name: '마지마 형님 부재중 전화 알림 열기' }).tap();
  await expect(page.getByRole('heading', { name: '최근 통화', exact: true })).toBeVisible();
  const missedCall = page.locator('.phone-call').first();
  await expect(missedCall).toHaveAttribute('data-missed', 'true');
  await expect(missedCall.getByRole('button', { name: '마지마 고로에게 전화' })).toBeVisible();
});

test('작은 높이 키패드도 첫 숫자부터 통화 버튼까지 내부 스크롤로 접근한다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  await boot(page);
  await launchHomeApp(page, 'phone');
  await page.getByRole('button', { name: '키패드', exact: true }).tap();
  await page.getByRole('button', { name: '1', exact: true }).tap();
  await expect(page.getByLabel('입력한 전화번호')).toHaveText('1');
  await page.getByRole('button', { name: '#', exact: true }).tap();
  await page.getByRole('button', { name: '전화 걸기', exact: true }).tap();
  await expect(page.getByRole('dialog')).toContainText('1#');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('통화 중 높이가 줄어도 종료 버튼을 눌러 나갈 수 있다', async ({ page }) => {
  await boot(page);
  await trigger(page);
  await page.getByRole('button', { name: '전화 응답', exact: true }).tap();
  await page.setViewportSize({ width: 390, height: 320 });
  await page.getByRole('button', { name: '통화 종료', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '마지마 형님 통화' })).toHaveCount(0);
});
