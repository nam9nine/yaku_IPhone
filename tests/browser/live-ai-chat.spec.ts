import { expect, test, type Page, type Route } from '@playwright/test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { replyChoices } from '../../src/day/content';
import { DAY_STORAGE_KEY, dayReducer, initialDay } from '../../src/day/state';
import { launchHomeApp } from '../helpers/home';
import { unlockPhone } from '../helpers/unlock';

const endpoint = AI_ENDPOINT;
const token = 'test-session-token';
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
  time: string | null;
  status?: string;
  request_id?: string;
  job_id?: string;
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
    unavailable: false,
    expireOnce: false,
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
    if (state.unavailable) return json(route, {}, 503);
    if (url.pathname === '/v1/health') return json(route, { status: 'ready' });
    if (url.pathname === '/v1/sessions') {
      state.sessions += 1;
      expect(request.postDataJSON()).toEqual({});
      expect(request.headers().authorization).toBeUndefined();
      return json(route, { token });
    }
    if (state.expireOnce) {
      state.expireOnce = false;
      return json(route, {}, 401);
    }
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (url.pathname === '/v1/history') {
      const character = url.searchParams.get('character') as Character;
      const pending = [...state.jobs.values()].find(
        (job) => job.request.character === character && !job.finished,
      );
      const older = url.searchParams.has('cursor');
      return json(route, {
        messages: older
          ? state.history[character].slice(0, -50)
          : state.history[character].slice(-50),
        pending_job: pending?.id ?? null,
        next_cursor: !older && state.history[character].length > 50 ? 'older-page' : null,
      });
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
        state.history[chat.character].push({
          id: `${job.id}-user`,
          role: 'user',
          content: chat.message,
          time: '2026-10-25T00:00:00Z',
          status: 'queued',
          request_id: chat.request_id,
          job_id: job.id,
        });
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
      const requestMeta = {
        id: job.request.request_id,
        message: job.request.message,
        time: '2026-10-25T00:00:00Z',
      };
      if (state.hold.has(character))
        return json(route, {
          job_id: job.id,
          character,
          status: 'generating',
          request: requestMeta,
        });
      if (!job.finished) {
        job.finished = true;
        const accepted = state.history[character].find(
          (message) => message.id === `${job.id}-user`,
        )!;
        accepted.status = job.error ? 'error' : 'complete';
        if (!job.error) {
          state.history[character].push({
            id: `${job.id}-assistant`,
            role: 'assistant',
            content: replyFor(character, job.request.message),
            time: '2026-10-25T00:00:01Z',
          });
        }
      }
      return json(route, {
        job_id: job.id,
        character,
        status: job.error ? 'error' : 'complete',
        request: requestMeta,
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

test('기존 주소와 오래된 초대 주소 모두 설정 없이 열며 AI 연락처에서만 자동 연결한다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  await page.goto('./#keep=yes&aiEndpoint=https%3A%2F%2Fevil.example&aiInvite=discarded');
  expect(new URL(page.url()).hash).toBe('#keep=yes');
  expect(mac.requests).toEqual([]);
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  expect(mac.requests).toEqual([]);
  await expect(page.getByRole('button', { name: 'Mac 연결', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Mac 연결', exact: true })).toHaveCount(0);
  await openThread(page, 'haruka');
  await expect(page.getByText('대화는 서비스 개선을 위해 저장됩니다', { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('이전 대화', { exact: true })).toHaveCount(0);
  await expect.poll(() => mac.sessions).toBe(1);
  expect(mac.chats).toEqual([]);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yaku-iphone.ai.session.v2') ?? 'null'),
  );
  expect(saved).toEqual({ service: 'kiryu-character-chat-v2', token, resetId: null });
  expect(mac.requests.every(({ url }) => url.startsWith(endpoint) && !url.includes(token))).toBe(
    true,
  );
});

test('새로고침 후 같은 토큰과 기록을 복원하며 초안은 전송하지 않는다', async ({ page }) => {
  const mac = await mockMac(page);
  await start(page);
  await openThread(page, 'haruka');
  await input(page).fill('남겨둘 대화');
  await send(page).tap();
  await expect(bubble(page, replyFor('haruka', '남겨둘 대화'))).toBeVisible();
  await input(page).fill('보내지 않은 초안');
  await page.reload();
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await openThread(page, 'haruka');
  await expect(bubble(page, replyFor('haruka', '남겨둘 대화'))).toBeVisible();
  expect(mac.sessions).toBe(1);
  expect(mac.chats).toHaveLength(1);
});

test('구 토큰은 고정 API에서 확인하고 만료됐으면 익명 세션을 한 번 갱신한다', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'yaku-iphone.ai.connection.v1',
      JSON.stringify({ endpoint: 'https://untrusted.example', token: 'expired-token' }),
    ),
  );
  const mac = await mockMac(page);
  mac.expireOnce = true;
  await start(page);
  await openThread(page, 'majima');
  await input(page).fill('자동 연결 확인');
  await send(page).tap();
  await expect(bubble(page, replyFor('majima', '자동 연결 확인'))).toBeVisible();
  expect(mac.sessions).toBe(1);
  expect(mac.requests.every(({ url }) => url.startsWith(endpoint))).toBe(true);
});

test('서버가 꺼져도 연결 설정을 요구하지 않고 재시도로 복구한다', async ({ page }) => {
  const mac = await mockMac(page);
  mac.unavailable = true;
  await start(page);
  await openThread(page, 'haruka');
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  await input(page).fill('복구 후 전송할 초안');
  await expect(send(page)).toBeDisabled();
  await expect(page.getByLabel('접속 키')).toHaveCount(0);
  mac.unavailable = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).tap();
  await expect(send(page)).toBeEnabled();
  expect(mac.chats).toEqual([]);
  await send(page).tap();
  await expect(bubble(page, replyFor('haruka', '복구 후 전송할 초안'))).toBeVisible();
});

test('이전 대화를 추가해도 중복하거나 오래된 null 시간을 새 날짜로 만들지 않는다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  mac.history.haruka = Array.from({ length: 56 }, (_, i) => ({
    id: `past-${i}`,
    role: i % 2 ? 'assistant' : 'user',
    content: `저장된 문자 ${i}`,
    time: null,
    status: 'complete',
  }));
  await start(page);
  await openThread(page, 'haruka');
  await expect(bubble(page, '저장된 문자 55')).toBeVisible();
  await page.getByRole('button', { name: '이전 대화 더 보기', exact: true }).tap();
  await expect(bubble(page, '저장된 문자 0')).toHaveCount(1);
  await expect(bubble(page, '저장된 문자 55')).toHaveCount(1);
  await expect(page.locator('.message-ai-date')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이전 대화 더 보기', exact: true })).toHaveCount(0);
});

test('두 인물의 자유 입력과 한글 조합·줄바꿈을 처리하고 연속 전송을 한 번만 보낸다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  await start(page);
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
  await openThread(page, 'majima');
  await input(page).fill('저녁에 뵙겠습니다');
  await send(page).tap();
  await expect(
    page.getByText('지금은 대화에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', {
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
  await openThread(page, 'haruka');
  mac.rejectOnce = 503;
  await page.locator('.message-story-reply').tap();
  await expect(
    page.getByText('지금은 답장을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.', { exact: true }),
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
  await openThread(page, 'majima');
  await page.locator('.message-story-reply').tap();
  await expect(bubble(page, replyFor('majima', replyChoices.majima.text))).toBeVisible();
  await expect(bubble(page, replyChoices.majima.response)).toHaveCount(0);
  expect(mac.chats.at(-1)?.message).toBe(replyChoices.majima.text);
});

test('가상 오프라인에서는 전송을 막고 복구해도 초안을 자동으로 보내지 않는다', async ({ page }) => {
  const mac = await mockMac(page);
  await start(page);
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
  expect(mac.chats).toHaveLength(1);
});

for (const width of [360, 390, 430]) {
  test(`${width}px와 키보드 상당 축소 높이에서 입력·전송 버튼이 잘리지 않는다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockMac(page);
    await start(page);
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
