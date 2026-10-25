import { afterEach, expect, it, vi } from 'vitest';
import { aiRequest, createSession, getHistory, getJob, shouldSendOnEnter } from './client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('초대 키는 session 본문에, 접속 토큰은 Authorization 헤더에만 둔다', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ token: 'session-secret' }))
    .mockResolvedValueOnce(Response.json({ messages: [], pending_job: null }));
  vi.stubGlobal('fetch', fetch);
  const connection = await createSession('https://new.example.test', 'invite-secret');
  await getHistory(connection, 'haruka');
  expect(fetch.mock.calls[0][0]).toBe('https://new.example.test/v1/sessions');
  expect(fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ invite_key: 'invite-secret' });
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
  const rejection = expect(request).rejects.toThrow('Mac에 연결할 수 없습니다');
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
