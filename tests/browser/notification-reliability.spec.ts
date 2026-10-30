import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test, type Page } from '../helpers/browser-test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { typingDelay } from '../../src/ai/presentation';
import { launchHomeApp } from '../helpers/home';
import { unlockPhone } from '../helpers/unlock';

async function setup(page: Page, push = true, hold = false) {
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    const events: Record<string, unknown>[] = [];
    const now = Date.now.bind(Date);
    const record = (event: string, extra: Record<string, unknown> = {}) =>
      events.push({
        event,
        time: now(),
        states: contexts.map((context) => context.state),
        hidden: document.hidden,
        focused: document.hasFocus(),
        ...extra,
      });
    for (const type of ['visibilitychange', 'pointerup', 'keydown'])
      document.addEventListener(type, (event) => record(type, { trusted: event.isTrusted }), true);
    const NativeAudioContext = window.AudioContext;
    let interrupted = false;
    const pendingResumes: (() => void)[] = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
        record('created');
        this.addEventListener('statechange', () => record('statechange'));
      }
      override get state() {
        return interrupted ? 'suspended' : super.state;
      }
      override resume() {
        record('resume-request');
        if (interrupted)
          return new Promise<void>((resolve) => {
            pendingResumes.push(resolve);
          });
        return super.resume().then(
          () => {
            record('resume-complete');
          },
          (error: unknown) => {
            record('resume-error', { error: String(error) });
            throw error;
          },
        );
      }
    };
    const counts = {
      starts: 0,
      events,
      interrupt: () => {
        interrupted = true;
      },
      release: () => {
        interrupted = false;
        pendingResumes.splice(0).forEach((resolve) => resolve());
      },
      get pendingResumes() {
        return pendingResumes.length;
      },
      durations: [] as number[],
      get states() {
        return contexts.map((context) => context.state);
      },
    };
    Object.assign(window, { notificationAudio: counts });
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const oscillator = original.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (when) => {
        counts.starts++;
        record('buffer-start');
        counts.durations.push(oscillator.buffer?.duration ?? 0);

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
  const state = {
    requestId: '',
    message: '',
    hold,
    polls: 0,
    presence: [] as { active: boolean; job_ids: string[]; client_id: string; sequence: number }[],
  };
  await page.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let data: unknown = {};
    if (req.method() === 'OPTIONS') data = {};
    else if (path === '/v1/health') data = { status: 'ready' };
    else if (path === '/v1/sessions') data = { token: 'notify90-test' };
    else if (path === '/v1/push/key') data = { public_key: 'BAAAAAAA' };
    else if (path === '/v1/push/subscriptions') {
      const body = req.postDataJSON();
      if (body?.presence) {
        state.presence.push(body.presence);
        data = { ok: true };
      } else data = { id: 'notify90-subscription' };
    } else if (path === '/v1/chat') {
      state.requestId = req.postDataJSON().request_id;
      state.message = req.postDataJSON().message;
      data = { job_id: state.requestId, status: 'queued' };
    } else if (path.startsWith('/v1/jobs/')) {
      state.polls++;
      data = {
        job_id: state.requestId,
        character: 'majima',
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
                request_id: state.requestId,
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
  // Use one clock origin for the browser and pause target. A host Date.now()
  // sampled after install can already be behind the browser under load.
  await page.clock.install({ time: new Date('2026-10-26T00:00:00Z') });
  await page.goto('./');
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
  if (push) {
    await page.getByRole('button', { name: '답장 알림 설정' }).tap();
    await page.getByRole('button', { name: '알림 켜기', exact: true }).tap();
    await expect(page.getByRole('button', { name: '알림 끄기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '닫기', exact: true }).tap();
  }
  await page.clock.pauseAt(new Date('2026-10-26T00:01:00Z'));
  await page.getByRole('textbox', { name: '마지마에게 메시지 입력' }).fill('저녁은 우동으로 하자.');
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
  // Every valid local send starts the conversation tone once. Keep the
  // arrival assertions below independent of the new outgoing sound.
  await expect.poll(() => soundCount(page)).toBe(1);
  await page.evaluate(() => {
    const audio = (
      window as unknown as { notificationAudio: { starts: number; durations: number[] } }
    ).notificationAudio;
    if (Math.abs(audio.durations[0] - 0.517642) > 0.001) throw new Error('Wrong outgoing tone');
    audio.starts = 0;
    audio.durations = [];
  });
  return state;
}

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const diagnostics = await page
    .evaluate(async () => {
      const audio = (window as unknown as { notificationAudio?: unknown }).notificationAudio;
      const claims = await new Promise<unknown>((resolve) => {
        const opening = indexedDB.open('yaku-iphone-push-v1', 1);
        opening.onerror = () => resolve('unavailable');
        opening.onsuccess = () => {
          const db = opening.result;
          if (!db.objectStoreNames.contains('state')) {
            db.close();
            resolve(null);
            return;
          }
          const request = db
            .transaction('state', 'readonly')
            .objectStore('state')
            .get('soundClaims');
          request.onsuccess = () => {
            resolve(request.result ?? null);
            db.close();
          };
          request.onerror = () => {
            resolve('unavailable');
            db.close();
          };
        };
      });
      return { audio, claims, hidden: document.hidden, focused: document.hasFocus() };
    })
    .catch((error: unknown) => ({ unavailable: String(error) }));
  await info.attach('audio-diagnostics', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
});

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
    await expect.poll(() => soundCount(page)).toBe(1);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { notificationAudio: { durations: number[] } }
        ).notificationAudio.durations.at(-1),
      ),
    ).toBeCloseTo(4.4, 2);
    if (width === 390)
      await page.screenshot({
        path: `harness/evidence/issue-99/subscribed-fallback-${test.info().project.name}.png`,
        animations: 'disabled',
      });
    await page.clock.runFor(6001);
    await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
    expect(await soundCount(page)).toBe(1);
  });
}

test('현재 대화의 답장은 배너 없이 수신음으로 알리고 새로고침으로 재생하지 않는다', async ({
  page,
}) => {
  const state = await setup(page, false);
  await page.clock.runFor(typingDelay(state.requestId) + 1600);
  await expect(page.getByText('우동 재료는 제가 챙길게요.', { exact: true })).toBeVisible();
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  await expect.poll(() => soundCount(page)).toBe(1);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { notificationAudio: { durations: number[] } }
      ).notificationAudio.durations.at(-1),
    ),
  ).toBeCloseTo(0.517642, 3);
  await page.clock.resume();
  await page.reload();
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
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
    if (cancel === 'hidden') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.keyboard.press('Alt+c');
      await page.getByRole('slider', { name: '음량', exact: true }).fill('91');
      await page.keyboard.press('Escape');
      await page.clock.runFor(1500);
      expect(await soundCount(page)).toBe(0);
    }
  });
}

// Deterministic platform boundary: keep real AudioContext/oscillators, but delay
// the resume acknowledgement. This is not a claim to reproduce the original
// intermittent WebKit failure's unknown hardware/browser cause.
async function pendingAudioArrival(page: Page) {
  const state = await setup(page);
  await page.keyboard.press('Alt+Home');
  await page.clock.runFor(500);
  await page.evaluate(() =>
    (
      window as unknown as { notificationAudio: { interrupt: () => void } }
    ).notificationAudio.interrupt(),
  );
  const untilDelivery = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('yaku-iphone.ai.delivery.v1')!);
    return Math.max(0, saved.receipts[0].deliverAt - Date.now());
  });
  await page.clock.runFor(untilDelivery);
  await expect(page.locator('.ai-reply-banner')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { notificationAudio: { pendingResumes: number } }).notificationAudio
            .pendingResumes,
      ),
    )
    .toBeGreaterThan(0);
  expect(await soundCount(page)).toBe(0);
  return state;
}
async function releaseAudio(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { notificationAudio: { release: () => void } }
    ).notificationAudio.release(),
  );
}

test('새 답장 도착 때 잠깐 중단된 오디오는 재개 완료 후 한 번 울린다', async ({ page }) => {
  await pendingAudioArrival(page);
  await releaseAudio(page);
  await expect.poll(() => soundCount(page)).toBe(1);
  await page.clock.runFor(2000);
  expect(await soundCount(page)).toBe(1);
});

async function setSilentMode(page: Page, silent: boolean) {
  const panel = page.getByTestId('system-control');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Alt+c');
  await expect(panel).toBeVisible();
  const toggle = panel.getByRole('button', { name: '무음 모드', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', String(!silent));
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-pressed', String(silent));
  await page.keyboard.press('Escape');
  // The real panel closes with a 200ms animation and 240ms fallback. With the
  // test clock paused, wait through that boundary before trying to reopen it.
  await page.clock.runFor(240);
  await expect(panel).toHaveCount(0);
}

for (const cancel of ['hidden', 'reset', 'mute', 'deadline'] as const) {
  test(`오디오 재개 대기 중 ${cancel}이면 뒤늦은 완료로 지난 소리를 재생하지 않는다`, async ({
    page,
  }) => {
    await pendingAudioArrival(page);
    if (cancel === 'hidden')
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    else if (cancel === 'reset') {
      await page.evaluate(() => {
        localStorage.setItem('yaku-iphone.ai.reset.v1', 'audio-resume-reset');
        window.dispatchEvent(new Event('yaku-iphone-ai-reset'));
      });
      await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
    } else if (cancel === 'mute') {
      await setSilentMode(page, true);
    } else await page.clock.runFor(1001);
    await releaseAudio(page);
    await page.clock.runFor(100);
    expect(await soundCount(page)).toBe(0);
    if (cancel === 'hidden')
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    if (cancel === 'mute') {
      await setSilentMode(page, false);
    }
    await page.clock.runFor(2000);
    expect(await soundCount(page)).toBe(0);
  });
}

test('답장 작성 말풍선 없이 지연 뒤 읽음으로 바뀌고 실제 수신 때만 울린다', async ({ page }) => {
  const state = await setup(page, false);
  await expect(page.locator('.message-time').last()).toContainText('전송됨');
  await expect(page.locator('.message-typing')).toHaveCount(0);
  await page.clock.runFor(typingDelay(state.requestId) + 1);
  await expect(page.locator('.message-typing')).toHaveCount(0);
  await expect(page.getByText('답장 대기 중', { exact: true })).toBeVisible();
  await expect(page.locator('.message-time').last()).toContainText('읽음');
  expect(await soundCount(page)).toBe(0);
  await page.screenshot({ path: `harness/evidence/issue-99/read-${test.info().project.name}.png` });
  await page.clock.runFor(1600);
  await expect(page.getByText('우동 재료는 제가 챙길게요.', { exact: true })).toBeVisible();
  await expect.poll(() => soundCount(page)).toBe(1);
  await page.keyboard.press('Alt+Home');
  await page.clock.runFor(500);
  await page.clock.resume();
  await launchHomeApp(page, 'messages');
  expect(await soundCount(page)).toBe(1);
});

test('홈 화면 앱 전경은 Push보다 먼저 준비된 대화음을 재생하고 이후 답장은 중복 재생하지 않는다', async ({
  page,
}) => {
  const state = await setup(page, true);
  const result = await page.evaluate(async (jobId) => {
    const channel = new MessageChannel();
    const done = new Promise<void>((resolve) => {
      channel.port1.onmessage = () => resolve();
    });
    const opening = indexedDB.open('yaku-iphone-push-v1', 1);
    const binding = await new Promise<{ id: string }>((resolve) => {
      opening.onsuccess = () => {
        const db = opening.result;
        const request = db.transaction('state').objectStore('state').get('binding');
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
      };
    });
    const event = new Event('message');
    Object.assign(event, {
      data: {
        type: 'chat.sound',
        character: 'majima',
        soundId: jobId,
        subscription_id: binding.id,
        deadline: Date.now() + 1100,
      },
      ports: [channel.port2],
      source: { scriptURL: new URL('push-sw.js', location.href).href },
    });
    navigator.serviceWorker.dispatchEvent(event);
    await done;
    channel.port1.close();
    return (window as unknown as { notificationAudio: { durations: number[] } }).notificationAudio
      .durations;
  }, state.requestId);
  expect(result).toHaveLength(1);
  expect(result[0]).toBeCloseTo(0.517642, 3);
  await page.clock.runFor(typingDelay(state.requestId) + 1600);
  await expect(page.getByText('우동 재료는 제가 챙길게요.', { exact: true })).toBeVisible();
  expect(await soundCount(page)).toBe(1);
});

for (const cancel of ['mute', 'reset', 'other-window-reset'] as const) {
  test(`대기 중인 전송음은 ${cancel} 이후 재개하지 않는다`, async ({ page }) => {
    await setup(page, false, true);
    await page.evaluate(() => {
      const audio = (window as unknown as { notificationAudio: { interrupt: () => void } })
        .notificationAudio;
      audio.interrupt();
      window.dispatchEvent(new Event('kiryu:message-sent'));
    });
    if (cancel === 'mute') {
      await page.keyboard.press('Alt+c');
      await page.getByRole('button', { name: '무음 모드', exact: true }).tap();
      await page.keyboard.press('Escape');
    } else if (cancel === 'reset')
      await page.evaluate(() => window.dispatchEvent(new Event('yaku-iphone-ai-reset')));
    else
      await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    await page.evaluate(() =>
      (
        window as unknown as { notificationAudio: { release: () => void } }
      ).notificationAudio.release(),
    );
    await page.clock.runFor(1200);
    expect(await soundCount(page)).toBe(0);
  });
}

test('채팅방의 OS 알림은 기기별 전경 상태와 실제 도착 확인을 보내고 나가면 복구한다', async ({
  page,
}) => {
  const state = await setup(page, true);
  await expect.poll(() => state.presence.some((p) => p.active)).toBe(true);
  await page.clock.runFor(typingDelay(state.requestId) + 1600);
  await expect(page.getByText('우동 재료는 제가 챙길게요.', { exact: true })).toBeVisible();
  await expect
    .poll(() => state.presence.some((p) => p.active && p.job_ids.includes(state.requestId)))
    .toBe(true);
  await expect(page.locator('.ai-reply-banner')).toHaveCount(0);
  expect(await soundCount(page)).toBe(1);
  await page.keyboard.press('Alt+Home');
  await expect.poll(() => state.presence.at(-1)?.active).toBe(false);
  const latest = state.presence.at(-1)!;
  expect(state.presence.every((p) => p.client_id === latest.client_id)).toBe(true);
  expect(latest.sequence).toBeGreaterThan(state.presence[0].sequence);
});
