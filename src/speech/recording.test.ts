import { afterEach, expect, it, vi } from 'vitest';
import { CallRecording } from './recording';

const connection = { endpoint: 'https://test.invalid', token: 'test-token' };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  const stopped = vi.fn();
  const stream = { getTracks: () => [{ stop: stopped }] };
  const media = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['synthetic-audio']) });
      this.onstop?.();
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  return { stopped, media, stream, fetch };
}
it('stores one audio file after stopping and releases microphone', async () => {
  const env = setup();
  const capture = new CallRecording();
  expect(await capture.start(connection, 'majima')).toBe(true);
  expect(env.fetch).not.toHaveBeenCalled();
  capture.stop();
  capture.stop();
  await capture.saved;
  expect(env.stopped).toHaveBeenCalledTimes(1);
  expect(env.fetch).toHaveBeenCalledTimes(1);
  expect(env.fetch.mock.calls[0][0]).toMatch(/\/v1\/recordings\/majima\//);
  expect(env.fetch.mock.calls[0][1].body).toBeInstanceOf(Blob);
});
it('does not record if permission arrives after hangup', async () => {
  const env = setup();
  let grant!: (value: unknown) => void;
  env.media.mockReturnValue(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const capture = new CallRecording();
  const start = capture.start(connection, 'haruka');
  capture.stop();
  grant(env.stream);
  expect(await start).toBe(false);
  expect(env.stopped).toHaveBeenCalledTimes(1);
  expect(env.fetch).not.toHaveBeenCalled();
});
it('reports rejected upload instead of claiming saved', async () => {
  const env = setup();
  env.fetch.mockResolvedValue({ ok: false });
  const capture = new CallRecording();
  await capture.start(connection, 'haruka');
  capture.stop();
  await expect(capture.saved).rejects.toThrow('녹음 저장 실패');
});
it('stops automatically after thirty seconds', async () => {
  vi.useFakeTimers();
  const env = setup();
  const capture = new CallRecording();
  await capture.start(connection, 'haruka');
  await vi.advanceTimersByTimeAsync(30_000);
  await capture.saved;
  expect(env.stopped).toHaveBeenCalledTimes(1);
});
