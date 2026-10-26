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
