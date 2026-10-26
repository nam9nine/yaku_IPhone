import { expect, it, vi } from 'vitest';
import { ReplySoundPlayer } from './replySound';

function audio() {
  const starts: number[] = [];
  const peaks: number[] = [];
  const nodes: { disconnect: ReturnType<typeof vi.fn>; onended?: () => void }[] = [];
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(async () => {}),
    createOscillator: vi.fn(() => {
      const oscillator = {
        frequency: { value: 0 },
        type: '',
        connect: vi.fn((gain) => gain),
        start: vi.fn((time: number) => starts.push(time)),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: undefined as (() => void) | undefined,
      };
      nodes.push(oscillator);
      return oscillator;
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: (value: number) => peaks.push(value),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  };
  const player = new ReplySoundPlayer(() => context as unknown as AudioContext);
  return { player, context, starts, peaks, nodes };
}

it('음량이 있는 새 도착만 사용자 활성화 이후 재생하고 같은 답장 재조회는 소리를 반복하지 않는다', () => {
  const { player, starts, peaks } = audio();
  expect(player.play('before-gesture', false, 100, true)).toBe(false);
  player.unlock();
  expect(player.play('reply', false, 100, true)).toBe(true);
  const count = starts.length;
  expect(new Set(starts).size).toBe(3);
  expect(starts.every((t) => t >= 10 && t < 11)).toBe(true);
  expect(peaks.every((peak) => peak > 0 && peak <= 0.13)).toBe(true);
  expect(player.play('reply', false, 100, true)).toBe(false);
  expect(player.play('before-gesture', false, 100, true)).toBe(false);
  expect(starts).toHaveLength(count);
});

it('무음·0음량·숨겨진 동안 온 답장을 나중에 켰다고 지연 재생하지 않는다', () => {
  const { player, starts } = audio();
  player.unlock();
  expect(player.play('silent', true, 100, true)).toBe(false);
  expect(player.play('zero', false, 0, true)).toBe(false);
  expect(player.play('hidden', false, 100, false)).toBe(false);
  for (const id of ['silent', 'zero', 'hidden'])
    expect(player.play(id, false, 100, true)).toBe(false);
  expect(starts).toHaveLength(0);
});

it('중단된 Safari 오디오는 다음 사용자 동작에서 재개하고 종료 노드를 해제한다', () => {
  const { player, context, nodes } = audio();
  context.state = 'interrupted';
  player.unlock();
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
