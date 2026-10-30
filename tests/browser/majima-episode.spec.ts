import { expect, test, type Page, type Route } from '../helpers/browser-test';
import { AI_ENDPOINT } from '../../src/ai/config';
import type { AiMessage } from '../../src/ai/client';
import { installAiClock, finishAiReply, settleAiRequests } from '../helpers/ai-clock';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';
async function mockEpisode(page: Page) {
  await installAiClock(page);
  const state = {
    stage: 'waiting',
    owner: '',
    reports: [] as Record<string, unknown>[],
    history: [] as AiMessage[],
    legacy: 0,
    chats: [] as Record<string, string>[],
    holdInvitation: false,
    loseClaimOnce: false,
    userJob: '',
  };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  const status = (accepted?: boolean) => ({
    protocol: 1,
    enabled: true,
    episode: {
      episode_id: 'majima-bowling-v1',
      instance_id: 'fixture',
      version: 1,
      phase: 'awaiting_reply',
      contact_stage: state.stage,
    },
    action:
      state.stage === 'invitation'
        ? { kind: 'message', id: 'invite-action', job_id: 'invite-job' }
        : state.stage === 'call'
          ? { kind: 'call', id: 'call-action', call_id: 'episode-call-1' }
          : state.stage === 'followup'
            ? { kind: 'message', id: 'followup-action', job_id: 'followup-job' }
            : null,
    ...(accepted === undefined ? {} : { accepted }),
  });
  await page.context().route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return json(route, {});
    if (url.pathname === '/v1/health')
      return json(route, { status: 'ready', episode_protocol: 1, episodes_enabled: true });
    if (url.pathname === '/v1/sessions') return json(route, { token: 'episode-fixture-session' });
    if (url.pathname === '/v1/episodes/majima') {
      if (request.method() === 'GET') return json(route, status());
      const body = request.postDataJSON();
      state.reports.push(body);
      if (body.kind === 'call_started') {
        const accepted = !state.owner || state.owner === body.client_id;
        if (accepted) {
          state.owner = body.client_id;
          state.stage = 'calling';
        }
        if (state.loseClaimOnce) {
          state.loseClaimOnce = false;
          return route.abort('connectionfailed');
        }
        return json(route, status(accepted));
      }
      if (body.kind === 'call_result') {
        state.stage = body.outcome === 'ended' ? 'rest' : 'followup';
        return json(route, status(true));
      }
      if (body.kind === 'delivered') {
        state.stage = body.job_id === 'invite-job' ? 'delivered' : 'rest';
        return json(route, status(true));
      }
      return json(route, status());
    }
    if (url.pathname === '/v1/history')
      return json(route, {
        messages:
          url.searchParams.get('character') === 'majima'
            ? state.history.filter(
                (message) =>
                  message.request_kind !== 'proactive_episode' ||
                  url.searchParams.get('episodes') === '1',
              )
            : [],
        pending_job: null,
        next_cursor: null,
      });
    if (url.pathname === '/v1/chat') {
      const body = request.postDataJSON();
      state.chats.push(body);
      state.userJob = body.request_id;
      state.stage = 'rest';
      return json(route, { job_id: body.request_id, status: 'queued' }, 202);
    }
    if (url.pathname === '/v1/call-followups') {
      state.legacy++;
      return json(route, {}, 409);
    }
    if (url.pathname.startsWith('/v1/jobs/')) {
      const job = url.pathname.split('/').at(-1)!;
      if (job === state.userJob) {
        const body = state.chats.at(-1)!;
        return json(route, {
          job_id: job,
          character: body.character,
          status: 'generating',
          request: { id: body.request_id, message: body.message, time: new Date().toISOString() },
        });
      }
      const followup = job === 'followup-job';
      const kind = followup ? 'call_followup' : 'proactive_episode';
      const request = {
        id: `${job}-request`,
        kind,
        time: new Date().toISOString(),
        ...(followup
          ? { trigger: { call_id: 'episode-call-1', reason: 'declined', direction: 'incoming' } }
          : {}),
      };
      if (!followup && state.holdInvitation)
        return json(route, {
          job_id: job,
          character: 'majima',
          status: 'generating',
          request_kind: kind,
          request,
        });
      if (!state.history.some((row) => row.job_id === job))
        state.history.push({
          id: `${job}-reply`,
          role: 'assistant',
          content: followup
            ? '볼링 얘기 마저 해야지. 나중에 연락해라!'
            : '키류쨩, 볼링 한 판 하자!',
          time: new Date().toISOString(),
          status: 'complete',
          request_id: request.id,
          job_id: job,
          request_kind: kind,
        });
      return json(route, {
        job_id: job,
        character: 'majima',
        status: 'complete',
        request_kind: kind,
        request,
      });
    }
    return json(route, {}, 404);
  });
  return state;
}

test('사건 초대 → 전화 → 후속 문자 한 번과 기록 복원을 연결한다', async ({ page }, info) => {
  const service = await mockEpisode(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
  await expect
    .poll(() => service.reports.some((row) => row.kind === 'presence' && row.active))
    .toBe(true);
  service.stage = 'invitation';
  await page.clock.runFor(10_000);
  await settleAiRequests(page);
  await finishAiReply(page, 'majima');
  await expect.poll(() => service.reports.filter((row) => row.kind === 'delivered').length).toBe(1);
  service.stage = 'call';
  await page.clock.runFor(10_000);
  await expect(page.getByRole('button', { name: '전화 거절', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '전화 거절', exact: true }).tap();
  await expect
    .poll(() => service.reports.filter((row) => row.kind === 'call_result').length)
    .toBe(1);
  await settleAiRequests(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  const log = page.getByRole('log', { name: '마지마 고로와의 대화' });
  await expect(log.getByText('키류쨩, 볼링 한 판 하자!', { exact: true })).toHaveCount(1);
  await expect(
    log.getByText('볼링 얘기 마저 해야지. 나중에 연락해라!', { exact: true }),
  ).toHaveCount(1);
  expect(service.legacy).toBe(0);
  expect(service.chats).toEqual([]);
  await page.screenshot({ path: info.outputPath('bowling-followup.png') });
  await page.reload();
  await unlockPhone(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  await expect(
    log.getByText('볼링 얘기 마저 해야지. 나중에 연락해라!', { exact: true }),
  ).toHaveCount(1);
  await expect(log.getByText('키류쨩, 볼링 한 판 하자!', { exact: true })).toHaveCount(1);
  expect(service.reports.filter((row) => row.kind === 'call_started')).toHaveLength(1);
  expect(service.reports.filter((row) => row.kind === 'call_result')).toHaveLength(1);
});

test('선제 추론 중에도 사용자가 전송하고 일반 답장 대기 때 활성 시간을 멈춘다', async ({
  page,
}) => {
  const service = await mockEpisode(page);
  service.holdInvitation = true;
  await page.goto('./');
  await unlockPhone(page);
  await expect
    .poll(() => service.reports.some((row) => row.kind === 'presence' && row.active))
    .toBe(true);
  service.stage = 'invitation';
  await page.clock.runFor(10_000);
  await settleAiRequests(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  const composer = page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true });
  await composer.fill('형님 오늘은 못 갑니다.');
  await page.getByRole('button', { name: '메시지 보내기', exact: true }).tap();
  await expect.poll(() => service.chats.length).toBe(1);
  expect(service.chats[0].message).toBe('형님 오늘은 못 갑니다.');
  await expect
    .poll(() => service.reports.filter((row) => row.kind === 'presence').at(-1)?.active)
    .toBe(false);
});

test('전화 claim 응답이 유실되어도 같은 소유자가 한 번만 울리고 후속을 보고한다', async ({
  page,
}) => {
  const service = await mockEpisode(page);
  await page.goto('./');
  await unlockPhone(page);
  await expect
    .poll(() => service.reports.some((row) => row.kind === 'presence' && row.active))
    .toBe(true);
  service.stage = 'call';
  service.loseClaimOnce = true;
  await page.clock.runFor(10_000);
  await settleAiRequests(page);
  await expect.poll(() => service.owner.length > 0).toBe(true);
  await page.clock.runFor(10_000);
  await settleAiRequests(page);
  const call = page.getByRole('button', { name: '전화 거절', exact: true });
  await expect(call).toBeVisible();
  expect(
    new Set(service.reports.filter((row) => row.kind === 'call_started').map((row) => row.call_id))
      .size,
  ).toBe(1);
  await page.getByRole('button', { name: '전화 거절', exact: true }).tap();
  await expect
    .poll(() => service.reports.filter((row) => row.kind === 'call_result').length)
    .toBe(1);
  expect(service.legacy).toBe(0);
});

test('같은 방문자의 두 탭은 한 소유자만 사건 전화를 울린다', async ({ page, context }) => {
  const service = await mockEpisode(page);
  await page.goto('./');
  await unlockPhone(page);
  await expect
    .poll(() => service.reports.some((row) => row.kind === 'presence' && row.active))
    .toBe(true);
  const second = await context.newPage();
  await installAiClock(second);
  await second.goto('./');
  await unlockPhone(second);
  await expect
    .poll(
      () =>
        new Set(
          service.reports.filter((row) => row.kind === 'presence').map((row) => row.client_id),
        ).size,
    )
    .toBe(2);
  service.stage = 'call';
  await Promise.all([page.clock.runFor(10_000), second.clock.runFor(10_000)]);
  await Promise.all([settleAiRequests(page), settleAiRequests(second)]);
  await expect
    .poll(async () => {
      const calls = await Promise.all(
        [page, second].map((tab) =>
          tab.getByRole('button', { name: '전화 거절', exact: true }).count(),
        ),
      );
      return calls.reduce((sum, count) => sum + count, 0);
    })
    .toBe(1);
  expect(service.owner).toBeTruthy();
  expect(service.legacy).toBe(0);
});
