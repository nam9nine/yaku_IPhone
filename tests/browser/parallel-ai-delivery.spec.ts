import { expect, test, type Page } from '../helpers/browser-test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { AI_PRESENTATION_KEY, typingDelay } from '../../src/ai/presentation';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';
import { DAY_STORAGE_KEY, initialDay, dayReducer } from '../../src/day/state';

type Character = 'haruka' | 'majima';

test('다른 인물에게 즉시 전송하고 같은 순간 도착한 두 답장의 소리·OS 수신 확인을 보존한다', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const completedShopping = dayReducer(
    dayReducer(initialDay(), { type: 'reminder', id: 'shopping', done: true }),
    { type: 'miss-call', reason: 'declined' },
  );
  await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), {
    key: DAY_STORAGE_KEY,
    // Start after the quest call; independent call followup delivery has separate coverage.
    state: { ...completedShopping, pendingCallFollowups: [] },
  });
  await page.addInitScript(() => {
    const fixture = window as unknown as { receivedSounds: number[] };
    fixture.receivedSounds = [];
    class TestAudioContext {
      state = 'running';
      destination = {};
      onstatechange = null;
      resume = async () => {};
      close = async () => {};
      decodeAudioData = async () => ({ duration: 0.05 });
      createGain = () => ({
        gain: { value: 1 },
        connect() {
          return this;
        },
        disconnect() {},
      });
      createBufferSource = () => ({
        buffer: null,
        onended: null,
        disconnect() {},
        stop() {},
        connect(node: unknown) {
          return node;
        },
        start() {
          fixture.receivedSounds.push(Date.now());
        },
      });
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: TestAudioContext });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: class {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
      },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const subscription = {
      toJSON: () => ({
        endpoint: 'https://push.example.test/parallel',
        keys: { p256dh: 'fixture', auth: 'fixture' },
      }),
      unsubscribe: async () => true,
    };
    const registration = {
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async () => subscription,
      },
      getNotifications: async () => [],
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        ready: Promise.resolve(registration),
        getRegistration: async () => registration,
        register: async () => registration,
      }),
    });
  });
  const jobs = new Map<string, { character: Character; message: string; request_id: string }>();
  const receipts = new Set<string>();
  await page.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let result: unknown;
    if (request.method() === 'OPTIONS') result = {};
    else if (url.pathname === '/v1/health') result = { status: 'ready' };
    else if (url.pathname === '/v1/episodes/majima' && request.method() === 'GET')
      result = { protocol: 1, enabled: false, episode: null, action: null };
    else if (url.pathname === '/v1/sessions') result = { token: 'parallel-delivery-session' };
    else if (url.pathname === '/v1/push/key') result = { public_key: 'BAAAAAAA' };
    else if (url.pathname === '/v1/push/subscriptions') {
      const body = request.postDataJSON();
      if (body.presence) {
        for (const id of body.presence.job_ids) receipts.add(id);
        result = { ok: true };
      } else result = { id: 'parallel-subscription' };
    } else if (url.pathname === '/v1/chat') {
      const body = request.postDataJSON();
      jobs.set(body.request_id, body);
      result = { job_id: body.request_id, status: 'queued' };
    } else if (url.pathname.startsWith('/v1/jobs/')) {
      const job = jobs.get(url.pathname.split('/').at(-1)!)!;
      result = {
        job_id: job.request_id,
        character: job.character,
        status: 'complete',
        request: { id: job.request_id, message: job.message, time: '2026-10-29T00:00:00Z' },
      };
    } else if (url.pathname === '/v1/history') {
      const messages = [...jobs.values()]
        .filter((job) => job.character === url.searchParams.get('character'))
        .flatMap((job) => [
          {
            id: `${job.request_id}-u`,
            role: 'user',
            content: job.message,
            time: '2026-10-29T00:00:00Z',
            status: 'complete',
            request_id: job.request_id,
            job_id: job.request_id,
          },
          // Offset server duration against the random typing delay: both actual
          // delivery deadlines are exactly 32 seconds after the paused send time.
          {
            id: `${job.request_id}-a`,
            role: 'assistant',
            content: `${job.character} 동시 수신`,
            time: new Date(
              Date.parse('2026-10-29T00:00:00Z') + 32_000 - typingDelay(job.request_id),
            ).toISOString(),
            status: 'complete',
            request_id: job.request_id,
            job_id: job.request_id,
          },
        ]);
      result = { messages, pending_job: null, next_cursor: null };
    } else throw new Error(`Unexpected fixture request ${url.pathname}`);
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
  await page.locator('[data-conversation=haruka]').tap();
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '답장 알림 설정', exact: true }).click();
  await page.getByRole('button', { name: '알림 켜기', exact: true }).click();
  await expect(page.getByRole('button', { name: '알림 끄기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '답장 알림 설정', exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const send = async (text: string) => {
    await page.locator('.message-ai-input textarea').fill(text);
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).click();
  };
  await expect(page.locator('.message-ai-input textarea')).toHaveCount(0);
  await page
    .getByRole('button', { name: '메모에 적힌 카레 재료는 다 샀다. 보내기', exact: true })
    .click();
  await expect.poll(() => jobs.size).toBe(1);
  await page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true }).click();
  await page.locator('[data-conversation=majima]').tap();
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
  await send('기다리지 않고 형님에게');
  await expect.poll(() => jobs.size).toBe(2);
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) ?? '{}').receipts?.filter(
            (r: { replyId?: string }) => r.replyId,
          ).length,
        AI_PRESENTATION_KEY,
      ),
    )
    .toBe(2);
  await expect.poll(() => sounds(page)).toBe(2); // both successful outgoing sounds
  await page.evaluate(() => {
    (window as unknown as { receivedSounds: number[] }).receivedSounds = [];
  });
  await page.clock.runFor(32_001);
  await expect.poll(() => [...receipts].sort()).toEqual([...jobs.keys()].sort());
  await expect.poll(() => sounds(page)).toBe(1);
  await page.clock.runFor(1001);
  await expect.poll(() => sounds(page)).toBe(2);
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '{}').storyChoiceHistory?.haruka,
        DAY_STORAGE_KEY,
      ),
    )
    .toContain('haruka-shopping');
  await page.clock.runFor(10_000);
  expect(await sounds(page)).toBe(2); // heartbeat/re-render must not replay either
});

async function sounds(page: Page) {
  return page.evaluate(
    () => (window as unknown as { receivedSounds: number[] }).receivedSounds.length,
  );
}
