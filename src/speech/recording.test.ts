import { afterEach, expect, it, vi } from 'vitest';
import { CallRecording } from './recording';

const connection = { endpoint: 'https://test.invalid', token: 'test-token' };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup({ empty = false, deferredStop = false } = {}) {
  const stopped = vi.fn();
  const stream = { getTracks: () => [{ stop: stopped }] };
  const media = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
  const instances: Recorder[] = [];
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      instances.push(this);
    }
    start() {
      this.state = 'recording';
    }
    finish() {
      this.ondataavailable?.({ data: new Blob(empty ? [] : ['synthetic-audio']) });
      this.onstop?.();
    }
    stop() {
      this.state = 'inactive';
      if (!deferredStop) this.finish();
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  return { stopped, media, stream, fetch, recorder: () => instances.at(-1)! };
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
  expect(env.fetch.mock.calls[0][0]).toMatch(/\/v1\/recordings\/majima\/[0-9a-f-]{36}$/);
  expect(env.fetch.mock.calls[0][1].body).toBeInstanceOf(Blob);
  expect(env.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
});
it('does not capture or upload if permission arrives after hangup', async () => {
  const env = setup();
  let grant!: (value: unknown) => void;
  env.media.mockReturnValue(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const active = vi.fn();
  const capture = new CallRecording(active);
  const start = capture.start(connection, 'haruka');
  capture.stop();
  grant(env.stream);
  expect(await start).toBe(false);
  expect(env.stopped).toHaveBeenCalledTimes(1);
  expect(active).not.toHaveBeenCalledWith(true);
  expect(env.fetch).not.toHaveBeenCalled();
});
it('reports rejected upload without retrying or claiming saved', async () => {
  const env = setup();
  env.fetch.mockResolvedValue({ ok: false });
  const capture = new CallRecording();
  await capture.start(connection, 'haruka');
  capture.stop();
  await expect(capture.saved).rejects.toThrow('음성 저장 실패');
  expect(env.fetch).toHaveBeenCalledTimes(1);
});
it('stops automatically after thirty seconds', async () => {
  vi.useFakeTimers();
  const env = setup();
  const active = vi.fn();
  const capture = new CallRecording(active);
  await capture.start(connection, 'haruka');
  await vi.advanceTimersByTimeAsync(30_000);
  await capture.saved;
  expect(env.stopped).toHaveBeenCalledTimes(1);
  expect(active.mock.calls).toEqual([[true], [false]]);
});
it('turns active off and releases the track before the final stop event', async () => {
  const env = setup({ deferredStop: true });
  const active = vi.fn();
  const capture = new CallRecording(active);
  await capture.start(connection, 'majima');
  expect(active.mock.calls).toEqual([[true]]);
  capture.stop();
  expect(active.mock.calls).toEqual([[true], [false]]);
  expect(env.stopped).toHaveBeenCalledTimes(1);
  expect(env.fetch).not.toHaveBeenCalled();
  env.recorder().finish();
  await capture.saved;
  expect(active.mock.calls).toEqual([[true], [false]]);
});
it('does not upload empty audio', async () => {
  const env = setup({ empty: true });
  const capture = new CallRecording();
  await capture.start(connection, 'haruka');
  capture.stop();
  await capture.saved;
  expect(env.fetch).not.toHaveBeenCalled();
});
it('on recorder error releases the microphone and never uploads partial audio', async () => {
  const env = setup();
  const active = vi.fn();
  const capture = new CallRecording(active);
  await capture.start(connection, 'haruka');
  env.recorder().onerror?.();
  await expect(capture.saved).rejects.toThrow('음성 수집 실패');
  expect(active.mock.calls).toEqual([[true], [false]]);
  expect(env.stopped).toHaveBeenCalledTimes(1);
  expect(env.fetch).not.toHaveBeenCalled();
});
it('rejects over-limit audio and releases capture without uploading it', async () => {
  const env = setup();
  const active = vi.fn();
  const capture = new CallRecording(active);
  await capture.start(connection, 'haruka');
  env.recorder().ondataavailable?.({ data: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]) });
  await expect(capture.saved).rejects.toThrow('음성 용량 초과');
  expect(active.mock.calls).toEqual([[true], [false]]);
  expect(env.stopped).toHaveBeenCalledTimes(1);
  expect(env.fetch).not.toHaveBeenCalled();
});
it('does not request microphone again after cancellation or start', async () => {
  const env = setup();
  const capture = new CallRecording();
  await capture.start(connection, 'majima');
  expect(await capture.start(connection, 'haruka')).toBe(false);
  capture.stop();
  await capture.saved;
  expect(await capture.start(connection, 'haruka')).toBe(false);
  expect(env.media).toHaveBeenCalledTimes(1);
});
