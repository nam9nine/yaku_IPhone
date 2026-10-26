import { finishAiReply } from '../helpers/ai-clock';
import { mockStoryAi } from '../helpers/mock-story-ai';
import { enterPasscode, unlockPhone } from '../helpers/unlock';
import { expect, test, type Page } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';

test.beforeEach(async ({ page }) => {
  await mockStoryAi(page);
});

async function boot(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
}
async function home(page: Page) {
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
}
async function openCurryFromNotification(page: Page) {
  await page.getByRole('button', { name: '하루카의 메시지 알림 열기', exact: true }).tap();
  await enterPasscode(page);
  await expect(page.getByRole('log', { name: '사와무라 하루카와의 대화' })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: '하루카에게 메시지 입력', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '메시지 보내기', exact: true })).toBeDisabled();
  await page
    .getByRole('button', { name: '장보기 목록: 오늘 저녁 카레 메모 열기', exact: true })
    .tap();
  await expect(page.locator('.note-paper h2')).toHaveText('오늘 저녁 카레');
}
async function completeCurry(page: Page) {
  for (const item of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${item} 완료`, exact: true }).check();
}
async function lock(page: Page) {
  await home(page);
  const button = page.getByRole('button', { name: '다시 잠그기', exact: true });
  await button.focus();
  await button.press('Enter');
  await expect(page.getByTestId('lock-screen')).toBeVisible();
}

test('알림 센터의 메시지는 가로 카드로 표시되고 대화로 연결된 뒤 읽음으로 사라진다', async ({
  page,
}) => {
  await boot(page);
  await unlockPhone(page);
  const openNotifications = page.getByRole('button', { name: '알림 센터 열기', exact: true });
  await openNotifications.focus();
  await openNotifications.press('Enter');
  const panel = page.getByTestId('system-notifications');
  const message = panel.getByRole('button', { name: '하루카의 메시지 알림 열기' });
  const bounds = (await message.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(300);
  expect(bounds.height).toBeLessThan(180);
  await message.tap();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('log', { name: '사와무라 하루카와의 대화' })).toBeVisible();
  await home(page);
  await page.getByRole('button', { name: '알림 센터 열기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('이전 알림 없음', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '하루카의 메시지 알림 열기' })).toHaveCount(0);
});

for (const width of [360, 390, 430]) {
  test(`하루카 알림에서 카레 장보기·답장·할 일 갱신·재접속까지 연결된다 ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : width === 390 ? 844 : 932 });
    await boot(page);
    await expect(page.getByRole('button', { name: '남은 할 일 3개', exact: true })).toBeVisible();
    await openCurryFromNotification(page);
    await expect(page.locator('.day-carrot s')).toHaveText('당근');
    await expect(page.getByText('하루카: 냉장고에 있어요.', { exact: true })).toBeVisible();
    await completeCurry(page);
    await expect(page.getByRole('status').filter({ hasText: /^저녁 장보기 완료$/ })).toBeVisible();
    await expect(
      page.getByRole('region', { name: '마지마 형님 전화 수신', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '전화 거절', exact: true }).tap();
    await home(page);
    await launchHomeApp(page, 'reminders');
    await expect(
      page.getByRole('checkbox', { name: '저녁 장보기 완료', exact: true }),
    ).toBeChecked();
    await expect(page.locator('.day-reminder-heading > strong')).toHaveText('2');
    await home(page);
    await launchHomeApp(page, 'messages');
    await page.getByRole('button', { name: '다 샀다. 보내기', exact: true }).tap();
    await finishAiReply(page, 'haruka');
    await expect(page.getByText('검증용 하루카 답장', { exact: true })).toBeVisible();
    await expect(
      page.locator('.message-bubble').getByText('다 샀다.', { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: '다 샀다. 보내기', exact: true })).toHaveCount(0);
    await lock(page);
    await expect(page.getByRole('button', { name: '남은 할 일 2개', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '남은 할 일 2개', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '하루카의 메시지 알림 열기', exact: true }),
    ).toHaveCount(0);
    await unlockPhone(page);
    await launchHomeApp(page, 'notes');
    await page.locator('[data-note-id=curry]').tap();
    for (const item of ['감자', '양파', '고기', '카레'])
      await expect(page.getByRole('checkbox', { name: `${item} 완료`, exact: true })).toBeChecked();
    await page.getByRole('checkbox', { name: '감자 완료', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: '감자 완료', exact: true }).check();
    await expect(
      page.getByRole('region', { name: '마지마 형님 전화 수신', exact: true }),
    ).toHaveCount(0);
    await home(page);
    await launchHomeApp(page, 'messages');
    await page.locator('[data-conversation=haruka]').tap();
    await expect(
      page.locator('.message-bubble').getByText('다 샀다.', { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText('검증용 하루카 답장', { exact: true })).toHaveCount(1);
    await home(page);
    await launchHomeApp(page, 'phone');
    await expect(
      page.getByRole('button', { name: '마지마 부재중 전화, 메시지 열기', exact: true }),
    ).toHaveCount(1);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  });
}

test('확인 전 초기화는 취소되고 확인 후 로컬 체크·배경을 되돌리며 서버 대화는 보존한다', async ({
  page,
}) => {
  await boot(page);
  await openCurryFromNotification(page);
  await completeCurry(page);
  await page.getByRole('button', { name: '전화 거절' }).tap();
  await home(page);
  await launchHomeApp(page, 'messages');
  await page.getByRole('button', { name: '다 샀다. 보내기' }).tap();
  await home(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('button', { name: '배경화면', exact: true }).tap();
  await page.getByRole('radio', { name: '아이들이 그린 그림', exact: true }).check();
  await page.getByRole('button', { name: '설정 목록으로 돌아가기', exact: true }).tap();
  await page.getByRole('button', { name: '처음 상태로 되돌리기', exact: true }).tap();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '취소', exact: true }).tap();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.mobile-shell')).toHaveAttribute('data-wallpaper', 'drawing');
  await home(page);
  await launchHomeApp(page, 'messages');
  await finishAiReply(page, 'haruka');
  await expect(page.getByText('검증용 하루카 답장', { exact: true })).toBeVisible();
  await home(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('button', { name: '처음 상태로 되돌리기', exact: true }).tap();
  await dialog.getByRole('button', { name: '초기화', exact: true }).tap();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: '남은 할 일 3개', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-shell')).toHaveAttribute('data-wallpaper', 'default');
  await page.reload();
  await openCurryFromNotification(page);
  for (const item of ['감자', '양파', '고기', '카레'])
    await expect(
      page.getByRole('checkbox', { name: `${item} 완료`, exact: true }),
    ).not.toBeChecked();
});

test('저장소 읽기와 쓰기가 거부되어도 현재 세션의 카레 흐름은 완료된다', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    Storage.prototype.setItem = () => {
      throw new Error('denied');
    };
  });
  await boot(page);
  await openCurryFromNotification(page);
  await completeCurry(page);
  await expect(
    page.getByText('저장 공간을 사용할 수 없어 이번 접속 중에만 유지됩니다.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '전화 거절' }).tap();
  await home(page);
  await launchHomeApp(page, 'messages');
  await page.getByRole('button', { name: '다 샀다. 보내기' }).tap();
  await finishAiReply(page, 'haruka');
  await expect(page.getByText('검증용 하루카 답장', { exact: true })).toBeVisible();
  await lock(page);
  await expect(page.getByRole('button', { name: '남은 할 일 2개', exact: true })).toBeVisible();
});

test('사진에서 배경을 선택하고 설정에서 위치·다른 배경을 바꾸면 재접속에도 유지한다', async ({
  page,
}) => {
  await boot(page);
  await unlockPhone(page);
  await launchHomeApp(page, 'photos');
  await page.getByRole('button', { name: '마메', exact: true }).tap();
  await expect(page.getByText('밥 먹을 시간이다.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('사진 정보').getByRole('link')).toHaveCount(0);
  await expect(page.getByLabel('사진 정보')).not.toContainText(/출처|팬 창작/);
  await page.getByRole('button', { name: '배경화면으로 설정', exact: true }).tap();
  await expect(page.locator('.mobile-shell')).toHaveAttribute('data-wallpaper', 'mame');
  await page.reload();
  await expect(page.locator('.mobile-shell')).toHaveAttribute('data-wallpaper', 'mame');
  await unlockPhone(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('button', { name: '배경화면', exact: true }).tap();
  await page.getByRole('slider', { name: '사진 가로 위치', exact: true }).fill('35');
  await page.getByRole('slider', { name: '사진 세로 위치', exact: true }).fill('65');
  await page.reload();
  await expect(page.locator('.mobile-shell-wallpaper > img')).toHaveCSS(
    'object-position',
    '35% 65%',
  );
  await unlockPhone(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('button', { name: '배경화면', exact: true }).tap();
  await page.getByRole('radio', { name: '저녁 바다', exact: true }).check();
  await expect(page.locator('.mobile-shell')).toHaveAttribute('data-wallpaper', 'sea');
  await page.reload();
  await expect(page.locator('.mobile-shell')).toHaveAttribute('data-wallpaper', 'sea');
});

test('잠금 위젯은 해당 앱으로 연결되고 키보드로 할 일과 사진을 조작한다', async ({ page }) => {
  await boot(page);
  const calendar = page.getByRole('button', {
    name: '17:00 장보기, 저녁 카레 재료 일정 열기',
    exact: true,
  });
  await calendar.focus();
  await calendar.press('Enter');
  await enterPasscode(page);
  await expect(page.getByRole('region', { name: '캘린더 화면' })).toBeVisible();
  await page.locator('.day-calendar-event').press('Enter');
  await expect(page.locator('.day-event-detail h2')).toHaveText('저녁 장보기');
  await page.getByRole('button', { name: /오늘 저녁 카레 메모 열기/ }).press('Enter');
  await expect(page.locator('.note-paper h2')).toHaveText('오늘 저녁 카레');
  await lock(page);
  const weather = page.getByRole('button', { name: '나팔꽃 날씨 27도 열기', exact: true });
  await weather.focus();
  await weather.press('Enter');
  const detail = page.getByRole('dialog', { name: '나팔꽃 날씨', exact: true });
  await expect(detail).toContainText('27° · 맑음');
  await detail.getByRole('button', { name: '닫기', exact: true }).click();
  const reminders = page.getByRole('button', { name: '남은 할 일 3개', exact: true });
  await reminders.focus();
  await reminders.press('Enter');
  await enterPasscode(page);
  const garden = page.getByRole('checkbox', { name: '텃밭 물 주기 완료', exact: true });
  await garden.focus();
  await garden.press('Space');
  await expect(garden).toBeChecked();
  await expect(page.locator('.day-reminder-heading > strong')).toHaveText('2');
  await home(page);
  const photo = page.getByRole('button', { name: '사진 위젯', exact: true });
  await photo.focus();
  await photo.press('Enter');
  await expect(page.getByTestId('photo-viewer').getByRole('img')).toHaveAttribute(
    'alt',
    '아이들과 함께',
  );
});

test('낮은 화면과 큰 글자에서 캘린더 상세는 맨 위로 열리고 목록 위치를 복원한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await boot(page);
  await unlockPhone(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('button', { name: '화면 모드', exact: true }).tap();
  await page.getByRole('radio', { name: /더 크게/ }).check();
  await home(page);
  await launchHomeApp(page, 'calendar');
  const event = page.locator('.day-calendar-event');
  await event.tap();
  await expect(page.locator('.day-event-detail h2')).toBeInViewport();
  await expect(page.locator('.day-calendar .personal-scroll')).toHaveJSProperty('scrollTop', 0);
  await page.locator('.day-calendar-back').tap();
  await expect(event).toBeInViewport();
  await event.tap();
  await expect(page.locator('.day-event-detail h2')).toBeInViewport();
  await page.getByRole('button', { name: /오늘 저녁 카레 메모 열기/ }).tap();
  await expect(page.locator('.note-paper h2')).toHaveText('오늘 저녁 카레');
});

test('긴 메모 아래에서 홈을 거쳐 하루카의 링크를 열면 카레 메모 맨 위가 보인다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await boot(page);
  await unlockPhone(page);
  await launchHomeApp(page, 'notes');
  await page.getByRole('button', { name: '새로운 메모', exact: true }).tap();
  await page.getByRole('textbox', { name: '메모 제목', exact: true }).fill('긴 메모');
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill(
      Array.from({ length: 60 }, (_, index) => `${index + 1}. 아이들과 보낼 주말 준비`).join('\n'),
    );
  const content = page.getByTestId('notes-content');
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(400);
  await home(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=haruka]').tap();
  await page
    .getByRole('button', { name: '장보기 목록: 오늘 저녁 카레 메모 열기', exact: true })
    .tap();
  await expect(page.locator('.note-paper h2')).toHaveText('오늘 저녁 카레');
  await expect(page.locator('.note-paper h2')).toBeInViewport();
  await expect(content).toHaveJSProperty('scrollTop', 0);
});

test('초기화 확인 중 홈·제어 센터·최근 앱으로 이동하면 모달이 남지 않는다', async ({ page }) => {
  await boot(page);
  await unlockPhone(page);
  for (const shortcut of ['Alt+Home', 'Alt+c', 'Alt+a']) {
    await launchHomeApp(page, 'settings');
    await page.getByRole('button', { name: '처음 상태로 되돌리기', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: '처음 상태로 되돌릴까요?', exact: true });
    await expect(dialog).toBeVisible();
    await page.keyboard.press(shortcut);
    await expect(dialog).not.toBeVisible();
    if (shortcut === 'Alt+c') {
      const control = page.getByTestId('system-control');
      await expect(control).toBeVisible();
      await control.getByRole('switch', { name: 'Wi-Fi', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(control).toHaveCount(0);
    } else if (shortcut === 'Alt+a') {
      await expect(page.getByTestId('system-switcher')).toBeVisible();
      await page.getByRole('button', { name: '설정 앱으로 전환', exact: true }).tap();
    }
    await home(page);
    await expect(page.getByTestId('home-screen')).toBeVisible();
    await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toHaveCount(0);
  }
});
