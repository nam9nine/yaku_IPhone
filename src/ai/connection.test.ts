import { afterEach, expect, it, vi } from 'vitest';
import { AI_ENDPOINT } from './config';
import {
  AI_CONNECTION_KEY,
  LEGACY_AI_CONNECTION_KEY,
  clearLegacyAiFragment,
  readAiConnection,
  saveAiConnection,
} from './connection';

afterEach(() => vi.unstubAllGlobals());
it('새 세션은 토큰만 저장하고 항상 고정 API로 연결한다', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  expect(saveAiConnection({ endpoint: 'https://ignored.example', token: 'session-secret' })).toBe(
    true,
  );
  expect(readAiConnection()).toEqual({ endpoint: AI_ENDPOINT, token: 'session-secret' });
  expect(values.get(AI_CONNECTION_KEY)).not.toContain('endpoint');
});
it('이전 토큰만 재사용하고 이전 임의 endpoint는 절대 사용하지 않는다', () => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) =>
      key === LEGACY_AI_CONNECTION_KEY
        ? JSON.stringify({ endpoint: 'https://untrusted.example', token: 'legacy-token' })
        : null,
  });
  expect(readAiConnection()).toEqual({ endpoint: AI_ENDPOINT, token: 'legacy-token' });
});
it('저장 거부와 손상된 설정에도 실행을 중단하지 않는다', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => '{bad-json',
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  });
  expect(readAiConnection()).toBeNull();
  expect(saveAiConnection({ endpoint: AI_ENDPOINT, token: 'secret' })).toBe(false);
  expect(saveAiConnection(null)).toBe(false);
});
it('이전 초대 fragment는 값 보관이나 네트워크 요청 없이 지운다', () => {
  const location = new URL(
    'https://pages.example/yaku_IPhone/#keep=yes&aiEndpoint=https://evil.example&aiInvite=secret',
  );
  const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
    location.href = new URL(next, location).href;
  });
  const fetch = vi.fn();
  vi.stubGlobal('window', { location, history: { state: { page: 1 }, replaceState } });
  vi.stubGlobal('fetch', fetch);
  clearLegacyAiFragment();
  expect(location.hash).toBe('#keep=yes');
  expect(fetch).not.toHaveBeenCalled();
});

it('초기화 경계는 이전 토큰과 레거시 토큰을 무효화하고 새 토큰만 복원한다', async () => {
  const { AI_RESET_KEY, readAiResetId, resetAiConnection } = await import('./connection');
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('window', new EventTarget());
  saveAiConnection({ endpoint: AI_ENDPOINT, token: 'old-token' });
  values.set(LEGACY_AI_CONNECTION_KEY, JSON.stringify({ token: 'legacy-token' }));
  expect(resetAiConnection()).toBe(true);
  expect(values.get(AI_RESET_KEY)).toBeTruthy();
  expect(readAiConnection()).toBeNull();
  // A response from before the reset cannot overwrite the new scope.
  expect(saveAiConnection({ endpoint: AI_ENDPOINT, token: 'old-token' }, null)).toBe(false);
  expect(readAiConnection()).toBeNull();
  saveAiConnection({ endpoint: AI_ENDPOINT, token: 'fresh-token' }, readAiResetId());
  expect(readAiConnection()?.token).toBe('fresh-token');
});

it('초기화 경계를 저장하지 못하면 기존 연결을 유지하고 실패를 알린다', async () => {
  const { resetAiConnection } = await import('./connection');
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) =>
      key === AI_CONNECTION_KEY
        ? JSON.stringify({ service: 'kiryu-character-chat-v2', token: 'old-token' })
        : null,
    setItem: () => {
      throw new Error('quota');
    },
  });
  expect(resetAiConnection()).toBe(false);
  expect(dispatchEvent).not.toHaveBeenCalled();
  expect(readAiConnection()?.token).toBe('old-token');
});
