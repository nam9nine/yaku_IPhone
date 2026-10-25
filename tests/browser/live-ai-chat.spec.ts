import { expect, test, type Page, type Route } from '@playwright/test';
import { replyChoices } from '../../src/day/content';
import { DAY_STORAGE_KEY, dayReducer, initialDay } from '../../src/day/state';
import { launchHomeApp } from '../helpers/home';
import { unlockPhone } from '../helpers/unlock';

const endpoint = 'https://ai-test.example';
const token = 'test-session-token';
const inviteKey = 'test-invite-key';
type Character = 'haruka' | 'majima';
interface ChatRequest {
  character: Character;
  message: string;
  request_id: string;
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
}
interface Job {
  id: string;
  request: ChatRequest;
  error: string | null;
  finished: boolean;
}

async function mockMac(page: Page) {
  const state = {
    chats: [] as ChatRequest[],
    sessions: 0,
    requests: [] as { method: string; url: string; authorization?: string }[],
    hold: new Set<Character>(),
    loseResponseOnce: false,
    rejectOnce: 0,
    failJobOnce: null as string | null,
    history: { haruka: [], majima: [] } as Record<Character, Message[]>,
    jobs: new Map<string, Job>(),
  };
  async function json(route: Route, data: unknown, status = 200) {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: JSON.stringify(data),
    });
  }
  await page.route(`${endpoint}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return json(route, {}, 200);
    state.requests.push({
      method: request.method(),
      url: request.url(),
      authorization: request.headers().authorization,
    });
    if (url.pathname === '/v1/health') return json(route, { status: 'ready' });
    if (url.pathname === '/v1/sessions') {
      state.sessions += 1;
      expect(request.postDataJSON()).toEqual({ invite_key: inviteKey });
      expect(request.headers().authorization).toBeUndefined();
      return json(route, { token });
    }
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (url.pathname === '/v1/history') {
      const character = url.searchParams.get('character') as Character;
      const pending = [...state.jobs.values()].find(
        (job) => job.request.character === character && !job.finished,
      );
      return json(route, { messages: state.history[character], pending_job: pending?.id ?? null });
    }
    if (url.pathname === '/v1/chat') {
      const chat = request.postDataJSON() as ChatRequest;
      state.chats.push(chat);
      if (state.rejectOnce) {
        const status = state.rejectOnce;
        state.rejectOnce = 0;
        return json(route, { error: { code: 'test_rejected', message: 'test rejection' } }, status);
      }
      let job = state.jobs.get(chat.request_id);
      if (!job) {
        job = {
          id: `job-${state.jobs.size + 1}`,
          request: chat,
          error: state.failJobOnce,
          finished: false,
        };
        state.failJobOnce = null;
        state.jobs.set(chat.request_id, job);
      }
      if (state.loseResponseOnce) {
        state.loseResponseOnce = false;
        return route.abort('failed');
      }
      return json(route, { job_id: job.id, status: 'queued' }, 202);
    }
    if (url.pathname.startsWith('/v1/jobs/')) {
      const job = [...state.jobs.values()].find((candidate) => url.pathname.endsWith(candidate.id));
      if (!job) return json(route, {}, 404);
      const character = job.request.character;
      if (state.hold.has(character))
        return json(route, { job_id: job.id, character, status: 'generating' });
      if (!job.finished) {
        job.finished = true;
        if (!job.error) {
          state.history[character].push(
            {
              id: `${job.id}-user`,
              role: 'user',
              content: job.request.message,
              time: '2026-10-25T00:00:00Z',
            },
            {
              id: `${job.id}-assistant`,
              role: 'assistant',
              content: replyFor(character, job.request.message),
              time: '2026-10-25T00:00:01Z',
            },
          );
        }
      }
      return json(route, {
        job_id: job.id,
        character,
        status: job.error ? 'error' : 'complete',
        ...(job.error ? { error: { code: job.error, message: 'private-test-trace' } } : {}),
        messages: state.history[character],
      });
    }
    return json(route, {}, 404);
  });
  return state;
}

function replyFor(character: Character, message: string) {
  return `${character === 'haruka' ? '하루카' : '마지마'} 테스트 응답: ${message}`;
}
async function start(page: Page, fragment = '') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`./${fragment}`);
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
}
async function connect(page: Page) {
  await page.getByRole('button', { name: '편집', exact: true }).tap();
  await page.getByRole('button', { name: 'Mac 연결', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Mac 연결', exact: true });
  await dialog.getByLabel('Mac 서버 주소').fill(endpoint);
  await dialog.getByLabel('접속 키').fill(inviteKey);
  await dialog.getByRole('button', { name: '연결', exact: true }).tap();
  await expect(dialog).toBeHidden();
}
async function openThread(page: Page, character: Character) {
  const back = page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true });
  if (await back.isVisible()) await back.tap();
  await page.locator(`[data-conversation=${character}]`).tap();
  await expect(page.locator('.message-ai-input textarea')).toBeVisible();
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
}
async function home(page: Page) {
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
}
function input(page: Page) {
  return page.locator('.message-ai-input textarea');
}
function send(page: Page) {
  return page.getByRole('button', { name: '메시지 보내기', exact: true });
}
function bubble(page: Page, text: string) {
  return page.locator('.message-bubble').getByText(text, { exact: true });
}

test('초대 주소는 즉시 정리하고 명시적인 연결 전에는 서버 요청을 보내지 않는다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  await page.goto(`./#keep=yes&aiEndpoint=${encodeURIComponent(endpoint)}&aiInvite=${inviteKey}`);
  await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#keep=yes');
  expect(mac.requests).toEqual([]);
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  const dialog = page.getByRole('dialog', { name: 'Mac 연결', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('연결할 서버: ai-test.example', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('접속 키')).toHaveValue(inviteKey);
  expect(mac.sessions).toBe(0);
  expect(mac.requests).toEqual([]);
  await dialog.getByRole('button', { name: '연결', exact: true }).tap();
  await expect(dialog).toBeHidden();
  await openThread(page, 'haruka');
  expect(mac.sessions).toBe(1);
  expect(mac.chats).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('yaku-iphone.ai.connection.v1') ?? 'null'),
    ),
  ).toEqual({ endpoint, origin: endpoint, token });
  expect(mac.requests.every(({ url }) => !url.includes(token) && !url.includes(inviteKey))).toBe(
    true,
  );
});

test('두 인물의 자유 입력과 한글 조합·줄바꿈을 처리하고 연속 전송을 한 번만 보낸다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  await start(page);
  await connect(page);
  for (const character of ['haruka', 'majima'] as const) {
    await openThread(page, character);
    await input(page).fill(`${character}에게 인사`);
    await input(page).dispatchEvent('keydown', {
      key: 'Enter',
      keyCode: 229,
      isComposing: true,
      bubbles: true,
    });
    expect(mac.chats).toHaveLength(character === 'haruka' ? 0 : 1);
    await input(page).press('End');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('다음 줄');
    const text = await input(page).inputValue();
    expect(text).toContain('\n다음 줄');
    await send(page).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(bubble(page, replyFor(character, text))).toBeVisible();
    await expect(bubble(page, text)).toHaveCount(1);
    await expect(input(page)).toHaveValue('');
  }
  expect(mac.chats.map(({ character }) => character)).toEqual(['haruka', 'majima']);
  expect(new Set(mac.chats.map(({ request_id }) => request_id)).size).toBe(2);
});

test('답장 대기 중 홈과 다른 대화로 이동해도 원래 대화에만 답장이 들어온다', async ({ page }) => {
  const mac = await mockMac(page);
  mac.hold.add('haruka');
  await start(page);
  await connect(page);
  await openThread(page, 'haruka');
  await input(page).fill('집에 돌아가고 있어');
  await send(page).tap();
  await expect(page.getByRole('status', { name: '하루카 답장 작성 중' })).toBeVisible();
  await home(page);
  await launchHomeApp(page, 'messages');
  await openThread(page, 'majima');
  mac.hold.delete('haruka');
  await expect.poll(() => mac.history.haruka.length).toBe(2);
  await expect(bubble(page, replyFor('haruka', '집에 돌아가고 있어'))).toHaveCount(0);
  await openThread(page, 'haruka');
  await expect(bubble(page, replyFor('haruka', '집에 돌아가고 있어'))).toBeVisible();
  await expect(bubble(page, '집에 돌아가고 있어')).toHaveCount(1);
  expect(mac.chats).toHaveLength(1);
});

test('서버가 수락한 POST 응답이 유실되어도 같은 요청으로 재시도해 답장을 중복하지 않는다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  mac.loseResponseOnce = true;
  await start(page);
  await connect(page);
  await openThread(page, 'majima');
  await input(page).fill('저녁에 뵙겠습니다');
  await send(page).tap();
  await expect(
    page.getByText('Mac에 연결할 수 없습니다. 서버와 인터넷 연결을 확인해 주세요.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: '다시 시도', exact: true }).tap();
  await expect(bubble(page, replyFor('majima', '저녁에 뵙겠습니다'))).toBeVisible();
  expect(mac.chats).toHaveLength(2);
  expect(mac.chats[1]).toEqual(mac.chats[0]);
  expect(mac.jobs.size).toBe(1);
  await expect(bubble(page, '저녁에 뵙겠습니다')).toHaveCount(1);
  await expect(bubble(page, replyFor('majima', '저녁에 뵙겠습니다'))).toHaveCount(1);
});

test('영구 입력 오류와 답변 길이 오류는 원문을 다시 작성해 새 요청으로 보낼 수 있다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  mac.rejectOnce = 422;
  await start(page);
  await connect(page);
  await openThread(page, 'haruka');
  await expect(input(page)).toHaveAttribute('maxlength', '1000');
  await input(page).fill('원래 질문');
  await send(page).tap();
  await page.getByRole('button', { name: '다시 작성', exact: true }).tap();
  await expect(input(page)).toHaveValue('원래 질문');
  await input(page).fill('수정한 질문');
  mac.failJobOnce = 'output_limit';
  await send(page).tap();
  await expect(page.getByText(/답장이 길이 한도 안에서 끝나지 않았습니다/)).toBeVisible();
  await expect(page.getByText('private-test-trace')).toHaveCount(0);
  await page.getByRole('button', { name: '다시 작성', exact: true }).tap();
  await expect(input(page)).toHaveValue('수정한 질문');
  await input(page).fill('짧은 질문');
  await send(page).tap();
  await expect(bubble(page, replyFor('haruka', '짧은 질문'))).toBeVisible();
  expect(new Set(mac.chats.map(({ request_id }) => request_id)).size).toBe(3);
});

test('장보기와 마지마 스토리 답장도 모델에 전송하고 오류를 고정 답변으로 대체하지 않는다', async ({
  page,
}) => {
  let day = initialDay();
  for (const id of ['potato', 'onion', 'meat', 'curry'] as const)
    day = dayReducer(day, { type: 'ingredient', id, done: true });
  day = dayReducer(day, { type: 'miss-call' });
  await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), {
    key: DAY_STORAGE_KEY,
    state: { ...day, aiReplies: [] },
  });
  const mac = await mockMac(page);
  await start(page);
  await connect(page);
  await openThread(page, 'haruka');
  mac.rejectOnce = 503;
  await page.locator('.message-story-reply').tap();
  await expect(
    page.getByText('Mac의 모델이 준비되지 않았습니다. 서버 상태를 확인해 주세요.', { exact: true }),
  ).toBeVisible();
  await expect(bubble(page, replyChoices.haruka.response)).toHaveCount(0);
  expect(mac.chats[0].message).toBe(replyChoices.haruka.text);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? '{}').replySent,
      DAY_STORAGE_KEY,
    ),
  ).toBe(false);
  await page.getByRole('button', { name: '다시 시도', exact: true }).tap();
  await expect(bubble(page, replyFor('haruka', replyChoices.haruka.text))).toBeVisible();
  await expect(bubble(page, replyChoices.haruka.text)).toHaveCount(1);
  await expect(bubble(page, replyChoices.haruka.response)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '{}').replySent,
        DAY_STORAGE_KEY,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).tap();
  await page.getByRole('button', { name: '편집', exact: true }).tap();
  await page.getByRole('button', { name: 'Mac 연결', exact: true }).tap();
  await page.getByRole('button', { name: '연결 해제', exact: true }).tap();
  await page.locator('[data-conversation=haruka]').tap();
  await expect(bubble(page, replyChoices.haruka.response)).toHaveCount(0);
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).tap();
  await connect(page);
  await openThread(page, 'majima');
  await page.locator('.message-story-reply').tap();
  await expect(bubble(page, replyFor('majima', replyChoices.majima.text))).toBeVisible();
  await expect(bubble(page, replyChoices.majima.response)).toHaveCount(0);
  expect(mac.chats.at(-1)?.message).toBe(replyChoices.majima.text);
});

test('가상 오프라인에서는 전송을 막고 복구 후 보낸 뒤 접속 정보를 삭제할 수 있다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  await start(page);
  await connect(page);
  await openThread(page, 'majima');
  await home(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('switch', { name: '에어플레인 모드', exact: true }).check();
  await home(page);
  await launchHomeApp(page, 'messages');
  await input(page).fill('연결 후 전송');
  await expect(send(page)).toBeDisabled();
  expect(mac.chats).toEqual([]);
  await home(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('switch', { name: '에어플레인 모드', exact: true }).uncheck();
  await page.getByRole('button', { name: /Wi-Fi/ }).tap();
  await page.getByRole('switch', { name: 'Wi-Fi', exact: true }).check();
  await home(page);
  await launchHomeApp(page, 'messages');
  await expect(send(page)).toBeEnabled();
  await send(page).tap();
  await expect(bubble(page, replyFor('majima', '연결 후 전송'))).toBeVisible();
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).tap();
  await page.getByRole('button', { name: '편집', exact: true }).tap();
  await page.getByRole('button', { name: 'Mac 연결', exact: true }).tap();
  await page.getByRole('button', { name: '연결 해제', exact: true }).tap();
  expect(
    await page.evaluate(() => localStorage.getItem('yaku-iphone.ai.connection.v1')),
  ).toBeNull();
  await page.locator('[data-conversation=majima]').tap();
  await expect(page.locator('.message-choice')).toBeVisible();
  await expect(input(page)).toHaveCount(0);
  expect(mac.chats).toHaveLength(1);
});

for (const width of [360, 390, 430]) {
  test(`${width}px와 키보드 상당 축소 높이에서 입력·전송 버튼이 잘리지 않는다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockMac(page);
    await start(page);
    await connect(page);
    await openThread(page, 'majima');
    await input(page).fill('여러 줄 메시지\n'.repeat(12).trim());
    const field = await input(page).boundingBox();
    const button = await send(page).boundingBox();
    expect(field?.height).toBeLessThanOrEqual(120);
    expect(button?.width).toBeGreaterThanOrEqual(44);
    expect(button?.height).toBeGreaterThanOrEqual(44);
    await page.setViewportSize({ width, height: 430 });
    await expect(input(page)).toBeInViewport();
    await expect(send(page)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await input(page).fill('작은 화면에서 전송');
    await send(page).tap();
    const latest = bubble(page, replyFor('majima', '작은 화면에서 전송'));
    await expect(latest).toBeInViewport();
    await page.setViewportSize({ width, height: 800 });
    await input(page).focus();
    await page.setViewportSize({ width, height: 430 });
    await expect(latest).toBeInViewport();
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  });
}
