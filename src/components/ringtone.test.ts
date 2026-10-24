import { describe, expect, it, vi } from 'vitest';
import { createRingtonePlayer } from './ringtone';

function media() {
  return {
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    currentTime: 0,
    muted: false,
    volume: 1,
    loop: false,
  };
}
const flush = () => Promise.resolve();
const ring = { ringing: true, silent: false, volume: 50 };

describe('수신 벨소리 수명주기', () => {
  it('수신 중 한 요소를 재생하며 볼륨 변경과 반복 입력으로 중복 재생하지 않는다', async () => {
    const audio = media();
    const player = createRingtonePlayer(audio);
    player.update(ring);
    player.activate();
    await flush();
    player.update({ ...ring, volume: 30 });
    player.activate();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.volume).toBe(0.3);
    expect(audio.muted).toBe(false);
    expect(audio.loop).toBe(true);
  });

  it('응답·거절·만료로 수신이 끝나면 즉시 정지하고 다음 수신은 처음부터 시작한다', async () => {
    const audio = media();
    const player = createRingtonePlayer(audio);
    player.update(ring);
    await flush();
    audio.currentTime = 9;
    player.update({ ...ring, ringing: false });
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.muted).toBe(true);
    player.activate();
    expect(audio.play).toHaveBeenCalledOnce();
    player.update(ring);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it.each([
    { silent: true, volume: 50 },
    { silent: false, volume: 0 },
  ])(
    '무음/볼륨 0은 재생을 중지하며 해제하면 아직 수신 중일 때만 재개한다: %j',
    async (settings) => {
      const audio = media();
      const player = createRingtonePlayer(audio);
      player.update(ring);
      await flush();
      player.update({ ringing: true, ...settings });
      expect(audio.pause).toHaveBeenCalledOnce();
      expect(audio.muted).toBe(true);
      player.update(ring);
      expect(audio.play).toHaveBeenCalledTimes(2);
    },
  );

  it('브라우저 자동 재생 거부는 다음 사용자 조작에서 재시도한다', async () => {
    const audio = media();
    audio.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    const player = createRingtonePlayer(audio);
    player.update(ring);
    await flush();
    player.activate();
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.muted).toBe(false);
  });

  it('사용자 조작의 무음 준비는 소리를 내지 않으며 준비 완료 후 멈춘다', async () => {
    const audio = media();
    const player = createRingtonePlayer(audio);
    player.activate();
    expect(audio.muted).toBe(true);
    await flush();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    player.activate();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('무음 준비 직후 수신되면 진행 중인 play를 재사용한다', async () => {
    const audio = media();
    const player = createRingtonePlayer(audio);
    player.activate();
    player.update(ring);
    await flush();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.muted).toBe(false);
  });

  it('늦게 완료된 재생 약속이 종료·초기화 후 다시 소리를 내지 않는다', async () => {
    let resolve: () => void = () => {};
    const audio = media();
    audio.play.mockReturnValue(new Promise<void>((done) => (resolve = done)));
    const player = createRingtonePlayer(audio);
    player.update(ring);
    player.dispose();
    resolve();
    await flush();
    player.activate();
    expect(audio.muted).toBe(true);
    expect(audio.pause).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('탭이 숨겨지면 멈추고 다시 보일 때 유효한 수신만 재개한다', async () => {
    const audio = media();
    const player = createRingtonePlayer(audio);
    player.update(ring);
    await flush();
    player.setVisible(false);
    expect(audio.muted).toBe(true);
    player.setVisible(true);
    expect(audio.play).toHaveBeenCalledTimes(2);
    player.setVisible(false);
    player.update({ ...ring, ringing: false });
    player.setVisible(true);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});
