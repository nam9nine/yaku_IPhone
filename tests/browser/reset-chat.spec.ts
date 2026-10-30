import { expect, test, type BrowserContext, type Page } from '../helpers/browser-test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { AI_CONNECTION_KEY, AI_RESET_KEY } from '../../src/ai/connection';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';

type Character = 'haruka' | 'majima';
type Message = { id: string; role: string; content: string; time: null };
async function scopedService(context: BrowserContext) {
  const old = {
    haruka: [{ id: 'old-h', role: 'assistant', content: '초기화 이전 하루카 기록', time: null }],
    majima: [{ id: 'old-m', role: 'assistant', content: '초기화 이전 마지마 기록', time: null }],
  };
  const records = new Map<string, Record<Character, Message[]>>([['old-session', old]]);
  let sessions = 0;
  await context.addInitScript(
    ({ key }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({ service: 'kiryu-character-chat-v2', token: 'old-session' }),
        );
    },
    { key: AI_CONNECTION_KEY },
  );
  await context.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const token = request.headers().authorization?.slice(7) ?? '';
    let result: unknown;
    if (request.method() === 'OPTIONS') result = {};
    else if (url.pathname === '/v1/health') result = { status: 'ready' };
    else if (url.pathname === '/v1/sessions') {
      const fresh = `fresh-${++sessions}`;
      records.set(fresh, { haruka: [], majima: [] });
      result = { token: fresh };
    } else {
      const record = records.get(token);
      expect(record, 'Every history uses an issued session').toBeTruthy();
      if (url.pathname === '/v1/history')
        result = {
          messages: record![url.searchParams.get('character') as Character],
          pending_job: null,
          next_cursor: null,
        };
      else if (url.pathname === '/v1/episodes/majima' && request.method() === 'GET')
        result = { protocol: 1, enabled: false, episode: null, action: null };
      else throw new Error('Reset must not post or replay a message');
    }
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
  return { records, old, sessions: () => sessions };
}
async function boot(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
}
async function home(page: Page) {
  await page.keyboard.press('Alt+Home');
}
async function openThread(page: Page, character: Character) {
  await home(page);
  await launchHomeApp(page, 'messages');
  const back = page.getByRole('button', { name: '메시지 목록으로 돌아가기', exact: true });
  if (await back.isVisible()) await back.tap();
  await page
    .getByRole('button', { name: character === 'haruka' ? /사와무라 하루카/ : /마지마 고로/ })
    .first()
    .tap();
  if (character === 'majima')
    await expect(
      page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }),
    ).toBeEnabled();
  else
    await expect(
      page.getByRole('textbox', { name: '하루카에게 메시지 입력', exact: true }),
    ).toHaveCount(0);
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
}
async function resetDialog(page: Page) {
  await home(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('button', { name: '처음 상태로 되돌리기', exact: true }).tap();
  return page.getByRole('dialog', { name: '처음 상태로 되돌릴까요?', exact: true });
}

test('초기화 확인 후 두 인물의 새 세션을 복원하며 이전 서버 기록은 그대로 남는다', async ({
  page,
  context,
}, testInfo) => {
  const service = await scopedService(context);
  await boot(page);
  await openThread(page, 'haruka');
  await expect(page.getByText('초기화 이전 하루카 기록', { exact: true })).toBeVisible();
  let dialog = await resetDialog(page);
  await dialog.getByRole('button', { name: '취소', exact: true }).tap();
  await openThread(page, 'majima');
  await expect(page.getByText('초기화 이전 마지마 기록', { exact: true })).toBeVisible();
  expect(service.sessions()).toBe(0);
  dialog = await resetDialog(page);
  await expect(dialog.getByText(/이전 대화는 기록으로 보관/)).toBeVisible();
  if (process.env.CAPTURE_RESET)
    await page.screenshot({ path: `harness/evidence/issue-81/reset-${testInfo.project.name}.png` });
  await dialog.getByRole('button', { name: '초기화', exact: true }).tap();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await unlockPhone(page);
  for (const character of ['haruka', 'majima'] as const) {
    await openThread(page, character);
    await expect(page.getByText(/초기화 이전 .* 기록/)).toHaveCount(0);
  }
  expect(service.sessions()).toBe(1);
  if (process.env.CAPTURE_RESET)
    await page.screenshot({ path: `harness/evidence/issue-81/fresh-${testInfo.project.name}.png` });
  await page.reload();
  await unlockPhone(page);
  await openThread(page, 'haruka');
  await expect(page.getByText(/초기화 이전 .* 기록/)).toHaveCount(0);
  expect(service.sessions()).toBe(1);
  expect(service.old.haruka).toHaveLength(1);
  expect(service.old.majima).toHaveLength(1);
  expect(await page.evaluate((key) => !!localStorage.getItem(key), AI_RESET_KEY)).toBe(true);
});

test('열린 다른 탭에서도 초기화된 세션을 사용한다', async ({ page, context }) => {
  const service = await scopedService(context);
  await boot(page);
  await openThread(page, 'haruka');
  const other = await context.newPage();
  await boot(other);
  await openThread(other, 'majima');
  await expect(other.getByText('초기화 이전 마지마 기록', { exact: true })).toBeVisible();
  const third = await context.newPage();
  await boot(third);
  await openThread(third, 'haruka');
  const dialog = await resetDialog(page);
  await dialog.getByRole('button', { name: '초기화', exact: true }).tap();
  await expect(other.getByText('초기화 이전 마지마 기록', { exact: true })).toHaveCount(0);
  await expect(
    other.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      other.evaluate((key) => JSON.parse(localStorage.getItem(key)!).token, AI_CONNECTION_KEY),
    )
    .not.toBe('old-session');
  await expect(third.getByText('초기화 이전 하루카 기록', { exact: true })).toHaveCount(0);
  await expect(
    third.getByRole('textbox', { name: '하루카에게 메시지 입력', exact: true }),
  ).toHaveCount(0);
  await expect(
    third.getByText('메모의 장보기 목록부터 확인해 보세요.', { exact: true }),
  ).toHaveCount(0);
  expect(service.sessions()).toBe(1);
});

test('저장 실패 시 초기화하지 않고 기존 대화를 유지한다', async ({ page, context }, testInfo) => {
  await scopedService(context);
  await boot(page);
  await openThread(page, 'haruka');
  await page.evaluate((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error('quota');
      setItem.call(this, name, value);
    };
  }, AI_RESET_KEY);
  const dialog = await resetDialog(page);
  await dialog.getByRole('button', { name: '초기화', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toBeVisible();
  if (process.env.CAPTURE_RESET)
    await page.screenshot({
      path: `harness/evidence/issue-81/reset-error-${testInfo.project.name}.png`,
    });
  await dialog.getByRole('button', { name: '취소', exact: true }).tap();
  await openThread(page, 'haruka');
  await expect(page.getByText('초기화 이전 하루카 기록', { exact: true })).toBeVisible();
});
