import { expect, test, type Page } from '@playwright/test';
import type { SpeechRecognitionEngine, SpeechResultEvent } from '../../src/speech/recognition';
import { AI_ENDPOINT } from '../../src/ai/config';
import { mockStoryAi } from '../helpers/mock-story-ai';
import { finishAiReply, settleAiRequests } from '../helpers/ai-clock';
import { launchHomeApp } from '../helpers/home';
import { unlockPhone } from '../helpers/unlock';

interface ProbeEngine extends SpeechRecognitionEngine {
  starts: number;
  stops: number;
  aborts: number;
}
interface SpeechProbe {
  engines: ProbeEngine[];
  speaks: number;
  lateResult: SpeechRecognitionEngine['onresult'];
}
type ProbeWindow = Window & { __callSpeech: SpeechProbe };

/** Synthetic browser API only: these tests never request microphone access. */
async function installSpeech(page: Page, mode: 'standard' | 'webkit' | 'unsupported' = 'standard') {
  await page.addInitScript((mode) => {
    const probe: SpeechProbe = { engines: [], speaks: 0, lateResult: null };
    Object.defineProperty(window, '__callSpeech', { value: probe });
    class Recognition implements ProbeEngine {
      lang = '';
      continuous = true;
      interimResults = false;
      starts = 0;
      stops = 0;
      aborts = 0;
      onstart: SpeechRecognitionEngine['onstart'] = null;
      onresult: SpeechRecognitionEngine['onresult'] = null;
      onerror: SpeechRecognitionEngine['onerror'] = null;
      onend: SpeechRecognitionEngine['onend'] = null;
      constructor() {
        probe.engines.push(this);
      }
      start() {
        this.starts++;
        probe.lateResult = this.onresult;
        this.onstart?.();
      }
      stop() {
        this.stops++;
      }
      abort() {
        this.aborts++;
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: mode === 'standard' ? Recognition : undefined,
    });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: mode === 'webkit' ? Recognition : undefined,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: () => probe.speaks++, cancel: () => undefined },
    });
  }, mode);
}
async function speechState(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__callSpeech;
    return {
      instances: probe.engines.length,
      starts: probe.engines.reduce((total, item) => total + item.starts, 0),
      stops: probe.engines.reduce((total, item) => total + item.stops, 0),
      aborts: probe.engines.reduce((total, item) => total + item.aborts, 0),
      speaks: probe.speaks,
      settings: probe.engines.map(({ lang, continuous, interimResults }) => ({
        lang,
        continuous,
        interimResults,
      })),
    };
  });
}
async function recognize(page: Page, text: string, final = false, late = false) {
  await page.evaluate(
    ({ text, final, late }) => {
      const probe = (window as unknown as ProbeWindow).__callSpeech;
      const event: SpeechResultEvent = {
        resultIndex: 0,
        results: [{ 0: { transcript: text }, length: 1, isFinal: final }],
      };
      if (late) probe.lateResult?.(event);
      else probe.engines.at(-1)?.onresult?.(event);
    },
    { text, final, late },
  );
}
async function finishRecognition(page: Page) {
  await page.evaluate(() =>
    (window as unknown as ProbeWindow).__callSpeech.engines.at(-1)?.onend?.(),
  );
}
function requests(page: Page) {
  const posts: {
    character: string;
    message: string;
    phone_events: string[];
    request_id: string;
  }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/chat')
      posts.push(request.postDataJSON());
  });
  return posts;
}
async function boot(page: Page) {
  await mockStoryAi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
}
async function outgoing(page: Page, character: 'majima' | 'haruka' = 'majima', waitReady = true) {
  await launchHomeApp(page, 'phone');
  await page.getByRole('button', { name: '연락처', exact: true }).tap();
  const back = page.getByRole('button', { name: '연락처 목록으로 돌아가기', exact: true });
  if (await back.isVisible()) await back.tap();
  await page.locator(`[data-contact=${character}]`).tap();
  await page
    .getByRole('button', {
      name: `${character === 'majima' ? '마지마 고로' : '사와무라 하루카'}에게 전화 걸기`,
      exact: true,
    })
    .tap();
  await page.clock.runFor(3000);
  const call = page.getByRole('dialog', {
    name: `${character === 'majima' ? '마지마 형님' : '하루카'} 통화`,
    exact: true,
  });
  await expect(call).toBeVisible();
  if (waitReady) await expect(call.getByRole('status')).toHaveText('');
  return call;
}

test('수신 전화에 응답해도 말하기를 누르기 전에는 마이크를 시작하지 않는다', async ({ page }) => {
  await installSpeech(page);
  const posts = requests(page);
  await boot(page);
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  for (const item of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${item} 완료`, exact: true }).check();
  await page.getByRole('button', { name: '전화 응답', exact: true }).tap();
  const call = page.getByRole('dialog', { name: '마지마 형님 통화', exact: true });
  await expect(call.getByRole('button', { name: '말하기', exact: true })).toBeEnabled();
  expect((await speechState(page)).instances).toBe(0);
  expect(posts).toEqual([]);
  await call.getByRole('button', { name: '통화 종료', exact: true }).tap();
});

for (const character of ['majima', 'haruka'] as const) {
  test(`${character}: 인식 내용을 수정·확인한 뒤 한 번만 전송하고 텍스트 AI 답장을 받는다`, async ({
    page,
  }, testInfo) => {
    await installSpeech(page, character === 'haruka' ? 'webkit' : 'standard');
    const posts = requests(page);
    await boot(page);
    const call = await outgoing(page, character);
    expect((await speechState(page)).instances).toBe(0);
    await call.getByRole('button', { name: '말하기', exact: true }).tap();
    const input = call.getByRole('textbox', { name: '통화에서 보낼 말', exact: true });
    expect((await speechState(page)).settings).toEqual([
      { lang: 'ko-KR', continuous: false, interimResults: true },
    ]);
    await recognize(page, '지금 가');
    await expect(input).toHaveValue('지금 가');
    await expect(input).toHaveAttribute('readonly', '');
    await expect(call.getByRole('button', { name: '말 보내기', exact: true })).toBeDisabled();
    expect(posts).toEqual([]);
    await call.getByRole('button', { name: '음성 인식 마치기', exact: true }).tap();
    await recognize(page, '지금 가겠습니다', true);
    await recognize(page, '지금 가겠습니다', true);
    await finishRecognition(page);
    await expect(input).toHaveValue('지금 가겠습니다');
    await expect(input).toBeEditable();
    expect(posts).toEqual([]);
    const message =
      character === 'majima'
        ? '형님, 볼일 끝내고 연락드리겠습니다.'
        : '하루카, 오늘은 늦게 돌아가겠다.';
    await input.fill(message);
    const send = call.getByRole('button', { name: '말 보내기', exact: true });
    await expect(send).toBeEnabled();
    // Two activation events in one task must still create only one UUID/job.
    await send.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ character, message });
    expect(posts[0].phone_events.at(-1)).toBe(`${character}-call-live`);
    expect(posts[0].request_id).toBeTruthy();
    await finishAiReply(page, character);
    await expect(call.getByRole('log', { name: '실시간 통화 대화' })).toContainText(
      `검증용 ${character === 'majima' ? '마지마' : '하루카'} 답장`,
    );
    await settleAiRequests(page);
    expect(posts).toHaveLength(1);
    expect((await speechState(page)).speaks).toBe(0);
    await expect(call.locator('audio, video')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`call-${character}-reply.png`) });
  });
}

test('마이크 권한 거절 뒤에는 인식 결과를 보내지 않고 글로 입력해 계속한다', async ({ page }) => {
  await installSpeech(page);
  const posts = requests(page);
  await boot(page);
  const call = await outgoing(page);
  await call.getByRole('button', { name: '말하기', exact: true }).tap();
  await page.evaluate(() =>
    (window as unknown as ProbeWindow).__callSpeech.engines
      .at(-1)
      ?.onerror?.({ error: 'not-allowed' }),
  );
  await expect(call.getByRole('alert')).toContainText('마이크 사용이 허용되지 않았어요');
  expect(posts).toEqual([]);
  await call.getByRole('button', { name: '글로 입력', exact: true }).tap();
  const input = call.getByRole('textbox', { name: '통화에서 보낼 말', exact: true });
  await expect(input).toBeFocused();
  await input.fill('형님, 지금은 글로 말씀드리겠습니다.');
  await call.getByRole('button', { name: '말 보내기', exact: true }).tap();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].message).toBe('형님, 지금은 글로 말씀드리겠습니다.');
});

test('미지원 브라우저에서도 통화의 직접 입력과 전송을 사용할 수 있다', async ({ page }) => {
  await installSpeech(page, 'unsupported');
  const posts = requests(page);
  await boot(page);
  const call = await outgoing(page);
  await expect(call.getByRole('button', { name: '말하기', exact: true })).toBeDisabled();
  await expect(call.getByText('음성 인식 미지원')).toBeVisible();
  await call.getByRole('button', { name: '글로 입력', exact: true }).tap();
  await call
    .getByRole('textbox', { name: '통화에서 보낼 말', exact: true })
    .fill('전화 받았습니다, 형님.');
  await call.getByRole('button', { name: '말 보내기', exact: true }).tap();
  await expect.poll(() => posts.length).toBe(1);
  expect((await speechState(page)).starts).toBe(0);
});

for (const reason of ['end-call', 'hidden', 'pagehide'] as const) {
  test(`${reason}: 인식을 중단하고 늦은 결과를 새 통화나 초안에 섞지 않는다`, async ({ page }) => {
    await installSpeech(page);
    const posts = requests(page);
    await boot(page);
    const call = await outgoing(page);
    await call.getByRole('button', { name: '말하기', exact: true }).tap();
    await recognize(page, '지금 인식한 말');
    if (reason === 'end-call') {
      await call.getByRole('button', { name: '통화 종료', exact: true }).tap();
      await expect(call).toHaveCount(0);
    } else {
      await page.evaluate((reason) => {
        if (reason === 'hidden') {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        } else window.dispatchEvent(new Event('pagehide'));
      }, reason);
      await expect(call.getByRole('button', { name: '말하기', exact: true })).toBeEnabled();
    }
    expect((await speechState(page)).aborts).toBe(1);
    await recognize(page, '취소 뒤 늦게 도착한 말', true, true);
    if (reason === 'end-call') {
      await page.keyboard.press('Alt+Home');
      const reopened = await outgoing(page);
      await reopened.getByRole('button', { name: '글로 입력', exact: true }).tap();
      await expect(
        reopened.getByRole('textbox', { name: '통화에서 보낼 말', exact: true }),
      ).toHaveValue('');
    } else {
      await expect(
        call.getByRole('textbox', { name: '통화에서 보낼 말', exact: true }),
      ).toHaveValue('지금 인식한 말');
    }
    expect(posts).toEqual([]);
  });
}

test('문자에서 보낸 답장을 기다리며 통화로 옮겨도 같은 답장을 통화 화면에서 본다', async ({
  page,
}) => {
  await installSpeech(page);
  const posts = requests(page);
  await boot(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  await page
    .getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true })
    .fill('형님, 문자 보셨습니까?');
  await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.getByText('답장 대기 중', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+Home');
  const call = await outgoing(page, 'majima', false);
  await expect(call.getByRole('status')).toContainText('답장 대기 중');
  await expect(call.getByRole('log', { name: '실시간 통화 대화' })).toContainText(
    '형님, 문자 보셨습니까?',
  );
  await finishAiReply(page, 'majima');
  await expect(call.getByRole('log', { name: '실시간 통화 대화' })).toContainText(
    '검증용 마지마 답장',
  );
  expect(posts).toHaveLength(1);
  expect((await speechState(page)).starts).toBe(0);
});

test('모델 준비 중 통화에서도 다시 연결한 뒤 작성한 말을 보낼 수 있다', async ({ page }) => {
  await installSpeech(page);
  const posts = requests(page);
  await boot(page);
  let healthCalls = 0;
  await page.route(`${AI_ENDPOINT}/v1/health`, async (route) => {
    healthCalls++;
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ status: healthCalls === 1 ? 'loading' : 'ready' }),
    });
  });
  const call = await outgoing(page, 'majima', false);
  const retry = call.getByRole('button', { name: '다시 연결', exact: true });
  await expect(retry).toBeVisible();
  await call.getByRole('button', { name: '글로 입력', exact: true }).tap();
  await call
    .getByRole('textbox', { name: '통화에서 보낼 말', exact: true })
    .fill('연결을 기다렸다가 보냅니다.');
  const send = call.getByRole('button', { name: '말 보내기', exact: true });
  await expect(send).toBeDisabled();
  await retry.tap();
  await expect(send).toBeEnabled();
  await send.tap();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].message).toBe('연결을 기다렸다가 보냅니다.');
  expect(healthCalls).toBe(2);
});

test('짧은 통화 화면에서도 인식 편집·전송·종료 버튼에 접근하고 페이지는 밀리지 않는다', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 400 });
  await installSpeech(page);
  await boot(page);
  const call = await outgoing(page);
  await call.getByRole('button', { name: '글로 입력', exact: true }).tap();
  const input = call.getByRole('textbox', { name: '통화에서 보낼 말', exact: true });
  await input.fill('형님, 짧게 여쭙겠습니다. 어디로 가면 됩니까?');
  await expect(input).toBeInViewport({ ratio: 1 });
  const send = call.getByRole('button', { name: '말 보내기', exact: true });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeInViewport({ ratio: 1 });
  const end = call.getByRole('button', { name: '통화 종료', exact: true });
  await end.scrollIntoViewIfNeeded();
  await expect(end).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  // The decorative blurred ::before extends outside the clipped dialog; measure interactive content.
  expect(
    await call
      .locator('.call-screen-content')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('call-editor-360x400.png') });
  await end.tap();
  await expect(call).toHaveCount(0);
});
