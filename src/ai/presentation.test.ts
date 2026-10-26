import { afterEach, expect, it, vi } from 'vitest';
import { ReplyPresentation, typingDelay, MIN_TYPING_MS } from './presentation';
import { AI_RESET_KEY } from './connection';

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  return values;
}
it('요청마다 10~20초의 안정된 지연을 쓰고 타이핑 최소 시간을 별도로 확보한다', () => {
  storage();
  const store = new ReplyPresentation();
  store.use({ endpoint: 'https://example.test', token: 'visitor-a' });
  const values = Array.from({ length: 100 }, (_, i) => typingDelay(`request-${i}`));
  expect(values.every((delay) => delay >= 10_000 && delay <= 20_000)).toBe(true);
  expect(new Set(values).size).toBeGreaterThan(10);
  const first = store.begin('haruka', 'request-1', 1000);
  expect(store.begin('haruka', 'request-1', 99_999)).toBe(first);
  expect(first.deliverAt - first.typingAt).toBe(MIN_TYPING_MS);
});
it('새 방문자와 초기화는 이전 전달·읽음 영수증을 가져오지 않는다', () => {
  const values = storage();
  const store = new ReplyPresentation();
  const connection = { endpoint: 'https://example.test', token: 'visitor-a' };
  store.use(connection);
  store.begin('haruka', 'private-request');
  const restored = new ReplyPresentation();
  restored.use(connection);
  expect(restored.receipts).toHaveLength(1);
  restored.use({ ...connection, token: 'visitor-b' });
  expect(restored.receipts).toHaveLength(0);
  values.set(AI_RESET_KEY, 'new-reset');
  store.use(connection);
  expect(store.receipts).toHaveLength(0);
  expect([...values.values()].join()).not.toContain('visitor-a');
});

it('생성 45초는 랜덤 지연에 더하며 서버 시계 차이를 클라이언트 절대 시간에 섞지 않는다', () => {
  storage();
  const store = new ReplyPresentation();
  store.use({ endpoint: 'https://example.test', token: 'visitor-a' });
  const receipt = store.begin('majima', 'long-generation', 1_000_000);
  const serverTime = Date.parse('2030-01-01T00:00:00Z');
  store.observe('majima', [
    {
      id: 'u',
      role: 'user',
      content: '질문',
      time: new Date(serverTime).toISOString(),
      request_id: 'long-generation',
      status: 'complete',
    },
    {
      id: 'a',
      role: 'assistant',
      content: '완성 답장',
      time: new Date(serverTime + 45_000).toISOString(),
      status: 'complete',
    },
  ]);
  expect(receipt.deliverAt).toBe(1_000_000 + typingDelay('long-generation') + 45_000);
  const saved = receipt.deliverAt;
  store.observe('majima', [
    {
      id: 'u',
      role: 'user',
      content: '질문',
      time: null,
      request_id: 'long-generation',
      status: 'complete',
    },
    { id: 'a', role: 'assistant', content: '완성 답장', time: null, status: 'complete' },
  ]);
  expect(receipt.deliverAt).toBe(saved);
});
