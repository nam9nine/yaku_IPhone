import { afterEach, expect, it, vi } from 'vitest';
import {
  aiRequest,
  createSession,
  getHistory,
  getJob,
  shouldSendOnEnter,
  postChat,
  generationError,
} from './client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('익명 세션은 빈 본문으로 시작하고 토큰은 Authorization에만 둔다', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ token: 'session-secret' }))
    .mockResolvedValueOnce(Response.json({ messages: [], pending_job: null, next_cursor: null }));
  vi.stubGlobal('fetch', fetch);
  const connection = await createSession('https://new.example.test');
  await getHistory(connection, 'haruka');
  expect(fetch.mock.calls[0][0]).toBe('https://new.example.test/v1/sessions');
  expect(fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({});
  expect(fetch.mock.calls[1][0]).toBe('https://new.example.test/v1/history?character=haruka');
  expect(fetch.mock.calls[1][1]).toMatchObject({
    headers: { Authorization: 'Bearer session-secret' },
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
});

it('다른 대화 상대 또는 작업의 응답을 거부한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        job_id: 'job-1',
        character: 'majima',
        status: 'complete',
        messages: [],
      }),
    ),
  );
  await expect(
    getJob({ endpoint: 'https://mac.example.test', token: 'secret' }, 'job-1', 'haruka'),
  ).rejects.toThrow();
});

it('응답이 없는 네트워크 요청은 제한 시간 후 중단한다', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    (_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal = options.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const request = aiRequest('https://mac.example.test', '/v1/health');
  const rejection = expect(request).rejects.toThrow('대화에 연결할 수 없습니다');
  await vi.advanceTimersByTimeAsync(12_000);
  await rejection;
  expect(signal?.aborted).toBe(true);
});

it('한글 IME 조합과 Shift Enter는 메시지를 전송하지 않는다', () => {
  const enter = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 };
  expect(shouldSendOnEnter(enter)).toBe(true);
  expect(shouldSendOnEnter({ ...enter, isComposing: true })).toBe(false);
  expect(shouldSendOnEnter({ ...enter, keyCode: 229 })).toBe(false);
  expect(shouldSendOnEnter({ ...enter, shiftKey: true })).toBe(false);
  expect(shouldSendOnEnter({ ...enter, key: 'a' })).toBe(false);
});

it('인연 상태는 고정 enum만 보내며 기본값은 neutral이다', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ job_id: 'job-1' }));
  vi.stubGlobal('fetch', fetch);
  const connection = { endpoint: 'https://mac.example.test', token: 'secret' };
  await postChat(connection, 'majima', '형님', 'request-1', undefined, 'warm');
  expect(JSON.parse(fetch.mock.calls[0][1].body).relationship_tone).toBe('warm');
  await postChat(connection, 'haruka', '안녕', 'request-2');
  expect(JSON.parse(fetch.mock.calls[1][1].body).relationship_tone).toBe('neutral');
});
it('정책 오류 코드만 고정 안내로 바꾸며 서버의 원문 오류는 노출하지 않는다', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'content_blocked', message: 'PRIVATE_TRACE' } },
          { status: 400 },
        ),
      ),
  );
  await expect(aiRequest('https://mac.example.test', '/v1/chat')).rejects.toMatchObject({
    code: 'content_blocked',
    message: generationError('content_blocked'),
  });
});

it('전화 이벤트는 해당 인물의 최대 네 개 고정 ID만 요청으로 전달한다', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ job_id: 'job-1' }));
  vi.stubGlobal('fetch', fetch);
  const connection = { endpoint: 'https://mac.example.test', token: 'secret' };
  await postChat(connection, 'majima', '아까 전화', 'request-1', undefined, 'cool', [
    'majima-call-short',
  ]);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    relationship_tone: 'cool',
    phone_events: ['majima-call-short'],
  });
  await postChat(connection, 'haruka', '안녕', 'request-2');
  expect(JSON.parse(fetch.mock.calls[1][1].body).phone_events).toEqual([]);
  for (const invalid of [
    null,
    'majima-call-short',
    ['invented'],
    ['haruka-shopping-checked'],
    ['majima-call-short', 'majima-call-short'],
    Array(5).fill('majima-call-short'),
    [{ text: 'invented fact' }],
  ]) {
    await expect(
      postChat(connection, 'majima', '안녕', 'request-3', undefined, 'neutral', invalid as never),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  }
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('기록과 재개 작업의 다른 인물 이벤트 및 잘못된 완료 수는 거부한다', async () => {
  const connection = { endpoint: 'https://mac.example.test', token: 'secret' };
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const message = {
    id: 'u1',
    role: 'user',
    content: '안녕',
    time: null,
    phone_events: ['haruka-shopping-checked'],
  };
  fetch.mockImplementation(async () =>
    Response.json({ messages: [message], pending_job: null, next_cursor: null }),
  );
  await expect(getHistory(connection, 'majima')).rejects.toThrow('대화 기록');
  fetch.mockImplementation(async () =>
    Response.json({
      job_id: 'job-1',
      character: 'majima',
      status: 'queued',
      request: { id: 'r1', message: '안녕', time: null, phone_events: ['haruka-shopping-checked'] },
    }),
  );
  await expect(getJob(connection, 'job-1', 'majima')).rejects.toThrow('답장 상태');
  for (const invalid of [-1, 0.5, '30', null, Number.MAX_SAFE_INTEGER + 1]) {
    fetch.mockImplementation(async () =>
      Response.json({
        messages: [],
        pending_job: null,
        next_cursor: null,
        completed_exchanges: invalid,
      }),
    );
    await expect(getHistory(connection, 'majima')).rejects.toThrow('대화 기록');
  }
  fetch.mockImplementation(async () =>
    Response.json({
      messages: [],
      pending_job: null,
      next_cursor: 'cursor',
      completed_exchanges: 30,
    }),
  );
  expect((await getHistory(connection, 'majima')).completed_exchanges).toBe(30);
});
