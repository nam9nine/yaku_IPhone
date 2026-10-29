import { expect, test, type Page } from '@playwright/test';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';
import { mockStoryAi } from '../helpers/mock-story-ai';
import { finishAiReply } from '../helpers/ai-clock';

test.beforeEach(async ({ page }) => {
  await mockStoryAi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
async function boot(page: Page) {
  await page.goto('./');
  await unlockPhone(page);
}
async function home(page: Page) {
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
}
async function thread(page: Page, id: string) {
  await launchHomeApp(page, 'messages');
  await page.locator(`[data-conversation=${id}]`).tap();
}
async function back(page: Page) {
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).tap();
}
async function day(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('yaku-iphone.day.v1')!));
}

test('선택형 문자는 인물별로 기다리고 세 왕복 뒤 끝난다', async ({ page }) => {
  await boot(page);
  await thread(page, 'daigo');
  await page
    .getByRole('button', { name: '네가 직접 보고 판단해라. 이야기는 듣겠다. 보내기', exact: true })
    .tap();
  await expect(
    page.getByText('답장 대기 중 · 다른 연락처에는 보낼 수 있어요.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('네. 먼저 제가 확인하겠습니다. 그 뒤에 말씀드리겠습니다.', { exact: true }),
  ).toHaveCount(0);
  await back(page);
  await page.locator('[data-conversation=yuki]').tap();
  await page
    .getByRole('button', { name: '조금 있다 들르겠다. 무슨 일이지? 보내기', exact: true })
    .tap();
  expect(Object.keys((await day(page)).storyPending).sort()).toEqual(['daigo', 'yuki']);
  await page.clock.runFor(12_000);
  await expect(
    page.getByText('자리 배치를 조금 바꿨거든요. 한 번만 봐주세요!', { exact: true }),
  ).toBeVisible();
  expect((await day(page)).readThreads).toContain('yuki');
  await back(page);
  await page.locator('[data-conversation=daigo]').tap();
  await expect(
    page.getByText('네. 먼저 제가 확인하겠습니다. 그 뒤에 말씀드리겠습니다.', { exact: true }),
  ).toBeVisible();
  for (const choice of ['혼자 모든 걸 떠안을 필요는 없다.', '그래. 기다리마.']) {
    await page.getByRole('button', { name: `${choice} 보내기`, exact: true }).tap();
    await page.clock.runFor(12_000);
  }
  await expect(page.getByText('지금은 새로 보낼 답장이 없습니다.', { exact: true })).toBeVisible();
  expect((await day(page)).storyMessages.daigo).toHaveLength(6);
  await page.reload();
  await unlockPhone(page);
  await thread(page, 'daigo');
  await expect(page.getByText('지금은 새로 보낼 답장이 없습니다.', { exact: true })).toBeVisible();
  expect((await day(page)).storyMessages.daigo).toHaveLength(6);
});

test('하루카는 완료한 할 일 선택으로만 답장하고 다른 연락처 AI 전송을 막지 않는다', async ({
  page,
}) => {
  await boot(page);
  await launchHomeApp(page, 'reminders');
  await page.getByRole('checkbox', { name: '텃밭 물 주기 완료', exact: true }).check();
  await home(page);
  await thread(page, 'haruka');
  await expect(
    page.getByRole('textbox', { name: '하루카에게 메시지 입력', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: '오늘 할 일에 적힌 텃밭 물 주기는 끝냈다. 보내기', exact: true })
    .tap();
  await back(page);
  await page.locator('[data-conversation=majima]').tap();
  const input = page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true });
  await input.fill('형님, 잠깐 말씀드릴 게 있습니다.');
  await expect(page.getByRole('button', { name: '메시지 보내기', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
  await expect(page.getByLabel('답장 작성 중')).toHaveCount(0);
  await finishAiReply(page, 'majima');
  await finishAiReply(page, 'haruka');
  await back(page);
  await page.locator('[data-conversation=haruka]').tap();
  await expect(
    page.getByRole('button', {
      name: '오늘 할 일에 적힌 텃밭 물 주기는 끝냈다. 보내기',
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await day(page)).storyChoiceHistory.haruka).toEqual(['haruka-garden']);
});

test('마지마 선택의 인연 변화는 AI 완료 후 한 번만 적용되고 재접속에도 유지된다', async ({
  page,
}) => {
  await boot(page);
  await thread(page, 'majima');
  test.setTimeout(60_000);
  const sendText = async (text: string) => {
    await page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }).fill(text);
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
    await finishAiReply(page, 'majima');
  };
  await expect(
    page.getByRole('button', {
      name: '오늘은 다른 볼일이 있습니다. 나중에 뵙죠. 보내기',
      exact: true,
    }),
  ).toHaveCount(0);
  for (const text of [
    '형님, 문자 봤습니다.',
    '지금은 다른 일을 보고 있습니다.',
    '조금 있다 다시 연락드리겠습니다.',
  ])
    await sendText(text);
  await expect(
    page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: '오늘은 다른 볼일이 있습니다. 나중에 뵙죠. 보내기', exact: true })
    .tap();
  await finishAiReply(page, 'majima');
  await expect(page.getByLabel('마지마와의 인연 -1', { exact: true })).toBeVisible();
  for (const text of ['아직 볼일이 남았습니다.', '오늘은 시간이 어렵겠습니다.'])
    await sendText(text);
  await page
    .getByRole('button', { name: '형님과는 만나고 싶지 않습니다. 보내기', exact: true })
    .tap();
  await finishAiReply(page, 'majima');
  await expect(page.getByLabel('마지마와의 인연 -3', { exact: true })).toContainText(
    '조금 서먹한 사이',
  );
  await page.reload();
  await unlockPhone(page);
  await thread(page, 'majima');
  await expect(page.getByLabel('마지마와의 인연 -3', { exact: true })).toBeVisible();
  expect((await day(page)).storyChoiceHistory.majima).toEqual(['majima-1b', 'majima-2b']);
});

test('사용 시간이 지나면 수신하고 마지마 거절 문자는 한 번 남으며 다른 인물에게 발신한다', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await boot(page);
  await page.clock.runFor(60_000);
  await expect(
    page.getByRole('region', { name: '마지마 형님 전화 수신', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '전화 거절', exact: true }).tap();
  await thread(page, 'majima');
  await expect(
    page.getByText('왜 끊노! 볼일 끝나면 니가 다시 걸어라.', { exact: true }),
  ).toHaveCount(1);
  await home(page);
  await launchHomeApp(page, 'phone');
  await page.getByRole('button', { name: '연락처', exact: true }).tap();
  await page.locator('[data-contact=date]').tap();
  await page.getByRole('button', { name: '다테 마코토에게 전화 걸기', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '다테 씨 전화 발신', exact: true })).toBeVisible();
  await page.clock.runFor(3_000);
  const call = page.getByRole('dialog', { name: '다테 씨 통화', exact: true });
  await expect(call).toBeVisible();
  await expect(call.getByRole('log', { name: '통화 내용' })).toContainText('키류, 전화는 받는군.');
  await page.clock.runFor(10_000);
  await expect(call.getByRole('button', { name: '통화 종료', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(call.getByRole('log', { name: '통화 내용' })).toBeInViewport({ ratio: 1 });
  expect(
    await call
      .locator('.call-screen-content')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('connected-call-360.png') });
  await call.getByRole('button', { name: '통화 종료', exact: true }).tap();
  expect((await day(page)).callLog[0]).toMatchObject({
    caller: 'date',
    direction: 'outgoing',
    result: 'completed',
  });
});

test('옛 저장에 니시키가 있어도 다른 인물의 읽음과 장보기 진행을 보존한다', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'yaku-iphone.day.v1',
      JSON.stringify({
        ingredients: { potato: true, onion: false, meat: false, curry: false },
        reminders: { garden: true, mame: false },
        readThreads: ['nishiki', 'daigo'],
        replies: ['nishiki', 'daigo'],
        aiReplies: [],
        replySent: false,
        missedCall: false,
        missedCallRead: false,
        callStatus: null,
      }),
    ),
  );
  await boot(page);
  await launchHomeApp(page, 'messages');
  await expect(page.locator('[data-conversation=nishiki]')).toHaveCount(0);
  await expect(page.locator('[data-conversation=yuki]')).toBeVisible();
  await page.locator('[data-conversation=daigo]').tap();
  await expect(
    page.getByRole('button', { name: '혼자 모든 걸 떠안을 필요는 없다. 보내기', exact: true }),
  ).toBeVisible();
  await page.clock.runFor(1000);
  const state = await day(page);
  expect(state.ingredients.potato).toBe(true);
  expect(state.reminders.garden).toBe(true);
  expect(state.replies).toEqual(['daigo']);
});

test('비AI 답장은 홈 배너에서 하단으로 열리고 다른 채팅 안에서는 배너를 만들지 않는다', async ({
  page,
}, testInfo) => {
  await boot(page);
  await thread(page, 'daigo');
  await page
    .getByRole('button', { name: '네가 직접 보고 판단해라. 이야기는 듣겠다. 보내기', exact: true })
    .tap();
  await home(page);
  await page.clock.runFor(12_000);
  const banner = page.getByRole('status', { name: '새 이야기 메시지 도착', exact: true });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: '다이고의 새 메시지 알림 열기', exact: true }).tap();
  const log = page.getByRole('log', { name: '도지마 다이고와의 대화', exact: true });
  await expect(
    log.getByText('네. 먼저 제가 확인하겠습니다. 그 뒤에 말씀드리겠습니다.', { exact: true }),
  ).toBeVisible();
  expect(
    await log.evaluate(
      (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
    ),
  ).toBeLessThan(3);
  expect((await day(page)).readThreads).toContain('daigo');
  await expect(banner).toHaveCount(0);
  await back(page);
  await page.locator('[data-conversation=yuki]').tap();
  await page
    .getByRole('button', { name: '조금 있다 들르겠다. 무슨 일이지? 보내기', exact: true })
    .tap();
  await back(page);
  await page.locator('[data-conversation=daigo]').tap();
  await page.clock.runFor(12_000);
  await expect(banner).toHaveCount(0);
  expect((await day(page)).readThreads).not.toContain('yuki');
  await home(page);
  await expect(banner).toHaveCount(0);
  await page.keyboard.press('Alt+n');
  await page.getByRole('button', { name: '유키의 새 메시지 알림 열기', exact: true }).tap();
  await expect(page.getByRole('log', { name: '유키와의 대화' })).toContainText(
    '자리 배치를 조금 바꿨거든요. 한 번만 봐주세요!',
  );
  expect((await day(page)).readThreads).toContain('yuki');
  await page.screenshot({ path: testInfo.outputPath('yuki-conversation.png') });
  await page.reload();
  await unlockPhone(page);
  await expect(banner).toHaveCount(0);
});
