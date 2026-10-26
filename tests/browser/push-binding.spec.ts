import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';

async function setup(context: BrowserContext) {
  await context.addInitScript(() => {
    if (!localStorage.getItem('yaku-iphone.ai.session.v2'))
      localStorage.setItem(
        'yaku-iphone.ai.session.v2',
        JSON.stringify({ service: 'kiryu-character-chat-v2', token: 'push-test-session' }),
      );
    class TestNotification {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    const fixture = window as unknown as {
      holdUnsubscribe: boolean;
      unsubscribePending: boolean;
      releaseUnsubscribe?: () => void;
    };
    fixture.holdUnsubscribe = false;
    const subscription = {
      endpoint: 'https://push.example.test/subscription',
      toJSON: () => ({
        endpoint: 'https://push.example.test/subscription',
        keys: { p256dh: 'fixture-key', auth: 'fixture-auth' },
      }),
      unsubscribe: () => {
        if (!fixture.holdUnsubscribe) return Promise.resolve(true);
        fixture.unsubscribePending = true;
        return new Promise<boolean>((resolve) => {
          fixture.releaseUnsubscribe = () => resolve(true);
        });
      },
    };
    const registration = {
      pushManager: {
        getSubscription: async () =>
          localStorage.getItem('fixture-native-subscription-removed') ? null : subscription,
        subscribe: async () => subscription,
      },
      getNotifications: async () => [],
    };
    const serviceWorker = Object.assign(new EventTarget(), {
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
      register: async () => registration,
    });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  });
  const state = { posts: 0, deferred: null as Route | null, hold: false };
  await context.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown;
    if (request.method() === 'OPTIONS') data = {};
    else if (path === '/v1/health') data = { status: 'ready' };
    else if (path === '/v1/history') data = { messages: [], pending_job: null, next_cursor: null };
    else if (path === '/v1/push/key') data = { public_key: 'BAAAAAAA' };
    else if (path === '/v1/push/subscriptions' && request.method() === 'POST') {
      state.posts++;
      if (state.hold) {
        state.deferred = route;
        return;
      }
      data = { id: `subscription-${state.posts}` };
    } else if (path === '/v1/push/subscriptions') data = { ok: true };
    else if (path === '/v1/sessions') data = { token: 'fresh-test-session' };
    else throw new Error(`Unexpected fixture request ${path}`);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(data),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      },
    });
  });
  return state;
}
async function readState(page: Page, key: string) {
  return page.evaluate(
    (key) =>
      new Promise<unknown>((resolve, reject) => {
        const opening = indexedDB.open('yaku-iphone-push-v1', 1);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db.transaction('state', 'readonly').objectStore('state').get(key);
          request.onsuccess = () => {
            resolve(request.result ?? null);
            db.close();
          };
          request.onerror = reject;
        };
        opening.onerror = reject;
      }),
    key,
  );
}
async function notifications(page: Page) {
  await page.goto('./');
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=haruka]').tap();
  await page.getByRole('button', { name: '답장 알림 설정' }).click();
  await expect(page.getByRole('button', { name: '알림 켜기', exact: true })).toBeEnabled();
}

test('다른 탭의 초기화 중 늦게 끝난 구독 등록이 이전 binding을 되살리지 않는다', async ({
  page,
  context,
}) => {
  const service = await setup(context);
  service.hold = true;
  await notifications(page);
  await page.getByRole('button', { name: '알림 켜기', exact: true }).click();
  await expect.poll(() => !!service.deferred).toBe(true);
  const reset = await context.newPage();
  await reset.goto('./');
  await reset.evaluate(() => {
    (window as unknown as { holdUnsubscribe: boolean }).holdUnsubscribe = true;
  });
  await unlockPhone(reset);
  await launchHomeApp(reset, 'settings');
  await reset.getByRole('button', { name: '처음 상태로 되돌리기', exact: true }).click();
  await reset.getByRole('dialog').getByRole('button', { name: '초기화', exact: true }).click();
  await expect
    .poll(() =>
      reset.evaluate(
        () => (window as unknown as { unsubscribePending: boolean }).unsubscribePending,
      ),
    )
    .toBe(true);
  expect(await reset.evaluate(() => localStorage.getItem('yaku-iphone.ai.reset.v1'))).toBeNull();
  await service.deferred!.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ id: 'stale-subscription' }),
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
  await expect(page.getByRole('alert')).toContainText('알림 설정이 변경되었습니다');
  expect(await readState(page, 'binding')).toBeNull();
  const generation = (await readState(page, 'generation')) as {
    value: number;
    revokedScopes: string[];
  };
  expect(generation.value).toBe(1);
  expect(generation.revokedScopes).toHaveLength(1);
  // Even an enable begun after the tombstone cannot revive the old scope
  // while reset is still waiting for native unsubscribe.
  service.hold = false;
  await page.getByRole('button', { name: '알림 켜기', exact: true }).click();
  await expect.poll(() => service.posts).toBe(2);
  await expect(page.getByRole('alert')).toContainText('알림 설정이 변경되었습니다');
  expect(await readState(page, 'binding')).toBeNull();
  await reset.evaluate(() =>
    (window as unknown as { releaseUnsubscribe: () => void }).releaseUnsubscribe(),
  );
  await expect(reset.getByTestId('lock-screen')).toBeVisible();
  expect(await readState(page, 'binding')).toBeNull();
});

test('구독 복원에서 서버 id가 바뀌면 binding을 갱신하고 브라우저 구독이 사라지면 해제한다', async ({
  page,
  context,
}) => {
  const service = await setup(context);
  await notifications(page);
  await page.getByRole('button', { name: '알림 켜기', exact: true }).click();
  await expect(page.getByRole('button', { name: '알림 끄기', exact: true })).toBeVisible();
  expect(((await readState(page, 'binding')) as { id: string }).id).toBe('subscription-1');
  await page.reload();
  await expect.poll(() => service.posts).toBeGreaterThan(1);
  await expect
    .poll(async () => ((await readState(page, 'binding')) as { id: string })?.id)
    .toBe(`subscription-${service.posts}`);
  await page.evaluate(() => localStorage.setItem('fixture-native-subscription-removed', 'true'));
  await page.reload();
  await expect.poll(() => readState(page, 'binding')).toBeNull();
});
