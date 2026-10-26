import { afterEach, expect, it, vi } from 'vitest';
import { waitForPushWorker } from './pushReadiness';

afterEach(() => vi.useRealTimers());
const registration = {} as ServiceWorkerRegistration;
const forever = () => new Promise<ServiceWorkerRegistration>(() => {});

it('등록 실패는 pending ready를 기다리지 않고 안내 오류로 종료한다', async () => {
  vi.useFakeTimers();
  await expect(
    waitForPushWorker(
      { register: vi.fn().mockRejectedValue(new Error('MIME error')), ready: forever() },
      '/yaku_IPhone/',
    ),
  ).rejects.toThrow('알림을 준비하지 못했습니다');
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['registration', 'activation'])(
  '%s 지연은 10초 뒤 끝나며 늦은 성공으로 구독을 이어가지 않는다',
  async (phase) => {
    vi.useFakeTimers();
    let finish!: (value: ServiceWorkerRegistration) => void;
    const delayed = new Promise<ServiceWorkerRegistration>((resolve) => {
      finish = resolve;
    });
    const result = waitForPushWorker(
      {
        register: vi
          .fn()
          .mockReturnValue(phase === 'registration' ? delayed : Promise.resolve(registration)),
        ready: phase === 'activation' ? delayed : Promise.resolve(registration),
      },
      '/yaku_IPhone/',
    );
    const rejected = expect(result).rejects.toThrow('알림 준비가 지연되고 있습니다');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    finish(registration);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('성공하면 저장소 scope로 등록하고 제한시간 타이머를 제거한다', async () => {
  vi.useFakeTimers();
  const register = vi.fn().mockResolvedValue(registration);
  expect(
    await waitForPushWorker({ register, ready: Promise.resolve(registration) }, '/yaku_IPhone/'),
  ).toBe(registration);
  expect(register).toHaveBeenCalledWith('/yaku_IPhone/push-sw.js', { scope: '/yaku_IPhone/' });
  expect(vi.getTimerCount()).toBe(0);
});
