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

function phoneEventPosts(page: Page) {
  const posts: { character: string; events: unknown }[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/v1/chat') return;
    const body = request.postDataJSON();
    posts.push({ character: body.character, events: body.phone_events });
  });
  return posts;
}

test('선택형 문자는 인물별로 기다리고 세 왕복 뒤 끝난다', async ({ page }) => {
  await boot(page);
  await thread(page, 'daigo');
  await page
    .getByRole('button', { name: '네가 직접 보고 판단해라. 이야기는 듣겠다. 보내기', exact: true })
    .tap();
  await expect(page.getByText('답장 대기 중', { exact: true })).toBeVisible();
  await expect(
    page.getByText('네. 먼저 제가 확인하겠습니다. 그 뒤에 말씀드리겠습니다.', { exact: true }),
  ).toHaveCount(0);
  await back(page);
  await page.locator('[data-conversation=ichiban]').tap();
  await expect(page.locator('.message-story-reply')).toHaveCount(0);
  expect(Object.keys((await day(page)).storyPending)).toEqual(['daigo']);
  await page.clock.runFor(30_000);
  await back(page);
  await page.locator('[data-conversation=daigo]').tap();
  await expect(
    page.getByText('네. 먼저 제가 확인하겠습니다. 그 뒤에 말씀드리겠습니다.', { exact: true }),
  ).toBeVisible();
  for (const choice of ['혼자 모든 걸 떠안을 필요는 없다.', '그래. 기다리마.']) {
    await page.getByRole('button', { name: `${choice} 보내기`, exact: true }).tap();
    await page.clock.runFor(30_000);
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
  const posts = phoneEventPosts(page);
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
  expect(posts).toEqual([
    { character: 'haruka', events: ['haruka-garden-checked'] },
    { character: 'majima', events: [] },
  ]);
});

test('마지마는 세 답장 뒤에도 문맥에 맞게 자유 입력하고 고정 선택을 강요하지 않는다', async ({
  page,
}) => {
  await boot(page);
  await thread(page, 'majima');
  for (const text of [
    '지금은 만나고 싶지 않습니다.',
    '오늘은 혼자 있고 싶습니다.',
    '나중에 제가 먼저 연락드리겠습니다.',
  ]) {
    await page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }).fill(text);
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
    await finishAiReply(page, 'majima');
  }
  await expect(
    page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.message-story-reply')).toHaveCount(0);
  await expect(
    page.getByText('형님, 카무로쵸로 갈 생각입니다. 도착하면 연락드리겠습니다.', { exact: true }),
  ).toHaveCount(0);
});

test('사용 시간이 지나면 수신하고 거절 뒤 고정 문자를 만들지 않으며 다른 인물에게 발신한다', async ({
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
  expect((await day(page)).storyMessages.majima).toEqual([]);
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
  await expect(page.locator('[data-conversation=ichiban]')).toBeVisible();
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
  const waiting = await day(page);
  await page.clock.runFor(waiting.storyPending.daigo.deliverAt - waiting.elapsedMs + 1);
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
  await page.screenshot({ path: testInfo.outputPath('daigo-delivery.png') });
});

test('AI 대화 뒤 전화 후속 문자는 배너에서 마지막에 보이고 다음 AI 답장은 그 뒤에 이어진다', async ({
  page,
}, testInfo) => {
  const posts = phoneEventPosts(page);
  await boot(page);
  await thread(page, 'majima');
  const first = '형님, 먼저 보내주신 문자는 봤습니다.';
  const second = '방금 전화는 제가 잘못 눌렀습니다.';
  const reply = '검증용 마지마 답장';
  await page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }).fill(first);
  await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
  await finishAiReply(page, 'majima');
  await expect(
    page.getByRole('log', { name: '마지마 고로와의 대화' }).locator('.message-bubble').last(),
  ).toHaveText(reply);
  await home(page);
  await launchHomeApp(page, 'phone');
  await page.getByRole('button', { name: '마지마 고로에게 전화', exact: true }).tap();
  await page.getByRole('button', { name: '발신 취소', exact: true }).tap();
  const followup = (await day(page)).storyMessages.majima.at(-1).text;
  const banner = page.getByRole('status', { name: '새 이야기 메시지 도착', exact: true });
  await banner.getByRole('button', { name: '마지마의 새 메시지 알림 열기', exact: true }).tap();
  const log = page.getByRole('log', { name: '마지마 고로와의 대화', exact: true });
  await expect(log.locator('.message-bubble').last()).toHaveText(followup);
  await expect(log.locator('.message-bubble').last()).toBeInViewport();
  expect(
    await log.evaluate(
      (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
    ),
  ).toBeLessThan(3);
  await page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }).fill(second);
  await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
  await finishAiReply(page, 'majima');
  await expect(log.locator('.message-bubble').last()).toHaveText(reply);
  expect((await log.locator('.message-bubble').allTextContents()).slice(-5)).toEqual([
    first,
    reply,
    followup,
    second,
    reply,
  ]);
  expect(posts).toEqual([
    { character: 'majima', events: [] },
    { character: 'majima', events: ['majima-call-declined'] },
  ]);
  await page.screenshot({ path: testInfo.outputPath('mixed-message-order.png') });
  await page.reload();
  await unlockPhone(page);
  await thread(page, 'majima');
  await expect(log.locator('.message-bubble')).toHaveCount(9);
  expect((await log.locator('.message-bubble').allTextContents()).slice(-5)).toEqual([
    first,
    reply,
    followup,
    second,
    reply,
  ]);
});

test('택시 목적지 선택은 키류의 문자나 통화를 자동 생성하지 않는다', async ({ page }) => {
  await boot(page);
  await launchHomeApp(page, 'taxi');
  await page.getByRole('button', { name: /카무로쵸/ }).tap();
  await expect(page.getByRole('button', { name: '마지마 형님에게 목적지 알리기' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '마지마 형님 전화 수신' })).toHaveCount(0);
  expect((await day(page))?.storyMessages.majima ?? []).toEqual([]);
});

test('마지마가 먼저 문자하고 다시 접속해도 같은 문자를 재발송하지 않는다', async ({ page }) => {
  await boot(page);
  await page.clock.runFor(60_000);
  await page.getByRole('button', { name: '전화 거절', exact: true }).tap();
  await finishAiReply(page, 'majima');
  await page.clock.runFor(60_000);
  expect((await day(page)).storyMessages.majima.at(-1).text).toBe('키류쨩! 폰은 살아 있나?');
  await thread(page, 'majima');
  await expect(page.getByText('키류쨩! 폰은 살아 있나?', { exact: true })).toHaveCount(1);
  await page.reload();
  await unlockPhone(page);
  await thread(page, 'majima');
  await expect(page.getByText('키류쨩! 폰은 살아 있나?', { exact: true })).toHaveCount(1);
  expect((await day(page)).majimaCheckInsSent).toBe(1);
});
