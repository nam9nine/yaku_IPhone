import { expect, test } from '@playwright/test';
import { enterPasscode, unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';

test('잠긴 알림 센터 위의 암호 입력이 키보드 포커스를 유지한다', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await page.keyboard.press('Alt+n');
  await page
    .getByTestId('system-notifications')
    .getByRole('button', { name: '하루카의 메시지 알림 열기' })
    .tap();
  const pin = page.getByRole('dialog', { name: '암호 입력', exact: true });
  await expect(pin.getByRole('button', { name: '1', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(pin.getByRole('button', { name: '암호 한 자리 지우기' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(pin.getByRole('button', { name: '1', exact: true })).toBeFocused();
  await enterPasscode(page);
  await expect(page.getByTestId('system-notifications')).toHaveCount(0);
  await expect(page.getByRole('log', { name: '사와무라 하루카와의 대화' })).toBeVisible();
});

test('로컬 벨소리 미디어는 수신 중 재생되고 응답 즉시 정지한다', async ({ page }) => {
  await page.addInitScript(() => {
    const media: HTMLAudioElement[] = [];
    Object.defineProperty(window, '__ringtoneAudio', { value: media });
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement;
        media.push(audio);
        return audio;
      },
    });
  });
  const audioState = () =>
    page.evaluate(() => {
      const audio = (
        window as typeof window & { __ringtoneAudio: HTMLAudioElement[] }
      ).__ringtoneAudio.find((item) => item.src.includes('majima-ringtone.m4a'))!;
      return {
        paused: audio.paused,
        muted: audio.muted,
        time: audio.currentTime,
        duration: audio.duration,
        volume: audio.volume,
      };
    });
  await page.goto('./');
  await unlockPhone(page);
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  for (const name of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${name} 완료`, exact: true }).check();
  await expect.poll(async () => (await audioState()).paused).toBe(false);
  await expect.poll(async () => (await audioState()).muted).toBe(false);
  expect((await audioState()).duration).toBeCloseTo(32, 1);
  await page.getByRole('button', { name: '전화 응답', exact: true }).tap();
  await expect.poll(async () => (await audioState()).paused).toBe(true);
  expect((await audioState()).muted).toBe(true);
  expect((await audioState()).time).toBe(0);
});

test('암호 오답·삭제·취소 후 알림 목적지를 보존하고 다시 잠그면 암호가 필요하다', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: '하루카의 메시지 알림 열기' }).tap();
  const pin = page.getByRole('dialog', { name: '암호 입력', exact: true });
  await expect(pin).toBeVisible();
  await expect(pin).not.toContainText(/힌트|1225/);
  await page.keyboard.type('1111');
  await expect(pin.getByRole('status')).toHaveText('암호가 올바르지 않습니다.');
  await expect(page.locator('.app-host')).toHaveCount(0);
  await page.keyboard.type('12');
  await pin.getByRole('button', { name: '암호 한 자리 지우기' }).tap();
  await expect(pin.getByRole('img', { name: /^암호/ })).toHaveAttribute(
    'aria-label',
    '암호 1자리 입력됨',
  );
  await page.keyboard.press('Escape');
  await expect(pin).toHaveCount(0);
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: '하루카의 메시지 알림 열기' })).toBeVisible();
  await page.getByRole('button', { name: '하루카의 메시지 알림 열기' }).tap();
  for (const digit of ['1', '2', '2', '5'])
    await pin.getByRole('button', { name: digit, exact: true }).tap();
  await expect(page.getByRole('log', { name: '사와무라 하루카와의 대화' })).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await page.getByRole('button', { name: '다시 잠그기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(pin).toBeVisible();
  await expect(pin.getByRole('img', { name: /^암호/ })).toHaveAttribute(
    'aria-label',
    '암호 0자리 입력됨',
  );
  await enterPasscode(page);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(pin).toBeVisible();
});

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 390, height: 400 },
]) {
  test(`암호 숫자판과 취소 버튼이 화면 안에 있고 뒤 화면 입력을 막는다 ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
    const pin = page.getByRole('dialog', { name: '암호 입력', exact: true });
    for (const button of await pin.getByRole('button').all())
      await expect(button).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Alt+c');
    await expect(page.getByTestId('system-control')).toHaveCount(0);
    await page.setViewportSize({ width: size.width, height: size.height + 40 });
    await enterPasscode(page);
    await expect(page.getByTestId('home-screen')).toBeVisible();
  });
}

test('수신 중 중복 시각 없이 이름을 표시하고 연결 뒤 통화 시간을 이름 위에 표시한다', async ({
  page,
}) => {
  await page.goto('./');
  await unlockPhone(page);
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  for (const name of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${name} 완료`, exact: true }).check();
  await page.getByRole('button', { name: '수신 전화 전체 화면' }).tap();
  const call = page.getByRole('dialog', { name: '마지마 형님 전화 수신' });
  await expect(call.getByRole('heading', { name: '마지마 형님', exact: true })).toBeVisible();
  await expect(call.locator('.call-identity .call-time')).toHaveCount(0);
  await expect(call.locator('.call-kind')).toHaveText('휴대전화');
  await call.getByRole('button', { name: '전화 응답' }).tap();
  const connected = page.getByRole('dialog', { name: '마지마 형님 통화', exact: true });
  await expect(connected.locator('.call-time')).toHaveText(/00:\d\d/);
  const clock = (await connected.locator('.call-time').boundingBox())!;
  const name = (await connected.getByRole('heading', { name: '마지마 형님' }).boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(clock.y + clock.height);
  expect(name.y - clock.y - clock.height).toBeLessThan(25);
});
