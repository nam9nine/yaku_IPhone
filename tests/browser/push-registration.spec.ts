import { expect, test } from '@playwright/test';
import { AI_ENDPOINT } from '../../src/ai/config';

test.use({ serviceWorkers: 'allow' });
test('푸시 전용 워커와 manifest가 저장소 경로에 등록되며 권한·AI 요청을 자동 실행하지 않는다', async ({
  page,
}) => {
  const aiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(AI_ENDPOINT)) aiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    if (!('Notification' in window)) return;
    const request = Notification.requestPermission;
    Notification.requestPermission = (...args) => {
      document.documentElement.dataset.unexpectedNotificationPrompt = 'true';
      return request.apply(Notification, args);
    };
  });
  await page.goto('./?conversation=majima');
  await expect(page.getByRole('dialog', { name: '암호 입력', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('conversation')).toBe(false);
  await expect
    .poll(async () =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
    )
    .toBe('activated');
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.scope,
  );
  expect(scope).toBe(new URL('./', page.url()).href);
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-unexpected-notification-prompt',
    'true',
  );
  expect(aiRequests).toEqual([]);
  const manifestUrl = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(manifestUrl).toBe('/yaku_IPhone/manifest.webmanifest');
  const manifest = await (await page.request.get(manifestUrl!)).json();
  expect(manifest.scope).toBe('/yaku_IPhone/');
  expect(manifest.start_url).toBe('/yaku_IPhone/');
  expect((await page.request.get('/yaku_IPhone/app-icon.png')).status()).toBe(200);
  const source = await (await page.request.get('/yaku_IPhone/push-sw.js')).text();
  expect(source).not.toContain("addEventListener('fetch'");
});
