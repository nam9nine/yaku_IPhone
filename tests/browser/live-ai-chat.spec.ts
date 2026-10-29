import { installAiClock, finishAiReply, showAiTyping, settleAiRequests } from '../helpers/ai-clock';
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
  await installAiClock(page);
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
            status: 'complete',
            request_id: job.request.request_id,
            job_id: job.id,
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
  if (character === 'majima')
    await expect(page.locator('.message-ai-input textarea')).toBeVisible();
  else await expect(page.locator('.message-ai-input textarea')).toHaveCount(0);
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
  await openThread(page, 'majima');
  await input(page).fill('남겨둘 대화');
  await send(page).tap();
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '남겨둘 대화'))).toBeVisible();
  await input(page).fill('보내지 않은 초안');
  await page.reload();
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await openThread(page, 'majima');
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '남겨둘 대화'))).toBeVisible();
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
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '자동 연결 확인'))).toBeVisible();
  expect(mac.sessions).toBe(1);
  expect(mac.requests.every(({ url }) => url.startsWith(endpoint))).toBe(true);
});

test('서버가 꺼져도 연결 설정을 요구하지 않고 재시도로 복구한다', async ({ page }, testInfo) => {
  const mac = await mockMac(page);
  mac.unavailable = true;
  await start(page);
  await openThread(page, 'majima');
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  await input(page).fill('복구 후 전송할 초안');
  await expect(send(page)).toBeDisabled();
  await expect(page.getByLabel('접속 키')).toHaveCount(0);
  mac.unavailable = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).tap();
  await expect(send(page)).toBeEnabled();
  await expect(input(page)).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('retry-ready.png'), animations: 'disabled' });
  expect(mac.chats).toEqual([]);
  await send(page).tap();
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '복구 후 전송할 초안'))).toBeVisible();
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

test('마지마의 자유 입력과 한글 조합·줄바꿈을 처리하고 연속 전송을 한 번만 보낸다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  await start(page);
  for (let index = 0; index < 2; index++) {
    const character = 'majima' as const;
    await openThread(page, character);
    await input(page).fill(`${character}에게 인사 ${index + 1}`);
    await input(page).dispatchEvent('keydown', {
      key: 'Enter',
      keyCode: 229,
      isComposing: true,
      bubbles: true,
    });
    expect(mac.chats).toHaveLength(index);
    await input(page).press('End');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('다음 줄');
    const text = await input(page).inputValue();
    expect(text).toContain('\n다음 줄');
    await send(page).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await finishAiReply(page, character);
    await expect(bubble(page, replyFor(character, text))).toBeVisible();
    await expect(bubble(page, text)).toHaveCount(1);
    await expect(input(page)).toHaveValue('');
  }
  expect(mac.chats.map(({ character }) => character)).toEqual(['majima', 'majima']);
  expect(new Set(mac.chats.map(({ request_id }) => request_id)).size).toBe(2);
});

test('답장 대기 중 홈과 다른 대화로 이동해도 원래 대화에만 답장이 들어온다', async ({ page }) => {
  const mac = await mockMac(page);
  mac.hold.add('majima');
  await start(page);
  await openThread(page, 'majima');
  await input(page).fill('집에 돌아가고 있어');
  await send(page).tap();
  await expect(page.getByRole('status', { name: '마지마 답장 작성 중' })).toHaveCount(0);
  await showAiTyping(page, 'majima');
  await expect(page.locator('.message-typing')).toHaveCount(0);
  await expect(page.locator('.message-time').last()).toContainText('읽음');
  await home(page);
  await launchHomeApp(page, 'messages');
  await openThread(page, 'haruka');
  mac.hold.delete('majima');
  await settleAiRequests(page);
  await page.clock.fastForward(1000);
  await expect.poll(() => mac.history.majima.length).toBe(2);
  await expect(bubble(page, replyFor('majima', '집에 돌아가고 있어'))).toHaveCount(0);
  await openThread(page, 'majima');
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '집에 돌아가고 있어'))).toBeVisible();
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
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '저녁에 뵙겠습니다'))).toBeVisible();
  expect(mac.chats).toHaveLength(2);
  expect(mac.chats[1]).toEqual(mac.chats[0]);
  expect(mac.jobs.size).toBe(1);
  await expect(bubble(page, '저녁에 뵙겠습니다')).toHaveCount(1);
  await expect(bubble(page, replyFor('majima', '저녁에 뵙겠습니다'))).toHaveCount(1);
});

test('영구 입력 오류와 답변 길이 오류는 원문을 다시 작성해 새 요청으로 보낼 수 있다', async ({
  page,
}, testInfo) => {
  const mac = await mockMac(page);
  mac.rejectOnce = 422;
  await start(page);
  await openThread(page, 'majima');
  await expect(input(page)).toHaveAttribute('maxlength', '1000');
  await input(page).fill('원래 질문');
  await send(page).tap();
  await page.getByRole('button', { name: '다시 작성', exact: true }).tap();
  await expect(input(page)).toHaveValue('원래 질문');
  await expect(input(page)).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath('rewrite-restored.png'),
    animations: 'disabled',
  });
  await input(page).fill('수정한 질문');
  mac.failJobOnce = 'output_limit';
  await send(page).tap();
  await expect(page.getByText(/답장이 길이 한도 안에서 끝나지 않았습니다/)).toBeVisible();
  await expect(page.getByText('private-test-trace')).toHaveCount(0);
  await page.getByRole('button', { name: '다시 작성', exact: true }).tap();
  await expect(input(page)).toHaveValue('수정한 질문');
  await input(page).fill('짧은 질문');
  await send(page).tap();
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '짧은 질문'))).toBeVisible();
  expect(new Set(mac.chats.map(({ request_id }) => request_id)).size).toBe(3);
});

test('강제 선택 답장이 실패해도 다시 작성으로 편집·재전송하고 선택 완료를 중복 소비하지 않는다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  mac.history.majima = Array.from({ length: 3 }, (_, index): Message[] => [
    {
      id: `seed-${index}-user`,
      role: 'user',
      content: `이전 질문 ${index}`,
      time: null,
      status: 'complete',
      request_id: `seed-${index}`,
      job_id: `seed-job-${index}`,
    },
    {
      id: `seed-${index}-assistant`,
      role: 'assistant',
      content: `이전 답장 ${index}`,
      time: null,
      status: 'complete',
      request_id: `seed-${index}`,
      job_id: `seed-job-${index}`,
    },
  ]).flat();
  await start(page);
  await page.locator('[data-conversation=majima]').tap();
  const choice = page.getByRole('button', {
    name: `${replyChoices.majima.text} 보내기`,
    exact: true,
  });
  await expect(choice).toBeEnabled();
  await expect(input(page)).toHaveCount(0);
  mac.failJobOnce = 'generation_failed';
  await choice.click();
  await expect(
    page.getByText('답장을 만들지 못했습니다. 잠시 후 다시 보내 주세요.', { exact: true }),
  ).toBeVisible();
  const choiceHistory = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? '{}').storyChoiceHistory.majima,
      DAY_STORAGE_KEY,
    );
  expect(await choiceHistory()).toEqual([]);
  await page.getByRole('button', { name: '다시 작성', exact: true }).click();
  await expect(input(page)).toBeVisible();
  await expect(input(page)).toHaveValue(replyChoices.majima.text);
  await expect(input(page)).toBeFocused();
  const edited = '형님, 한 판 하기 전에 어디로 가면 될지 알려주세요.';
  await input(page).fill(edited);
  await send(page).click();
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', edited))).toBeVisible();
  expect(mac.chats).toHaveLength(2);
  expect(mac.chats[0].request_id).not.toBe(mac.chats[1].request_id);
  expect(await choiceHistory()).toEqual([]);
  // A rewritten free-text message must not consume the failed choice. Once the
  // next interlude is reached, a genuinely completed choice consumes it once.
  for (const message of ['첫 번째 후속 문자', '두 번째 후속 문자']) {
    await input(page).fill(message);
    await send(page).click();
    await finishAiReply(page, 'majima');
  }
  await expect(choice).toBeEnabled();
  await expect(input(page)).toHaveCount(0);
  await choice.click();
  await finishAiReply(page, 'majima');
  await expect.poll(choiceHistory).toEqual(['majima-1a']);
  await page.reload();
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await openThread(page, 'majima');
  await expect.poll(choiceHistory).toEqual(['majima-1a']);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? '{}').affinity,
      DAY_STORAGE_KEY,
    ),
  ).toBe(1);
  expect(mac.chats).toHaveLength(5);
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
  mac.history.majima = Array.from({ length: 3 }, (_, index): Message[] => [
    {
      id: `story-seed-${index}-user`,
      role: 'user',
      content: `이전 질문 ${index}`,
      time: null,
      status: 'complete',
      request_id: `story-seed-${index}`,
    },
    {
      id: `story-seed-${index}-assistant`,
      role: 'assistant',
      content: `이전 답장 ${index}`,
      time: null,
      status: 'complete',
      request_id: `story-seed-${index}`,
    },
  ]).flat();
  await start(page);
  await openThread(page, 'haruka');
  mac.rejectOnce = 503;
  await page.locator('.message-story-reply').first().tap();
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
  await finishAiReply(page, 'haruka');
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
  await page.locator('[data-conversation=majima]').tap();
  await expect(input(page)).toHaveCount(0);
  await page.locator('.message-story-reply').first().tap();
  await finishAiReply(page, 'majima');
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
  await finishAiReply(page, 'majima');
  await expect(bubble(page, replyFor('majima', '연결 후 전송'))).toBeVisible();
  expect(mac.chats).toHaveLength(1);
});

test('전송 터치를 취소하면 보내지 않고 터치·키보드 전송은 한 번씩만 처리한다', async ({
  page,
}, testInfo) => {
  const mac = await mockMac(page);
  await start(page);
  await openThread(page, 'majima');
  await input(page).fill('형님, 나중에 연락드리겠습니다.');
  await input(page).focus();
  await page.screenshot({ path: testInfo.outputPath('send-focused.png'), animations: 'disabled' });
  const button = (await send(page).boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await page.mouse.move(button.x - 70, button.y - 70);
  await page.mouse.up();
  expect(mac.chats).toHaveLength(0);
  await expect(input(page)).toHaveValue('형님, 나중에 연락드리겠습니다.');
  await send(page).tap();
  await expect.poll(() => mac.chats.length).toBe(1);
  await expect(input(page)).toBeFocused();
  await finishAiReply(page, 'majima');
  await input(page).fill('키보드로 다음 문자');
  // Safari's full keyboard navigation preference is outside this fixture.
  // Focus the native button as assistive navigation does, then activate by Enter.
  await send(page).focus();
  await expect(send(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => mac.chats.length).toBe(2);
  expect(mac.chats.map((chat) => chat.message)).toEqual([
    '형님, 나중에 연락드리겠습니다.',
    '키보드로 다음 문자',
  ]);
});

for (const width of [360, 390, 430]) {
  test(`${width}px에서 입력 중 전송 탭이 키보드 높이 변화로 유실되지 않는다`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const mac = await mockMac(page);
    await start(page);
    await openThread(page, 'majima');
    await input(page).fill('형님, 오늘은 잘 지내십니까?');
    await input(page).focus();
    // Desktop engines do not display the iOS keyboard. Model only its geometry:
    // losing text focus restores visualViewport height before pointerup.
    await input(page).evaluate((field) => {
      const viewport = window.visualViewport!;
      let height = 430;
      Object.defineProperty(viewport, 'height', { configurable: true, get: () => height });
      field.addEventListener('blur', () => {
        height = 844;
        viewport.dispatchEvent(new Event('resize'));
      });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect(send(page)).toBeEnabled();
    await expect(page.getByTestId('messages-app')).toHaveCSS('height', '430px');
    const button = (await send(page).boundingBox())!;
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.down();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.mouse.up();
    await expect.poll(() => mac.chats.length).toBe(1);
    expect(mac.chats[0].message).toBe('형님, 오늘은 잘 지내십니까?');
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();
    if (width === 390)
      await page.getByTestId('messages-app').screenshot({
        path: testInfo.outputPath('send-keyboard-geometry.png'),
        animations: 'disabled',
      });
  });

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
    await finishAiReply(page, 'majima');
    await expect(latest).toBeInViewport();
    await page.setViewportSize({ width, height: 800 });
    await input(page).focus();
    await page.setViewportSize({ width, height: 430 });
    await expect(latest).toBeInViewport();
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  });
}

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [390, 420],
  [430, 932],
]) {
  test(`긴 대화에서 전송·읽음·수신 시점의 하단과 대기 상태를 확인한다 ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const mac = await mockMac(page);
    mac.history.majima = Array.from({ length: 32 }, (_, index) => ({
      id: `scroll-history-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `지난 대화 ${index + 1}. 저녁 준비 이야기를 이어갑니다.`,
      time: '2026-10-25T00:00:00Z',
      status: 'complete',
    }));
    mac.hold.add('majima');
    await start(page);
    await openThread(page, 'majima');
    const log = page.locator('.message-history');
    const bottomGap = () => log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await input(page).fill('저녁 준비를 마쳤다.');
    await log.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await send(page).tap();
    await expect.poll(bottomGap).toBeLessThanOrEqual(1);
    await input(page).evaluate((el) => el.blur());
    await log.evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 80);
      el.dispatchEvent(new Event('scroll'));
    });
    await showAiTyping(page, 'majima');
    await expect(page.locator('.message-typing')).toHaveCount(0);
    await expect(page.locator('.message-time').last()).toContainText('읽음');
    await expect(
      page.getByText('답장 대기 중 · 다른 연락처에는 보낼 수 있어요.', { exact: true }),
    ).toBeVisible();
    mac.hold.delete('majima');
    await finishAiReply(page, 'majima');
    await expect.poll(bottomGap).toBeLessThanOrEqual(1);
    const latest = bubble(page, replyFor('majima', '저녁 준비를 마쳤다.'));
    await expect(latest).toBeInViewport();
    const visible = await latest.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const viewport = el.closest('.message-history')!.getBoundingClientRect();
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    });
    expect(visible).toBe(true);
  });
}

test('밖에서 받은 상단 알림은 저장된 과거 위치보다 최신 답장 하단으로 연다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  const mac = await mockMac(page);
  mac.history.majima = Array.from({ length: 32 }, (_, index) => ({
    id: `notify-history-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `지난 대화 ${index + 1}`,
    time: null,
    status: 'complete',
  }));
  mac.hold.add('majima');
  await start(page);
  await openThread(page, 'majima');
  await input(page).fill('알림에서 이 답장으로 돌아온다.');
  await send(page).tap();
  const log = page.locator('.message-history');
  await input(page).evaluate((el) => el.blur());
  await log.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await home(page);
  mac.hold.delete('majima');
  await finishAiReply(page, 'majima');
  const banner = page.locator('.ai-reply-banner');
  await expect(banner).toBeVisible();
  await banner.locator('.day-notification').tap();
  await expect(page.locator('.app-host:not([hidden]) .messages-app')).toBeVisible();
  await expect
    .poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(1);
  await expect(bubble(page, replyFor('majima', '알림에서 이 답장으로 돌아온다.'))).toBeInViewport();
  await page.screenshot({
    path: `harness/evidence/issue-99/notification-open-${test.info().project.name}.png`,
  });
});

for (const theme of ['dark', 'light'] as const) {
  test(`키보드 뷰포트에서는 입력창을 바로 붙이고 헤더는 흐린 플로팅 제어를 유지한다 ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await mockMac(page);
    await start(page);
    await openThread(page, 'majima');
    await input(page).fill('오늘 저녁에는 뭘 먹을까?');
    // Model a keyboard's visual viewport shrink; this is not a physical iOS keyboard.
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'height', {
        configurable: true,
        get: () => 480,
      });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('.mobile-shell')).toHaveAttribute('data-keyboard', 'true');
    const gap = await page
      .locator('.message-composer')
      .evaluate((el) => window.visualViewport!.height - el.getBoundingClientRect().bottom);
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: '답장 알림 설정' })).toBeVisible();
    await page.screenshot({
      path: `harness/evidence/issue-99/keyboard-${theme}-${test.info().project.name}.png`,
    });
    await page.evaluate(() => {
      delete (window.visualViewport as unknown as { height?: number }).height;
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('.mobile-shell')).toHaveAttribute('data-keyboard', 'false');
    await page.screenshot({
      path: `harness/evidence/issue-99/thread-${theme}-${test.info().project.name}.png`,
    });
  });
}

for (const mode of ['before-resize', 'resized-layout', 'standalone-offset'] as const) {
  test(`입력 폼 포커스는 키보드 감지 실패 때도 하단 여백을 제거한다 ${mode}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    if (mode === 'standalone-offset')
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
      });
    await mockMac(page);
    await start(page);
    await openThread(page, 'majima');
    // Keep a real home-indicator safe area even where keyboard height detection fails.
    await page
      .locator('.mobile-shell')
      .evaluate((el) => (el as HTMLElement).style.setProperty('--safe-area-bottom', '34px'));
    if (mode !== 'before-resize')
      await page.evaluate(
        (offset) => {
          Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 480 });
          Object.defineProperty(window.visualViewport!, 'height', {
            configurable: true,
            get: () => 480,
          });
          Object.defineProperty(window.visualViewport!, 'offsetTop', {
            configurable: true,
            get: () => offset,
          });
          window.visualViewport!.dispatchEvent(new Event('resize'));
        },
        mode === 'standalone-offset' ? 24 : 0,
      );
    await input(page).fill('입력창 아래 빈 공간 없이 보낸다.');
    await expect(page.locator('.mobile-shell')).toHaveAttribute('data-keyboard', 'false');
    const bottomGap = () =>
      page
        .locator('.message-ai-input')
        .evaluate(
          (el) =>
            window.visualViewport!.height +
            window.visualViewport!.offsetTop -
            el.getBoundingClientRect().bottom,
        );
    await expect.poll(bottomGap).toBeLessThanOrEqual(4);
    expect(await bottomGap()).toBeGreaterThanOrEqual(0);
    // Focus the send button too, without submitting a model request.
    await send(page).focus();
    await expect.poll(bottomGap).toBeLessThanOrEqual(4);
    await input(page).focus();
    const bounds = await page.locator('[data-app-window=messages]').boundingBox();
    await page.screenshot({
      path: `harness/evidence/issue-101/${mode}-${test.info().project.name}.png`,
      clip: bounds!,
    });
    // Closing/leaving the editor restores the existing gesture hit area.
    await input(page).evaluate((el) => el.blur());
    await expect(page.getByTestId('messages-home-gesture')).toBeVisible();
    expect(
      await page
        .getByTestId('messages-home-gesture')
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(44);
  });
}

test('다른 채팅방을 보고 있을 때는 상단 배너를 띄우지 않고 나가도 지난 배너를 되살리지 않는다', async ({
  page,
}) => {
  const mac = await mockMac(page);
  mac.hold.add('majima');
  await start(page);
  await openThread(page, 'majima');
  await input(page).fill('다른 방에서 답장을 기다린다.');
  await send(page).tap();
  await openThread(page, 'haruka');
  mac.hold.delete('majima');
  await finishAiReply(page, 'majima');
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).tap();
  await expect(page.locator('[data-conversation=majima] .message-unread')).toHaveAttribute(
    'data-unread',
    'true',
  );
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  await home(page);
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
});
