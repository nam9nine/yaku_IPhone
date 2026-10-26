import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiMessenger } from './messenger';
import { AI_ENDPOINT } from './config';
import type { AiCharacter, AiMessage } from './client';

const connection = { endpoint: AI_ENDPOINT, token: 'existing-session' };
const stores: AiMessenger[] = [];
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function mockService() {
  const state = {
    chats: [] as { character: AiCharacter; message: string; request_id: string }[],
    history: { haruka: [], majima: [] } as Record<AiCharacter, AiMessage[]>,
    sessions: 0,
    polls: 0,
    hold: false,
    queued: false,
    losePost: false,
    reject: 0,
    fail: '',
    nextCursor: null as string | null,
    old: [] as AiMessage[],
  };
  const fetch = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    if (url.endsWith('/v1/health')) return Response.json({ status: 'ready' });
    if (url.endsWith('/v1/sessions')) {
      state.sessions++;
      return Response.json({ token: 'new-session' });
    }
    if (url.includes('/v1/history')) {
      const query = new URL(url).searchParams;
      const character = query.get('character') as AiCharacter;
      const pending = state.history[character].find((message) =>
        ['queued', 'generating'].includes(message.status ?? ''),
      );
      return Response.json({
        messages: query.has('cursor') ? state.old : state.history[character],
        pending_job: pending?.job_id ?? null,
        next_cursor: query.has('cursor') ? null : state.nextCursor,
      });
    }
    if (url.endsWith('/v1/chat')) {
      const body = JSON.parse(String(options?.body));
      state.chats.push(body);
      if (state.reject) return Response.json({}, { status: state.reject });
      if (
        !state.history[body.character as AiCharacter].some(
          (message) => message.request_id === body.request_id,
        )
      )
        state.history[body.character as AiCharacter].push({
          id: 'job-1-user',
          role: 'user',
          content: body.message,
          time: '2026-10-26T00:00:00Z',
          status: 'queued',
          request_id: body.request_id,
          job_id: 'job-1',
        });
      if (state.losePost) {
        state.losePost = false;
        throw new Error('connection lost');
      }
      return Response.json({ job_id: 'job-1', status: 'queued' });
    }
    if (url.endsWith('/v1/jobs/job-1')) {
      state.polls++;
      const character = state.history.haruka.some((m) => m.job_id === 'job-1')
        ? 'haruka'
        : 'majima';
      const user = state.history[character].find((m) => m.job_id === 'job-1')!;
      const status = state.hold
        ? state.queued
          ? 'queued'
          : 'generating'
        : state.fail
          ? 'error'
          : 'complete';
      user.status = status;
      if (
        status === 'complete' &&
        !state.history[character].some((m) => m.id === 'job-1-assistant')
      )
        state.history[character].push({
          id: 'job-1-assistant',
          role: 'assistant',
          content: '실제 응답 자리',
          time: '2026-10-26T00:00:01Z',
          status: 'complete',
        });
      return Response.json({
        job_id: 'job-1',
        character,
        status,
        request: { id: user.request_id, message: user.content, time: user.time },
        ...(state.fail ? { error: { code: state.fail, message: 'private server trace' } } : {}),
      });
    }
    throw new Error('Unexpected request: ' + url);
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}
function store(initial: typeof connection | null = connection) {
  const value = new AiMessenger(initial);
  stores.push(value);
  return value;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => {
  stores.splice(0).forEach((value) => value.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('AI 연락처를 열기 전에는 요청·익명 세션을 만들지 않는다', async () => {
  const { fetch, state } = mockService();
  const value = store(null);
  await value.activate(null);
  await value.refresh();
  expect(fetch).not.toHaveBeenCalled();
  await value.activate('haruka');
  expect(state.sessions).toBe(1);
  expect(value.getSnapshot().threads.haruka.loaded).toBe(true);
  expect(value.getSnapshot().threads.majima.loaded).toBe(false);
  expect(value.getSnapshot().status).toBe('ready');
});
it('한 번 만든 토큰을 재사용하고 방문자가 키나 URL을 입력하지 않는다', async () => {
  const { state, fetch } = mockService();
  const value = store(null);
  await value.activate('haruka');
  await value.activate('majima');
  await value.refresh();
  expect(state.sessions).toBe(1);
  const session = fetch.mock.calls.find(([url]) => url.endsWith('/v1/sessions'))!;
  expect(JSON.parse(String(session[1]?.body))).toEqual({});
  expect(fetch.mock.calls.every(([url]) => url.startsWith(AI_ENDPOINT))).toBe(true);
});
it.each(['/v1/health', '/v1/history?character=haruka'])(
  '초기 %s 중 빠른 오프라인·온라인 전환은 새 연결로 기록을 복구한다',
  async (pendingPath) => {
    const { fetch, state } = mockService();
    const real = fetch.getMockImplementation()!;
    let held = false;
    fetch.mockImplementation((url, options) => {
      if (!held && url.endsWith(pendingPath)) {
        held = true;
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      }
      return real(url, options);
    });
    const value = store(null);
    const initial = value.activate('haruka');
    await flush();
    expect(held).toBe(true);
    value.setOnline(false);
    value.setOnline(true);
    await initial;
    await flush();
    expect(value.getSnapshot().status).toBe('ready');
    expect(value.getSnapshot().threads.haruka.loaded).toBe(true);
    expect(value.getSnapshot().threads.haruka.loading).toBe(false);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/v1/health'))).toHaveLength(2);
    expect(state.sessions).toBe(1);
    expect(state.chats).toEqual([]);
  },
);
it('중단한 기록 요청의 로딩 상태가 다른 연락처 활성화 뒤 원래 연락처를 막지 않는다', async () => {
  const { fetch } = mockService();
  const real = fetch.getMockImplementation()!;
  let held = false;
  fetch.mockImplementation((url, options) => {
    if (!held && url.endsWith('/v1/history?character=haruka')) {
      held = true;
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    }
    return real(url, options);
  });
  const value = store();
  const initial = value.activate('haruka');
  await flush();
  expect(value.getSnapshot().threads.haruka.loading).toBe(true);
  value.stop();
  await value.activate('majima');
  await initial;
  await value.activate('haruka');
  expect(value.getSnapshot().status).toBe('ready');
  expect(value.getSnapshot().threads.haruka.loaded).toBe(true);
  expect(value.getSnapshot().threads.majima.loaded).toBe(true);
});
it('이전 연결의 늦은 종료가 새 연결의 공유 Promise를 지우지 않는다', async () => {
  const { fetch, state } = mockService();
  const real = fetch.getMockImplementation()!;
  const healthReplies: ((response: Response) => void)[] = [];
  fetch.mockImplementation((url, options) =>
    url.endsWith('/v1/health')
      ? new Promise((resolve) => healthReplies.push(resolve))
      : real(url, options),
  );
  const value = store(null);
  const initial = value.activate('haruka');
  value.stop();
  const reactivated = value.activate('haruka');
  const current = value.refresh();
  expect(healthReplies).toHaveLength(2);
  healthReplies[0](Response.json({ status: 'ready' }));
  await initial;
  expect(value.refresh()).toBe(current);
  expect(healthReplies).toHaveLength(2);
  healthReplies[1](Response.json({ status: 'ready' }));
  await Promise.all([reactivated, current]);
  expect(value.getSnapshot().status).toBe('ready');
  expect(value.getSnapshot().threads.haruka.loaded).toBe(true);
  expect(state.sessions).toBe(1);
});
it('첫 401은 자동 갱신하고 새 토큰까지 거부되면 반복 발급하지 않는다', async () => {
  let sessions = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/v1/health')) return Response.json({ status: 'ready' });
      if (url.endsWith('/v1/sessions')) {
        sessions++;
        return Response.json({ token: 'new-session' });
      }
      return Response.json({}, { status: 401 });
    }),
  );
  const value = store();
  await value.activate('haruka');
  expect(sessions).toBe(1);
  expect(value.getSnapshot().status).toBe('error');
  await value.refresh();
  expect(sessions).toBe(1);
});
it('만료된 토큰의 401 뒤 자동 발급한 토큰으로 기록을 복구한다', async () => {
  let sessions = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/v1/health')) return Response.json({ status: 'ready' });
      if (url.endsWith('/v1/sessions')) {
        sessions++;
        return Response.json({ token: 'new-session' });
      }
      if ((options?.headers as Record<string, string>).Authorization === 'Bearer existing-session')
        return Response.json({}, { status: 401 });
      return Response.json({ messages: [], pending_job: null, next_cursor: null });
    }),
  );
  const value = store();
  await value.activate('haruka');
  expect(sessions).toBe(1);
  expect(value.getSnapshot().status).toBe('ready');
  expect(value.getSnapshot().connection?.token).toBe('new-session');
});
it('연속·다른 인물 동시 전송을 막고 답장은 원래 대화에 넣는다', async () => {
  const { state } = mockService();
  state.hold = true;
  const value = store();
  await value.activate('haruka');
  expect(value.send('haruka', '오늘 어때?', true, true)).toBe(true);
  expect(value.send('haruka', '연속 입력', true, true)).toBe(false);
  await flush();
  await value.activate('majima');
  expect(value.send('majima', '다른 대화', true, true)).toBe(false);
  state.hold = false;
  await vi.advanceTimersByTimeAsync(1000);
  await flush();
  expect(value.getSnapshot().threads.haruka.messages.at(-1)?.content).toBe('실제 응답 자리');
  expect(value.getSnapshot().threads.majima.messages).toEqual([]);
  expect(state.chats).toHaveLength(1);
});
it('POST 응답 유실 후 같은 UUID로 재시도한다', async () => {
  const { state } = mockService();
  state.losePost = true;
  state.hold = true;
  const value = store();
  await value.activate('majima');
  value.send('majima', '형님', true, true);
  await flush();
  expect(value.getSnapshot().threads.majima.pending?.phase).toBe('failed');
  value.retry('majima', true, true);
  await flush();
  expect(state.chats).toHaveLength(2);
  expect(state.chats[1]).toEqual(state.chats[0]);
  expect(state.history.majima).toHaveLength(1);
});
it('유실된 접수는 새로고침으로 복구하고 재전송하지 않는다', async () => {
  const { state } = mockService();
  state.losePost = true;
  state.hold = true;
  const value = store();
  await value.activate('haruka');
  value.send('haruka', '보존할 문자', true, true);
  await flush();
  await value.refresh();
  await flush();
  expect(value.getSnapshot().threads.haruka.pending?.jobId).toBe('job-1');
  expect(state.chats).toHaveLength(1);
});
it('오래된 이관 메시지의 null job_id가 미접수 문자를 지우지 않는다', async () => {
  const { state, fetch } = mockService();
  state.history.haruka = [
    { id: 'legacy', role: 'user', content: '옛 질문', time: null, job_id: null },
  ];
  const real = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, options) =>
    url.endsWith('/v1/chat') ? Promise.reject(new Error('offline')) : real(url, options),
  );
  const value = store();
  await value.activate('haruka');
  value.send('haruka', '새 질문', true, true);
  await flush();
  await value.refresh();
  expect(value.getSnapshot().threads.haruka.pending?.message).toBe('새 질문');
});
it('실패 원문은 서버 기록과 중복하지 않고 생성 실패 출력을 답장으로 표시하지 않는다', async () => {
  const { state } = mockService();
  state.fail = 'response_truncated';
  const value = store();
  await value.activate('haruka');
  value.send('haruka', '원래 질문', true, true);
  await flush();
  const thread = value.getSnapshot().threads.haruka;
  expect(thread.messages).toHaveLength(1);
  expect(thread.failedMessage?.historyId).toBe('job-1-user');
  expect(thread.error).toContain('답장이 길이 한도');
  expect(thread.error).not.toContain('private server trace');
  expect(thread.pending).toBeNull();
  expect(value.takeFailedMessage('haruka', true)?.message).toBe('원래 질문');
});
it.each([400, 413, 422])(
  '입력 거절 %s은 수정할 원문을 남기고 새 요청을 허용한다',
  async (status) => {
    const { state } = mockService();
    state.reject = status;
    const value = store();
    await value.activate('haruka');
    value.send('haruka', '수정할 문자', true, true);
    await flush();
    expect(value.getSnapshot().threads.haruka.pending).toBeNull();
    expect(value.takeFailedMessage('haruka', false)).toBeNull();
    expect(value.takeFailedMessage('haruka', true)?.message).toBe('수정할 문자');
    state.reject = 0;
    value.send('haruka', '짧은 문자', true, true);
    await flush();
    expect(state.chats[0].request_id).not.toBe(state.chats[1].request_id);
  },
);
it('이전 페이지를 중복 없이 붙이고 최신 기록 복구 때 지우지 않는다', async () => {
  const { state } = mockService();
  state.nextCursor = 'signed-cursor';
  state.history.haruka = [{ id: 'recent', role: 'assistant', content: '최신 답장', time: null }];
  state.old = [
    { id: 'old', role: 'user', content: '옛 질문', time: null },
    state.history.haruka[0],
  ];
  const value = store();
  await value.activate('haruka');
  await value.loadOlder('haruka');
  expect(value.getSnapshot().threads.haruka.messages.map((m) => m.id)).toEqual(['old', 'recent']);
  await value.refresh();
  expect(value.getSnapshot().threads.haruka.messages.map((m) => m.id)).toEqual(['old', 'recent']);
  expect(value.getSnapshot().threads.haruka.nextCursor).toBeNull();
});
it('대기 상태 조회는 점점 늦추고 생성 상태는 1초마다 조회한다', async () => {
  const { state } = mockService();
  state.hold = true;
  state.queued = true;
  const value = store();
  await value.activate('haruka');
  value.send('haruka', '질문', true, true);
  await flush();
  expect(state.polls).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.polls).toBe(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.polls).toBe(2);
  state.queued = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.polls).toBe(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.polls).toBe(4);
});
it('숨겨진 화면은 조회를 줄이고 복귀하면 즉시 작업 상태를 확인한다', async () => {
  const { state } = mockService();
  state.hold = true;
  const value = store();
  await value.activate('haruka');
  value.send('haruka', '질문', true, true);
  await flush();
  value.setVisible(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.polls).toBe(1);
  value.setVisible(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(state.polls).toBe(2);
});
it('가상 오프라인·비활성·길이 제한은 전송을 막고 복구해도 초안을 보내지 않는다', async () => {
  const { state } = mockService();
  const value = store();
  await value.activate('haruka');
  expect(value.send('haruka', '안녕', false, true)).toBe(false);
  expect(value.send('haruka', '안녕', true, false)).toBe(false);
  expect(value.send('haruka', '가'.repeat(1001), true, true)).toBe(false);
  value.setOnline(false);
  expect(value.send('haruka', '안녕', true, true)).toBe(false);
  value.setOnline(true);
  await flush();
  expect(state.chats).toEqual([]);
});
it('저장 거부에도 발급한 토큰은 현재 화면에서 유지한다', async () => {
  const { state } = mockService();
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: vi.fn(),
  });
  const value = store(null);
  await value.activate('haruka');
  await value.activate('majima');
  expect(state.sessions).toBe(1);
  expect(value.getSnapshot().storageUnavailable).toBe(true);
});
it('중단 후 늦은 응답이 도착해도 상태를 변경하지 않는다', async () => {
  const { fetch } = mockService();
  const real = fetch.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  fetch.mockImplementation((url, options) =>
    url.endsWith('/v1/chat')
      ? new Promise((done) => {
          resolve = done;
        })
      : real(url, options),
  );
  const value = store();
  await value.activate('haruka');
  value.send('haruka', '질문', true, true);
  value.stop();
  resolve(Response.json({ job_id: 'late' }));
  await flush();
  expect(fetch.mock.calls.some(([url]) => url.includes('/v1/jobs/'))).toBe(false);
});

it('다른 탭에서 초기화한 직후 옛 요청을 막고 늦은 이력 응답과 토큰 저장을 버린다', async () => {
  const { AI_RESET_KEY, AI_CONNECTION_KEY } = await import('./connection');
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  let release!: (value: Response) => void;
  let started = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/v1/health')) return Response.json({ status: 'ready' });
      if (url.endsWith('/v1/sessions')) return Response.json({ token: 'fresh-session' });
      if (url.includes('/v1/history')) {
        if (!values.has(AI_RESET_KEY)) {
          started = true;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return Response.json({ messages: [], pending_job: null, next_cursor: null });
      }
      throw new Error('An old request must not be sent');
    }),
  );
  const value = store();
  const initial = value.activate('haruka');
  await flush();
  expect(started).toBe(true);
  values.set(AI_RESET_KEY, 'new-scope');
  expect(value.send('haruka', '옛 세션에 보내지 않음', true, true)).toBe(false);
  value.syncReset();
  await flush();
  release(
    Response.json({
      messages: [{ id: 'old-message', role: 'assistant', content: '옛 기억', time: null }],
      pending_job: null,
      next_cursor: null,
    }),
  );
  await initial;
  await flush();
  expect(value.getSnapshot().threads.haruka.messages).toEqual([]);
  expect(value.getSnapshot().threads.majima.messages).toEqual([]);
  expect(value.getSnapshot().connection?.token).toBe('fresh-session');
  expect(JSON.parse(values.get(AI_CONNECTION_KEY)!)).toMatchObject({
    token: 'fresh-session',
    resetId: 'new-scope',
  });
});

it('초기화 전에 생성 중이던 답장이 늦게 끝나도 새 이력이나 알림에 들어오지 않는다', async () => {
  const { AI_RESET_KEY } = await import('./connection');
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  let release!: (value: Response) => void;
  let oldHistoryCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/v1/health')) return Response.json({ status: 'ready' });
      if (url.endsWith('/v1/sessions')) return Response.json({ token: 'fresh-session' });
      if (url.includes('/v1/history')) {
        if (new Headers(options?.headers).get('Authorization') === `Bearer ${connection.token}`)
          oldHistoryCalls++;
        return Response.json({ messages: [], pending_job: null, next_cursor: null });
      }
      if (url.endsWith('/v1/chat')) return Response.json({ job_id: 'old-job', status: 'queued' });
      if (url.endsWith('/v1/jobs/old-job'))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      throw new Error('Unexpected request');
    }),
  );
  const value = store();
  await value.activate('haruka');
  expect(value.send('haruka', '초기화 전 문자', true, true)).toBe(true);
  await flush();
  expect(release).toBeDefined();
  values.set(AI_RESET_KEY, 'after-reset');
  value.syncReset();
  await flush();
  release(
    Response.json({
      job_id: 'old-job',
      character: 'haruka',
      status: 'complete',
      reply: '늦은 옛 답장',
    }),
  );
  await flush();
  expect(oldHistoryCalls).toBe(1);
  expect(value.getSnapshot().threads.haruka.messages).toEqual([]);
  expect(value.getSnapshot().threads.haruka.pending).toBeNull();
  expect(value.getSnapshot().connection?.token).toBe('fresh-session');
});

it('빠른 생성도 즉시 답장/타이핑을 노출하지 않고 10~20초 뒤 타이핑과 완성 답장을 순서대로 보인다', async () => {
  const { state } = mockService();
  const value = store();
  await value.activate('haruka');
  expect(value.send('haruka', '잘 지내?', true, true)).toBe(true);
  await flush();
  const thread = () => value.getSnapshot().threads.haruka;
  expect(state.polls).toBe(1);
  expect(thread().messages.at(-1)?.role).toBe('assistant');
  expect(thread().displayedMessages.some((m) => m.role === 'assistant')).toBe(false);
  expect(thread().typing).toBe(false);
  expect(value.send('haruka', '또 보낸다', true, true)).toBe(false);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(thread().typing).toBe(false);
  await vi.advanceTimersByTimeAsync(10_001);
  // Its deterministic typing delay can end earlier than 20 seconds.
  if (thread().deliveryPending) expect(thread().typing).toBe(true);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(thread().typing).toBe(false);
  expect(thread().displayedMessages.at(-1)?.content).toBe('실제 응답 자리');
  expect(thread().unread).toBe(false);
  expect(value.getSnapshot().notification).toBeNull();
});

it('늦은 생성은 타이핑을 유지하고 다른 앱으로 이동한 뒤 도착하면 읽지 않은 알림을 한 번 만든다', async () => {
  const { state } = mockService();
  state.hold = true;
  const value = store();
  await value.activate('majima');
  value.send('majima', '어디야?', true, true);
  await flush();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(value.getSnapshot().threads.majima.typing).toBe(true);
  expect(value.getSnapshot().threads.majima.displayedMessages).toHaveLength(0);
  await value.activate(null);
  value.setVisible(false);
  state.hold = false;
  await vi.advanceTimersByTimeAsync(16_000);
  expect(value.getSnapshot().threads.majima.unread).toBe(true);
  expect(value.getSnapshot().unreadReplies).toHaveLength(1);
  expect(value.getSnapshot().notification?.character).toBe('majima');
  value.dismissNotification();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(value.getSnapshot().notification).toBeNull();
  value.setVisible(true);
  await value.activate('majima');
  expect(value.getSnapshot().threads.majima.unread).toBe(false);
  expect(value.getSnapshot().unreadReplies).toHaveLength(0);
});

it('완성된 답장이 있어도 새로고침은 원래 대기 시간을 우회하지 않으며 이후 새로고침은 재알림하지 않는다', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, text: string) => values.set(key, text),
    removeItem: (key: string) => values.delete(key),
  });
  mockService();
  const first = store();
  await first.activate('haruka');
  first.send('haruka', '오늘은 어때?', true, true);
  await flush();
  first.stop();
  const next = store();
  await next.activate('haruka');
  expect(
    next.getSnapshot().threads.haruka.displayedMessages.some((m) => m.role === 'assistant'),
  ).toBe(false);
  await next.activate(null);
  next.setVisible(false);
  await vi.advanceTimersByTimeAsync(22_000);
  expect(next.getSnapshot().notification?.character).toBe('haruka');
  next.stop();
  const third = store();
  third.setVisible(false);
  third.resume();
  await flush();
  expect(third.getSnapshot().threads.haruka.unread).toBe(true);
  expect(third.getSnapshot().notification).toBeNull();
  expect(third.getSnapshot().unreadReplies).toHaveLength(1);
});

it('처음 불러온 과거 답장과 생성 실패에는 새 답장 알림이나 타이핑이 없다', async () => {
  const { state } = mockService();
  state.history.haruka = [
    { id: 'old-answer', role: 'assistant', content: '오래된 답장', time: null },
  ];
  const value = store();
  await value.activate('haruka');
  expect(value.getSnapshot().threads.haruka.displayedMessages).toHaveLength(1);
  expect(value.getSnapshot().notification).toBeNull();
  expect(value.getSnapshot().threads.haruka.unread).toBe(false);
  state.fail = 'output_limit';
  value.send('haruka', '실패하는 요청', true, true);
  await flush();
  await vi.advanceTimersByTimeAsync(22_000);
  expect(value.getSnapshot().threads.haruka.typing).toBe(false);
  expect(value.getSnapshot().notification).toBeNull();
});
