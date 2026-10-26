import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test, type Page } from '@playwright/test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { typingDelay } from '../../src/ai/presentation';
import { launchHomeApp } from '../helpers/home';
import { unlockPhone } from '../helpers/unlock';

async function setup(page: Page, push = true, hold = false) {
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
    };
    const counts = {
      starts: 0,
      frequencies: [] as number[],
      get states() {
        return contexts.map((context) => context.state);
      },
    };
    Object.assign(window, { notificationAudio: counts });
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = original.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (when) => {
        counts.starts++;
        counts.frequencies.push(oscillator.frequency.value);
        start(when);
      };
      return oscillator;
    };
    class Permission {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: Permission });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    const subscription = {
      endpoint: 'https://push.example.test/notification90',
      toJSON: () => ({
        endpoint: 'https://push.example.test/notification90',
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
  const state = { requestId: '', message: '', hold, polls: 0 };
  await page.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let data: unknown = {};
    if (req.method() === 'OPTIONS') data = {};
    else if (path === '/v1/health') data = { status: 'ready' };
    else if (path === '/v1/sessions') data = { token: 'notify90-test' };
    else if (path === '/v1/push/key') data = { public_key: 'BAAAAAAA' };
    else if (path === '/v1/push/subscriptions') data = { id: 'notify90-subscription' };
    else if (path === '/v1/chat') {
      state.requestId = req.postDataJSON().request_id;
      state.message = req.postDataJSON().message;
      data = { job_id: state.requestId, status: 'queued' };
    } else if (path.startsWith('/v1/jobs/')) {
      state.polls++;
      data = {
        job_id: state.requestId,
        character: 'haruka',
        status: state.hold ? 'generating' : 'complete',
        request: { id: state.requestId, message: state.message, time: '2026-10-26T00:00:00Z' },
      };
    } else if (path === '/v1/history')
      data = {
        messages: state.requestId
          ? [
              {
                id: `${state.requestId}-user`,
                role: 'user',
                content: state.message,
                request_id: state.requestId,
                job_id: state.requestId,
                time: '2026-10-26T00:00:00Z',
                status: 'complete',
              },
              {
                id: `${state.requestId}-assistant`,
                role: 'assistant',
                content: '우동 재료는 제가 챙길게요.',
                job_id: state.requestId,
                time: '2026-10-26T00:00:01Z',
                status: 'complete',
              },
            ]
          : [],
        pending_job: null,
        next_cursor: null,
      };
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
  await page.goto('./');
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=haruka]').tap();
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
  if (push) {
    await page.getByRole('button', { name: '답장 알림 설정' }).tap();
    await page.getByRole('button', { name: '알림 켜기', exact: true }).tap();
    await expect(page.getByRole('button', { name: '알림 끄기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '닫기', exact: true }).tap();
  }
  await page.clock.install();
  await page.clock.pauseAt(Date.now());
  await page.getByRole('textbox', { name: '하루카에게 메시지 입력' }).fill('저녁은 우동으로 하자.');
  await page.getByRole('button', { name: '메시지 보내기', exact: true }).click();
  await expect.poll(() => state.requestId).not.toBe('');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const states = (window as unknown as { notificationAudio: { states: string[] } })
          .notificationAudio.states;
        return states.length > 0 && states.every((state) => state === 'running');
      }),
    )
    .toBe(true);
  // Finish mocked HTTP before advancing the UI clock; otherwise fetch's real
  // timeout is artificially advanced while Chromium still handles the route.
  if (hold) await expect(page.locator('.message-time').last()).toContainText('09:00');
  else
    await expect
      .poll(() =>
        page.evaluate(() => {
          const saved = JSON.parse(localStorage.getItem('yaku-iphone.ai.delivery.v1') ?? 'null');
          return saved?.receipts?.some((r: { replyId?: string }) => !!r.replyId) ?? false;
        }),
      )
      .toBe(true);
  return state;
}

async function soundCount(page: Page) {
  return page.evaluate(
    () => (window as unknown as { notificationAudio: { starts: number } }).notificationAudio.starts,
  );
}

for (const width of [360, 390, 430]) {
  test(`푸시 구독이 있어도 실제 push가 유실되면 앱 배너와 수신음이 도착한다 ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : width === 430 ? 932 : 844 });
    const state = await setup(page);
    await page.keyboard.press('Alt+Home');
    await page.clock.runFor(500);
    await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
    await page.clock.runFor(typingDelay(state.requestId) + 1600);
    await expect(page.locator('.ai-reply-banner')).toBeVisible();
    await expect(page.locator('.ai-reply-banner')).toContainText('우동 재료는 제가 챙길게요.');
    await expect.poll(() => soundCount(page)).toBe(9);
    if (width === 390)
      await page.screenshot({
        path: `harness/evidence/issue-90/subscribed-fallback-${test.info().project.name}.png`,
        animations: 'disabled',
      });
    await page.clock.runFor(6001);
    await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
    expect(await soundCount(page)).toBe(9);
  });
}

test('현재 대화의 답장은 배너 없이 수신음으로 알리고 새로고침으로 재생하지 않는다', async ({
  page,
}) => {
  const state = await setup(page, false);
  await page.clock.runFor(typingDelay(state.requestId) + 1600);
  await expect(page.getByText('우동 재료는 제가 챙길게요.', { exact: true })).toBeVisible();
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  await expect.poll(() => soundCount(page)).toBe(9);
  await page.clock.resume();
  await page.reload();
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=haruka]').tap();
  await expect(page.getByText('우동 재료는 제가 챙길게요.', { exact: true })).toBeVisible();
  expect(await soundCount(page)).toBe(0);
});

test('알림 센터에 가려진 배너는 6초가 지나도 돌아온 뒤 표시된다', async ({ page }) => {
  const state = await setup(page);
  await page.keyboard.press('Alt+Home');
  await page.clock.runFor(500);
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  await page.keyboard.press('Alt+n');
  await page.clock.runFor(typingDelay(state.requestId) + 10_000);
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
});

test('무음 모드는 배너를 유지하고 소리만 차단한다', async ({ page }) => {
  const state = await setup(page);
  await page.keyboard.press('Alt+Home');
  await page.clock.runFor(500);
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  await page.keyboard.press('Alt+c');
  await page.getByRole('button', { name: '무음 모드', exact: true }).tap();
  await page.keyboard.press('Escape');
  await page.clock.runFor(typingDelay(state.requestId) + 1600);
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
  expect(await soundCount(page)).toBe(0);
  await page.keyboard.press('Alt+c');
  await page.getByRole('button', { name: '무음 모드', exact: true }).tap();
  await page.keyboard.press('Escape');
  expect(await soundCount(page)).toBe(0);
});

test('이미 OS 소리를 요청한 답장은 복귀 시 배너만 보여 중복 수신음을 피한다', async ({ page }) => {
  const state = await setup(page);
  await page.evaluate(
    (jobId) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open('yaku-iphone-push-v1', 1);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction('state', 'readwrite');
          tx.objectStore('state').put([{ id: jobId, owner: 'native:fixture' }], 'soundClaims');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        opening.onerror = () => reject(opening.error);
      }),
    state.requestId,
  );
  await page.keyboard.press('Alt+Home');
  await page.clock.runFor(500);
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  await page.clock.runFor(typingDelay(state.requestId) + 1600);
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
  expect(await soundCount(page)).toBe(0);
});

test('합성 숨김 상태에서 도착한 배너는 복귀 후 표시하고 지난 소리를 뒤늦게 내지 않는다', async ({
  page,
}) => {
  const state = await setup(page);
  await page.keyboard.press('Alt+Home');
  await page.clock.runFor(500);
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(typingDelay(state.requestId) + 10_000);
  expect(await soundCount(page)).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
  expect(await soundCount(page)).toBe(0);
});

test('홈 화면은 백그라운드로 취급하지 않아 생성 완료를 15초 늦게 확인하지 않는다', async ({
  page,
}) => {
  const state = await setup(page, false, true);
  await page.keyboard.press('Alt+Home');
  await page.clock.runFor(500);
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
  const polls = state.polls;
  state.hold = false;
  await page.clock.runFor(1200);
  await expect.poll(() => state.polls).toBeGreaterThan(polls);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('yaku-iphone.ai.delivery.v1') ?? 'null');
        return saved?.receipts?.some((r: { replyId?: string }) => !!r.replyId) ?? false;
      }),
    )
    .toBe(true);
});

test('두 window가 동시에 소리를 요청해도 한 경로만 claim하고 다른 owner는 해제하지 못한다', async ({
  page,
  context,
}) => {
  const source = readFileSync(new URL('../../src/ai/pushBinding.ts', import.meta.url), 'utf8');
  const script = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  await context.route('**/sound-claim-test.js', (route) =>
    route.fulfill({ body: script, contentType: 'application/javascript' }),
  );
  await page.goto('./');
  const second = await context.newPage();
  await second.goto('./');
  const claim = (target: Page, owner: string) =>
    target.evaluate(async (owner) => {
      const path = '/yaku_IPhone/sound-claim-test.js';
      const binding = await import(/* @vite-ignore */ path);
      return binding.claimReplySound('simultaneous-job', owner);
    }, owner);
  const results = await Promise.all([claim(page, 'window-one'), claim(second, 'window-two')]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const winner = results[0] ? 'window-one' : 'window-two';
  await page.evaluate(
    async ({ winner }) => {
      const path = '/yaku_IPhone/sound-claim-test.js';
      const binding = await import(/* @vite-ignore */ path);
      await binding.releaseReplySound(
        'simultaneous-job',
        winner === 'window-one' ? 'window-two' : 'window-one',
      );
    },
    { winner },
  );
  expect(await claim(page, 'third-window')).toBe(false);
  await page.evaluate(
    async ({ winner }) => {
      const path = '/yaku_IPhone/sound-claim-test.js';
      const binding = await import(/* @vite-ignore */ path);
      await binding.releaseReplySound('simultaneous-job', winner);
    },
    { winner },
  );
  expect(await claim(page, 'third-window')).toBe(true);
});

for (const cancel of ['hidden', 'reset'] as const) {
  test(`sound claim 대기 중 ${cancel}이면 재생하지 않고 해당 소유권만 해제한다`, async ({
    page,
  }) => {
    const state = await setup(page);
    await page.keyboard.press('Alt+Home');
    await page.clock.runFor(500);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const opening = indexedDB.open('yaku-iphone-push-v1', 1);
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction('state', 'readwrite');
            let hold = true;
            Object.assign(window, {
              releaseSoundClaim: () => {
                hold = false;
              },
            });
            const keepAlive = () => {
              const request = tx.objectStore('state').get('claim-test');
              request.onsuccess = () => {
                if (hold) keepAlive();
              };
            };
            tx.oncomplete = () => db.close();
            keepAlive();
            resolve();
          };
        }),
    );
    await page.clock.runFor(typingDelay(state.requestId) + 1600);
    await expect(page.locator('.ai-reply-banner')).toBeVisible();
    expect(await soundCount(page)).toBe(0);
    await page.evaluate((cancel) => {
      if (cancel === 'hidden') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        localStorage.setItem('yaku-iphone.ai.reset.v1', 'sound-claim-reset');
        window.dispatchEvent(new Event('yaku-iphone-ai-reset'));
      }
    }, cancel);
    if (cancel === 'reset') await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
    await page.evaluate(() =>
      (window as unknown as { releaseSoundClaim: () => void }).releaseSoundClaim(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<unknown>((resolve, reject) => {
              const opening = indexedDB.open('yaku-iphone-push-v1', 1);
              opening.onerror = () => reject(opening.error);
              opening.onsuccess = () => {
                const db = opening.result;
                const request = db
                  .transaction('state', 'readonly')
                  .objectStore('state')
                  .get('soundClaims');
                request.onsuccess = () => {
                  resolve(request.result);
                  db.close();
                };
              };
            }),
        ),
      )
      .toEqual([]);
    expect(await soundCount(page)).toBe(0);
  });
}
