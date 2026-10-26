import { expect, it, vi } from 'vitest';
import { ReplySoundPlayer } from './replySound';

function audio() {
  const starts: number[] = [];
  const peaks: number[] = [];
  const nodes: {
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onended?: (() => void) | null;
  }[] = [];
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(async () => {}),
    onstatechange: null as (() => void) | null,
    createBufferSource: vi.fn(() => {
      const oscillator = {
        buffer: null,
        connect: vi.fn((gain) => gain),
        start: vi.fn(() => starts.push(context.currentTime)),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: undefined as (() => void) | undefined,
      };
      nodes.push(oscillator);
      return oscillator;
    }),
    createGain: () => ({
      gain: {
        set value(value: number) {
          peaks.push(value);
        },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  };
  const player = new ReplySoundPlayer(
    () => context as unknown as AudioContext,
    async () => ({ duration: 4.4 }) as AudioBuffer,
  );
  return { player, context, starts, peaks, nodes };
}

it('음량이 있는 새 도착만 사용자 활성화 이후 재생하고 같은 답장 재조회는 소리를 반복하지 않는다', async () => {
  const { player, starts, peaks } = audio();
  expect(player.play('before-gesture', false, 100, true)).toBe(false);
  player.unlock();
  await player.ready(new AbortController().signal);
  expect(player.play('reply', false, 100, true)).toBe(true);
  const count = starts.length;
  expect(new Set(starts).size).toBe(1);
  expect(starts.every((t) => t >= 10 && t < 11)).toBe(true);
  expect(peaks.every((peak) => peak > 0 && peak <= 1)).toBe(true);
  expect(player.play('reply', false, 100, true)).toBe(false);
  expect(player.play('before-gesture', false, 100, true)).toBe(false);
  expect(starts).toHaveLength(count);
});

it('무음·0음량·숨겨진 동안 온 답장을 나중에 켰다고 지연 재생하지 않는다', async () => {
  const { player, starts } = audio();
  player.unlock();
  await player.ready(new AbortController().signal);
  expect(player.play('silent', true, 100, true)).toBe(false);
  expect(player.play('zero', false, 0, true)).toBe(false);
  expect(player.play('hidden', false, 100, false)).toBe(false);
  for (const id of ['silent', 'zero', 'hidden'])
    expect(player.play(id, false, 100, true)).toBe(false);
  expect(starts).toHaveLength(0);
});

it('중단된 Safari 오디오는 다음 사용자 동작에서 재개하고 종료 노드를 해제한다', async () => {
  const { player, context, nodes } = audio();
  context.state = 'interrupted';
  player.unlock();
  await player.ready(new AbortController().signal);
  expect(context.resume).toHaveBeenCalledOnce();
  player.play('new', false, 50, true);
  for (const node of nodes) {
    node.onended?.();
    expect(node.disconnect).toHaveBeenCalledOnce();
  }
  player.dispose();
  expect(context.close).toHaveBeenCalledOnce();
});

it('새 도착은 기존 사용자 활성화 context의 지연 재개만 기다리고 새 context를 자동 생성하지 않는다', async () => {
  const { player, context, starts } = audio();
  const signal = new AbortController().signal;
  expect(await player.ready(signal)).toBe(false);
  expect(context.resume).not.toHaveBeenCalled();
  player.unlock();
  await player.ready(new AbortController().signal);
  context.state = 'interrupted';
  let resumed!: () => void;
  context.resume.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resumed = resolve;
      }),
  );
  const ready = player.ready(signal);
  expect(starts).toHaveLength(0);
  context.state = 'running';
  resumed();
  expect(await ready).toBe(true);
  expect(player.play('new-arrival', false, 50, true)).toBe(true);
});

it.each(['abort', 'deadline', 'dispose'])(
  '재개 %s 뒤 늦은 완료는 과거 수신음을 재생하지 않는다',
  async (cancel) => {
    vi.useFakeTimers();
    try {
      const { player, context, starts } = audio();
      player.unlock();
      await player.ready(new AbortController().signal);
      context.state = 'suspended';
      let resumed!: () => void;
      context.resume.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resumed = resolve;
          }),
      );
      const controller = new AbortController();
      const ready = player.ready(controller.signal);
      if (cancel === 'abort') controller.abort();
      else if (cancel === 'dispose') {
        player.dispose();
        context.state = 'running';
        resumed();
      } else await vi.advanceTimersByTimeAsync(1001);
      expect(await ready).toBe(false);
      context.state = 'running';
      resumed();
      await Promise.resolve();
      expect(starts).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(['statechange', 'unlock', 'expiry', 'hidden'])(
  '중단된 예약음은 %s 경로에서 폐기하고 다음 앱 터치에 다시 재생하지 않는다',
  async (path) => {
    vi.useFakeTimers();
    try {
      const { player, context, starts, nodes } = audio();
      player.unlock();
      await player.ready(new AbortController().signal);
      expect(player.play('arrived', false, 100, true)).toBe(true);
      context.state = 'suspended';
      if (path === 'statechange') context.onstatechange?.();
      else if (path === 'unlock') player.unlock();
      else if (path === 'hidden') player.interrupt();
      else await vi.advanceTimersByTimeAsync(4501);
      expect(nodes[0].stop).toHaveBeenCalledOnce();
      player.unlock();
      expect(starts).toHaveLength(1);
      expect(player.play('arrived', false, 100, true)).toBe(false);
      player.dispose();
    } finally {
      vi.useRealTimers();
    }
  },
);

it('음원 로드 실패는 다음 동작에서 재시도하지만 실패 동안 지난 답장은 울리지 않는다', async () => {
  const { context, starts } = audio();
  const load = vi
    .fn<() => Promise<AudioBuffer>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ duration: 4.4 } as AudioBuffer);
  const player = new ReplySoundPlayer(() => context as unknown as AudioContext, load);
  player.unlock();
  expect(await player.ready(new AbortController().signal)).toBe(false);
  expect(player.play('old', false, 100, true)).toBe(false);
  player.unlock();
  expect(await player.ready(new AbortController().signal)).toBe(true);
  expect(player.play('old', false, 100, true)).toBe(false);
  expect(starts).toHaveLength(0);
  expect(player.play('fresh', false, 100, true)).toBe(true);
  expect(starts).toHaveLength(1);
  expect(load).toHaveBeenCalledTimes(2);
  player.dispose();
});
