import { expect, test } from '../helpers/browser-test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';
import { typingDelay } from '../../src/ai/presentation';

test('빠른 답장은 랜덤 대기 뒤 읽음이 되고 홈에서는 배너·읽지 않은 표시로 도착한다', async ({
  page,
}) => {
  let requestId = '';
  let message = '';
  await page.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let result: unknown = {};
    if (req.method() === 'OPTIONS') result = {};
    else if (url.pathname === '/v1/health') result = { status: 'ready' };
    else if (url.pathname === '/v1/sessions') result = { token: 'notification-fixture' };
    else if (url.pathname === '/v1/chat') {
      requestId = req.postDataJSON().request_id;
      message = req.postDataJSON().message;
      result = { job_id: requestId, status: 'queued' };
    } else if (url.pathname.startsWith('/v1/jobs/'))
      result = {
        job_id: requestId,
        character: 'majima',
        status: 'complete',
        request: { id: requestId, message, time: '2026-10-26T00:00:00Z' },
      };
    else if (url.pathname === '/v1/history')
      result = {
        messages: requestId
          ? [
              {
                id: 'user',
                role: 'user',
                content: message,
                request_id: requestId,
                job_id: requestId,
                time: '2026-10-26T00:00:00Z',
                status: 'complete',
              },
              {
                id: 'assistant',
                role: 'assistant',
                content: '오늘은 우동으로 할게요.',
                job_id: requestId,
                time: '2026-10-26T00:00:01Z',
                status: 'complete',
                request_id: requestId,
              },
            ]
          : [],
        pending_job: null,
        next_cursor: null,
      };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(result),
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
  const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
  await page.locator('.message-ai-input textarea').fill('저녁은 우동이 좋아.');
  await expect(send).toBeEnabled();
  // Set one clock origin and pause in its future before sending; host/browser RPC time differs.
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 10_000);
  await page.locator('.message-ai-input textarea').fill('저녁은 우동이 좋아.');
  await send.click();
  await expect.poll(() => requestId).not.toBe('');
  await expect(page.locator('.message-time').last()).toContainText('09:00');
  await expect(page.getByText('오늘은 우동으로 할게요.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: '마지마 답장 작성 중' })).toHaveCount(0);
  await page.clock.runFor(typingDelay(requestId) - 1);
  await expect(page.getByRole('status', { name: '마지마 답장 작성 중' })).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(page.locator('.message-typing')).toHaveCount(0);
  await expect(page.locator('.message-time').last()).toContainText('읽음');
  await page.screenshot({ path: 'test-results/reply84-typing.png', animations: 'disabled' });
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  await page.clock.runFor(1600);

  await expect(page.getByRole('region', { name: '새 메시지 도착' })).toHaveCount(0); // status, not a second modal
  const banner = page.locator('.ai-reply-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('오늘은 우동으로 할게요.');
  await page.screenshot({ path: 'test-results/reply84-banner.png', animations: 'disabled' });
  await banner.getByRole('button', { name: '마지마의 새 메시지 알림 열기' }).click();
  await page.clock.runFor(500);
  await expect(page.locator('.message-bubble').getByText('오늘은 우동으로 할게요.')).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.getByRole('button', { name: '답장 알림 설정' }).click();
  await page.screenshot({ path: 'test-results/reply84-push-settings.png', animations: 'disabled' });
  await expect(page.getByRole('region', { name: '답장 알림', exact: true })).toBeVisible();
});
