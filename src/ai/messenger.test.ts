import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiMessenger } from './messenger';

const connection = { endpoint: 'https://mac.example.test', token: 'session-secret' };
const stores: AiMessenger[] = [];
const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};
const history = { messages: [], pending_job: null };

function readyFetch(url: string) {
  if (url.endsWith('/v1/health')) return Promise.resolve(Response.json({ status: 'ready' }));
  if (url.includes('/v1/history')) return Promise.resolve(Response.json(history));
  throw new Error('Unexpected request');
}
async function readyStore(fetch = vi.fn(readyFetch)) {
  vi.stubGlobal('fetch', fetch);
  const store = new AiMessenger(connection);
  stores.push(store);
  await store.refresh();
  return { store, fetch };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => {
  stores.splice(0).forEach((store) => store.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('연속 전송을 즉시 막고 늦은 답장은 해당 대화에만 넣는다', async () => {
  let resolvePost!: (response: Response) => void;
  const fetch = vi.fn((url: string) => {
    if (url.endsWith('/v1/chat'))
      return new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });
    if (url.endsWith('/v1/jobs/job-1'))
      return Promise.resolve(
        Response.json({
          job_id: 'job-1',
          character: 'haruka',
          status: 'complete',
          messages: [
            { id: 'u1', role: 'user', content: '오늘 어때?', time: '17:00' },
            { id: 'a1', role: 'assistant', content: '잘 지내고 있어요.', time: '17:01' },
          ],
        }),
      );
    return readyFetch(url);
  });
  const { store } = await readyStore(fetch);
  expect(store.send('haruka', '오늘 어때?', true, true)).toBe(true);
  expect(store.send('haruka', '오늘 어때?', true, true)).toBe(false);
  expect(store.send('majima', '숨겨진 앱', false, true)).toBe(false);
  resolvePost(Response.json({ job_id: 'job-1', status: 'queued' }));
  await flush();
  expect(store.getSnapshot().threads.haruka.messages.at(-1)?.content).toBe('잘 지내고 있어요.');
  expect(store.getSnapshot().threads.majima.messages).toEqual([]);
  expect(store.getSnapshot().threads.haruka.pending).toBeNull();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/v1/chat'))).toHaveLength(1);
});

it('POST 응답 유실 후 같은 request_id로 재시도한다', async () => {
  const bodies: Record<string, string>[] = [];
  const fetch = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/v1/chat')) {
      bodies.push(JSON.parse(String(options?.body)));
      return bodies.length === 1
        ? Promise.reject(new TypeError('lost response'))
        : Promise.resolve(Response.json({ job_id: 'job-1', status: 'queued' }));
    }
    if (url.includes('/v1/jobs/'))
      return Promise.resolve(
        Response.json({ job_id: 'job-1', character: 'majima', status: 'generating' }),
      );
    return readyFetch(url);
  });
  const { store } = await readyStore(fetch);
  store.send('majima', '형님', true, true);
  await flush();
  expect(store.getSnapshot().threads.majima.pending?.phase).toBe('failed');
  store.retry('majima', true, true);
  await flush();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(store.getSnapshot().threads.majima.pending?.jobId).toBe('job-1');
});

it('복구된 pending job은 재전송 없이 조회하고 polling 실패도 같은 job으로 재시도한다', async () => {
  let polls = 0;
  const fetch = vi.fn((url: string) => {
    if (url.endsWith('character=haruka'))
      return Promise.resolve(Response.json({ messages: [], pending_job: 'restored-job' }));
    if (url.includes('/v1/jobs/')) {
      polls += 1;
      if (polls === 1) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(
        Response.json({
          job_id: 'restored-job',
          character: 'haruka',
          status: 'complete',
          messages: [],
        }),
      );
    }
    return readyFetch(url);
  });
  const { store } = await readyStore(fetch);
  await flush();
  expect(store.getSnapshot().threads.haruka.pending?.phase).toBe('failed');
  store.retry('haruka', true, true);
  await flush();
  expect(store.getSnapshot().threads.haruka.pending).toBeNull();
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/v1/chat'))).toBe(false);
  expect(polls).toBe(2);
});

it('연결 해제 후 도착한 응답과 polling은 버리고 토큰을 삭제한다', async () => {
  let resolvePost!: (response: Response) => void;
  const fetch = vi.fn((url: string) =>
    url.endsWith('/v1/chat')
      ? new Promise<Response>((resolve) => {
          resolvePost = resolve;
        })
      : readyFetch(url),
  );
  const { store } = await readyStore(fetch);
  store.send('haruka', '안녕', true, true);
  store.disconnect();
  resolvePost(Response.json({ job_id: 'late-job', status: 'queued' }));
  await flush();
  await vi.advanceTimersByTimeAsync(2000);
  expect(store.getSnapshot().connection).toBeNull();
  expect(store.getSnapshot().threads.haruka.messages).toEqual([]);
  expect(fetch.mock.calls.some(([url]) => url.includes('/v1/jobs/'))).toBe(false);
  expect(localStorage.removeItem).toHaveBeenCalledWith('yaku-iphone.ai.connection.v1');
});

it('모델 미준비·오프라인·비활성 화면에서는 전송하지 않고 가짜 답변을 만들지 않는다', async () => {
  const { store, fetch } = await readyStore();
  expect(store.send('haruka', '안녕', false, true)).toBe(false);
  expect(store.send('haruka', '안녕', true, false)).toBe(false);
  store.setOnline(false);
  expect(store.send('haruka', '안녕', true, true)).toBe(false);
  fetch.mockImplementation(() => Promise.resolve(Response.json({ status: 'loading' })));
  store.setOnline(true);
  await flush();
  expect(store.getSnapshot().status).toBe('loading');
  expect(store.send('haruka', '안녕', true, true)).toBe(false);
  expect(store.getSnapshot().threads.haruka.messages).toEqual([]);
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/v1/chat'))).toBe(false);
});

it('서버 생성 오류는 안내하고 다음 메시지를 허용한다', async () => {
  const fetch = vi.fn((url: string) => {
    if (url.endsWith('/v1/chat'))
      return Promise.resolve(Response.json({ job_id: 'failed-job', status: 'queued' }));
    if (url.includes('/v1/jobs/'))
      return Promise.resolve(
        Response.json({
          job_id: 'failed-job',
          character: 'haruka',
          status: 'error',
          messages: [{ id: 'u1', role: 'user', content: '안녕', time: '17:00' }],
          error: { code: 'generation_failed', message: 'failure' },
        }),
      );
    return readyFetch(url);
  });
  const { store } = await readyStore(fetch);
  store.send('haruka', '안녕', true, true);
  await flush();
  expect(store.getSnapshot().threads.haruka.pending).toBeNull();
  expect(store.getSnapshot().threads.haruka.error).toContain('답장을 만들지 못했습니다');
  expect(store.getSnapshot().threads.haruka.messages).toHaveLength(1);
  expect(store.send('haruka', '다시 안녕', true, true)).toBe(true);
});

it('저장 실패가 발생해도 새 접속 정보는 현재 세션에서 유지한다', async () => {
  const { store } = await readyStore();
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw new Error('denied');
    },
  });
  store.connect({ endpoint: 'https://new.example.test', token: 'new-session' });
  await flush();
  expect(store.getSnapshot().connection).toEqual({
    endpoint: 'https://new.example.test',
    token: 'new-session',
  });
  expect(store.getSnapshot().storageUnavailable).toBe(true);
});

it('상태 확인이 POST를 중단해도 원 요청을 다시 시도할 수 있다', async () => {
  const bodies: Record<string, string>[] = [];
  const fetch = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/v1/chat')) {
      bodies.push(JSON.parse(String(options?.body)));
      return new Promise<Response>(() => {});
    }
    return readyFetch(url);
  });
  const { store } = await readyStore(fetch);
  store.send('haruka', '안녕', true, true);
  await store.refresh();
  expect(store.getSnapshot().threads.haruka.pending?.phase).toBe('failed');
  store.retry('haruka', true, true);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
});

it('토큰 삭제를 거부한 저장소는 연결 해제 후에도 명시적으로 안내한다', async () => {
  const { store } = await readyStore();
  vi.stubGlobal('localStorage', {
    removeItem: () => {
      throw new Error('denied');
    },
  });
  store.disconnect();
  expect(store.getSnapshot().connection).toBeNull();
  expect(store.getSnapshot().storageError).toContain('저장된 접속 정보를 지우지 못했습니다');
});

it.each(['새 질문', '이전 질문'])(
  '재마운트 후 실패 원문 %s는 과거 성공 메시지와 분리한다',
  async (message) => {
    const previous = [
      { id: 'old-user', role: 'user', content: '이전 질문', time: '2026-10-25T01:00:00Z' },
      {
        id: 'old-assistant',
        role: 'assistant',
        content: '이전 답변',
        time: '2026-10-25T01:00:00Z',
      },
    ];
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('character=haruka'))
        return Promise.resolve(Response.json({ messages: previous, pending_job: 'restored' }));
      if (url.includes('/v1/jobs/'))
        return Promise.resolve(
          Response.json({
            job_id: 'restored',
            character: 'haruka',
            status: 'error',
            messages: previous,
            request: { id: 'original-request', message, time: '2026-10-25T02:00:00Z' },
            error: { code: 'generation_failed', message: 'failure' },
          }),
        );
      return readyFetch(url);
    });
    const { store } = await readyStore(fetch);
    await flush();
    expect(store.getSnapshot().threads.haruka.failedMessage).toEqual({
      message,
      time: '2026-10-25T02:00:00Z',
      historyId: undefined,
      reason: 'reply',
    });
    expect(store.getSnapshot().threads.haruka.messages).toEqual(previous);
    expect(store.takeFailedMessage('haruka', true)?.message).toBe(message);
  },
);

it('서버 입력 한도인 1000자까지만 전송한다', async () => {
  const fetch = vi.fn((url: string) =>
    url.endsWith('/v1/chat') ? new Promise<Response>(() => {}) : readyFetch(url),
  );
  const { store } = await readyStore(fetch);
  expect(store.send('haruka', '가'.repeat(1001), true, true)).toBe(false);
  expect(store.send('haruka', '가'.repeat(1000), true, true)).toBe(true);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/v1/chat'))).toHaveLength(1);
});

it.each([400, 413, 422])(
  'POST %s 입력 거부는 원문을 보존하고 수정한 새 요청을 허용한다',
  async (status) => {
    const bodies: Record<string, string>[] = [];
    const fetch = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/v1/chat')) {
        bodies.push(JSON.parse(String(options?.body)));
        return bodies.length === 1
          ? Promise.resolve(Response.json({ error: { code: 'invalid_input' } }, { status }))
          : Promise.resolve(Response.json({ job_id: 'new-job', status: 'queued' }));
      }
      if (url.includes('/v1/jobs/'))
        return Promise.resolve(
          Response.json({ job_id: 'new-job', character: 'haruka', status: 'generating' }),
        );
      return readyFetch(url);
    });
    const { store } = await readyStore(fetch);
    store.send('haruka', '원래 메시지', true, true);
    await flush();
    expect(store.getSnapshot().threads.haruka.pending).toBeNull();
    expect(store.getSnapshot().threads.haruka.failedMessage?.message).toBe('원래 메시지');
    expect(store.takeFailedMessage('haruka', false)).toBeNull();
    expect(store.takeFailedMessage('haruka', true)?.message).toBe('원래 메시지');
    expect(store.getSnapshot().threads.haruka.failedMessage).toBeNull();
    expect(store.send('haruka', '수정한 메시지', true, true)).toBe(true);
    await flush();
    expect(bodies[1].request_id).not.toBe(bodies[0].request_id);
    expect(bodies[1].message).toBe('수정한 메시지');
  },
);

it.each([
  ['context_limit', '대화가 길이 한도에 도달했습니다'],
  ['output_limit', '답장이 길이 한도 안에서 끝나지 않았습니다'],
])('%s 생성 오류의 원문과 사용자 안내를 보존한다', async (code, text) => {
  const fetch = vi.fn((url: string) => {
    if (url.endsWith('/v1/chat'))
      return Promise.resolve(Response.json({ job_id: 'failed-job', status: 'queued' }));
    if (url.includes('/v1/jobs/'))
      return Promise.resolve(
        Response.json({
          job_id: 'failed-job',
          character: 'haruka',
          status: 'error',
          messages: [],
          error: { code, message: 'private-server-trace' },
        }),
      );
    return readyFetch(url);
  });
  const { store } = await readyStore(fetch);
  store.send('haruka', '원래 질문', true, true);
  await flush();
  const failed = store.getSnapshot().threads.haruka;
  expect(failed.pending).toBeNull();
  expect(failed.failedMessage?.message).toBe('원래 질문');
  expect(failed.error).toContain(text);
  expect(failed.error).not.toContain('private-server-trace');
  expect(store.takeFailedMessage('haruka', true)?.message).toBe('원래 질문');
  expect(store.send('haruka', '짧은 질문', true, true)).toBe(true);
});
