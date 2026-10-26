import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker() {
  const values = new Map<string, unknown>([['binding', { id: 'subscription-a' }]]);
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn();
  const openWindow = vi.fn();
  const registration = {
    scope: 'https://example.test/yaku_IPhone/',
    showNotification,
    getNotifications: vi.fn(async (): Promise<{ close: () => void }[]> => []),
  };
  const self = {
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      listeners.set(name, callback),
    registration,
    clients: { matchAll: async () => [], openWindow, claim: vi.fn() },
    skipWaiting: vi.fn(),
  };
  const indexedDB = {
    open: () => {
      const opening: Record<string, unknown> = {};
      queueMicrotask(() => {
        opening.result = {
          close() {},
          transaction: () => {
            const tx: Record<string, unknown> = {};
            tx.objectStore = () => ({
              get(key: string) {
                const r = { result: values.get(key) };
                queueMicrotask(() => (tx.oncomplete as () => void)());
                return r;
              },
              put(value: unknown, key: string) {
                values.set(key, value);
                const r = { result: key };
                queueMicrotask(() => (tx.oncomplete as () => void)());
                return r;
              },
            });
            return tx;
          },
        };
        (opening.onsuccess as () => void)();
      });
      return opening;
    },
  };
  runInNewContext(readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8'), {
    self,
    indexedDB,
    URL,
    setTimeout,
    clearTimeout,
    MessageChannel,
  });
  async function push(changes: Record<string, unknown> = {}) {
    let task: Promise<void> | undefined;
    listeners.get('push')!({
      data: {
        json: () => ({
          type: 'chat.reply',
          subscription_id: 'subscription-a',
          notification_id: 'job-1',
          job_id: 'job-1',
          character: 'haruka',
          title: '하루카',
          body: '새 답장',
          ...changes,
        }),
      },
      waitUntil(p: Promise<void>) {
        task = p;
      },
    });
    await task;
  }
  return { values, showNotification, openWindow, listeners, push, registration };
}
it('현재 구독의 완성 답장만 한 번 표시하고 초기화 이후 늦은 push는 버린다', async () => {
  const w = worker();
  await w.push({ subscription_id: 'old-subscription' });
  expect(w.showNotification).not.toHaveBeenCalled();
  await w.push();
  await w.push();
  expect(w.showNotification).toHaveBeenCalledTimes(1);
  w.values.delete('binding');
  await w.push({ notification_id: 'job-2' });
  expect(w.showNotification).toHaveBeenCalledTimes(1);
});
it('알림 링크는 서버가 준 임의 URL을 열지 않고 같은 사이트의 허용 연락처로만 간다', async () => {
  const w = worker();
  let task: Promise<void> | undefined;
  w.listeners.get('notificationclick')!({
    notification: {
      data: {
        character: 'majima',
        subscription_id: 'subscription-a',
        url: 'https://attacker.test/',
      },
      close() {},
    },
    waitUntil(p: Promise<void>) {
      task = p;
    },
  });
  await task;
  expect(w.openWindow).toHaveBeenCalledWith(
    'https://example.test/yaku_IPhone/?conversation=majima',
  );
  w.values.delete('binding');
  w.listeners.get('notificationclick')!({
    notification: { data: { character: 'majima', subscription_id: 'subscription-a' }, close() {} },
    waitUntil(p: Promise<void>) {
      task = p;
    },
  });
  await task;
  expect(w.openWindow).toHaveBeenCalledTimes(1);
});

it('동시에 도착한 push도 seen 기록을 잃지 않고 재전달을 중복 표시하지 않는다', async () => {
  const w = worker();
  await Promise.all([w.push({ notification_id: 'a' }), w.push({ notification_id: 'b' })]);
  await Promise.all([w.push({ notification_id: 'a' }), w.push({ notification_id: 'b' })]);
  expect(w.showNotification).toHaveBeenCalledTimes(2);
  expect(w.values.get('seen')).toEqual(['a', 'b']);
});

it('OS 알림 표시 도중 초기화된 구독은 방금 표시된 알림도 닫는다', async () => {
  const w = worker();
  const close = vi.fn();
  w.registration.getNotifications = vi.fn(async () => [{ close }]);
  w.showNotification.mockImplementation(async () => {
    w.values.delete('binding');
  });
  await w.push();
  expect(close).toHaveBeenCalledOnce();
  expect(w.values.get('seen')).toBeUndefined();
});
