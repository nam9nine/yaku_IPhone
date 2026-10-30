import { expect, test } from '@playwright/test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { AI_PRESENTATION_KEY } from '../../src/ai/presentation';
import { CONVERSATION_REST_MS } from '../../src/ai/chatPacing';
import { DAY_STORAGE_KEY, dayReducer, initialDay } from '../../src/day/state';
import { replyChoices } from '../../src/day/content';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';

type Character = 'haruka' | 'majima';
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  status: 'complete';
  request_id: string;
  job_id: string;
};

test('선택 소진 후 12번째 성공 대화는 45초만 쉬며 다른 연락처·만료 뒤 재방문을 막지 않는다', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const day = dayReducer(
    dayReducer(initialDay(), { type: 'reminder', id: 'shopping', done: true }),
    { type: 'miss-call', reason: 'declined' },
  );
  // Exercise conversation pacing after a settled quest call, without unrelated generated followups.
  day.pendingCallFollowups = [];
  day.storyChoiceHistory.majima = ['majima-1a', 'majima-2a', 'majima-3a'];
  await page.addInitScript(
    ({ key, state }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    },
    { key: DAY_STORAGE_KEY, state: day },
  );
  await page.clock.install({ time: new Date('2026-10-29T03:00:00Z') });
  const histories: Record<Character, Message[]> = { haruka: [], majima: [] };
  const jobs = new Map<string, { character: Character; message: string; request_id: string }>();
  let lastReplyAt = 0;
  await page.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let data: unknown;
    if (req.method() === 'OPTIONS') data = {};
    else if (url.pathname === '/v1/health') data = { status: 'ready' };
    else if (url.pathname === '/v1/sessions') data = { token: 'pacing-session' };
    else if (url.pathname === '/v1/history') {
      const character = url.searchParams.get('character') as Character;
      if (character === 'majima' && !lastReplyAt) {
        lastReplyAt = await page.evaluate(() => Date.now());
        histories.majima = Array.from({ length: 12 }, (_, index): Message[] => [
          {
            id: `past-${index}-u`,
            role: 'user',
            content: `이전 질문 ${index}`,
            time: new Date(lastReplyAt - (11 - index) * 2000 - 1000).toISOString(),
            status: 'complete',
            request_id: `past-${index}`,
            job_id: `past-job-${index}`,
          },
          {
            id: `past-${index}-a`,
            role: 'assistant',
            content: `이전 답장 ${index}`,
            time: new Date(lastReplyAt - (11 - index) * 2000).toISOString(),
            status: 'complete',
            request_id: `past-${index}`,
            job_id: `past-job-${index}`,
          },
        ]).flat();
      }
      data = { messages: histories[character], pending_job: null, next_cursor: null };
    } else if (url.pathname === '/v1/chat') {
      const body = req.postDataJSON();
      jobs.set(body.request_id, body);
      const acceptedAt = await page.evaluate(() => Date.now());
      histories[body.character as Character].push(
        {
          id: `${body.request_id}-u`,
          role: 'user',
          content: body.message,
          time: new Date(acceptedAt).toISOString(),
          status: 'complete',
          request_id: body.request_id,
          job_id: body.request_id,
        },
        {
          id: `${body.request_id}-a`,
          role: 'assistant',
          content: `${body.character} 새 답장`,
          time: new Date(acceptedAt + 1).toISOString(),
          status: 'complete',
          request_id: body.request_id,
          job_id: body.request_id,
        },
      );
      data = { job_id: body.request_id, status: 'queued' };
    } else if (url.pathname.startsWith('/v1/jobs/')) {
      const job = jobs.get(url.pathname.split('/').at(-1)!)!;
      const user = histories[job.character].find((item) => item.request_id === job.request_id)!;
      data = {
        job_id: job.request_id,
        character: job.character,
        status: 'complete',
        request: { id: job.request_id, message: job.message, time: user.time },
      };
    } else throw new Error(`Unexpected mock request ${url.pathname}`);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(data),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  });
  await page.goto('./');
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
  const input = page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true });
  const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
  const rest = page.getByText('잠시 대기 중', {
    exact: true,
  });
  await input.fill('휴식 후 보낼 문자');
  await expect(send).toBeDisabled();
  await expect(rest).toBeVisible();
  await expect(page.locator('.message-choice-list')).toHaveCount(0);
  expect(CONVERSATION_REST_MS).toBe(45_000);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).click();
  await page.locator('[data-conversation=haruka]').tap();
  const harukaChoice = page.getByRole('button', {
    name: `${replyChoices.haruka.text} 보내기`,
    exact: true,
  });
  await expect(harukaChoice).toBeEnabled();
  await expect(rest).toHaveCount(0);
  await harukaChoice.click();
  await expect.poll(() => [...jobs.values()].map((job) => job.character)).toEqual(['haruka']);
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) ?? '{}').receipts?.some(
            (receipt: { character: string; replyId?: string }) =>
              receipt.character === 'haruka' && !!receipt.replyId,
          ),
        AI_PRESENTATION_KEY,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).click();
  await page.locator('[data-conversation=majima]').tap();
  await expect(input).toHaveValue('휴식 후 보낼 문자');
  await expect(send).toBeDisabled();
  const remaining = lastReplyAt + CONVERSATION_REST_MS - (await page.evaluate(() => Date.now()));
  expect(remaining).toBeGreaterThan(0);
  await page.clock.fastForward(remaining - 1);
  await expect(send).toBeDisabled();
  await page.clock.runFor(1);
  await expect(send).toBeEnabled();
  await expect(rest).toHaveCount(0);
  // Reload must use the already expired completion time, not start another rest.
  await page.clock.resume();
  await page.reload();
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
  await input.fill('다시 접속해도 보낼 수 있다.');
  await expect(send).toBeEnabled();
  await expect(rest).toHaveCount(0);
  await send.click();
  await expect
    .poll(() => [...jobs.values()].map((job) => job.character))
    .toEqual(['haruka', 'majima']);
  await expect
    .poll(() => histories.majima.filter((message) => message.role === 'user').length)
    .toBe(13);
});
