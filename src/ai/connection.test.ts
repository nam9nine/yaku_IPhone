import { afterEach, expect, it, vi } from 'vitest';
import {
  AI_CONNECTION_KEY,
  clearAiInvite,
  consumeAiInvite,
  normalizeEndpoint,
  readAiConnection,
  saveAiConnection,
} from './connection';

afterEach(() => {
  clearAiInvite();
  vi.unstubAllGlobals();
});

it('공개 연결은 HTTPS를 요구하고 계정·쿼리·fragment 주소를 거부한다', () => {
  expect(normalizeEndpoint(' https://example.test/mac/ ', false)).toBe('https://example.test/mac');
  for (const url of [
    'http://example.test',
    'http://localhost:8765',
    'https://user:secret@example.test',
    'https://example.test/?token=secret',
    'https://example.test/#secret',
    'https://example.test/?',
    'https://example.test/#',
    'javascript:alert(1)',
    '/relative',
  ])
    expect(() => normalizeEndpoint(url, false)).toThrow();
});

it('개발 중에도 HTTP는 루프백 주소만 허용한다', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]'])
    expect(normalizeEndpoint(`http://${host}:8765`, true)).toBe(`http://${host}:8765`);
  expect(() => normalizeEndpoint('http://192.168.1.2:8765', true)).toThrow();
  expect(() => normalizeEndpoint('http://localhost.evil.test', true)).toThrow();
});

it('전용 저장 키와 origin이 일치하는 접속 토큰만 복구한다', () => {
  const value = {
    endpoint: 'https://mac.example.test',
    origin: 'https://mac.example.test',
    token: 'session-secret',
  };
  const getItem = vi.fn(() => JSON.stringify(value));
  vi.stubGlobal('localStorage', { getItem });
  expect(readAiConnection()).toEqual({ endpoint: value.endpoint, token: value.token });
  expect(getItem).toHaveBeenCalledWith(AI_CONNECTION_KEY);
  value.endpoint = 'https://different.example.test';
  expect(readAiConnection()).toBeNull();
});

it('저장소 거부와 손상된 설정은 안전하게 처리한다', () => {
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
  expect(saveAiConnection({ endpoint: 'https://mac.example.test', token: 'secret' })).toBe(false);
  expect(saveAiConnection(null)).toBe(false);
});

it('초대 fragment만 즉시 지우고 연결 전에는 네트워크 요청을 하지 않는다', () => {
  const location = new URL(
    'https://pages.example.test/yaku_IPhone/?view=phone#keep=yes&aiEndpoint=https%3A%2F%2Fmac.example.test&aiInvite=invite-secret',
  );
  const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
    location.href = new URL(next, location).href;
  });
  const fetch = vi.fn();
  vi.stubGlobal('window', { location, history: { state: { page: 1 }, replaceState } });
  vi.stubGlobal('fetch', fetch);
  expect(consumeAiInvite()).toEqual({
    endpoint: 'https://mac.example.test',
    inviteKey: 'invite-secret',
  });
  expect(location.href).toBe('https://pages.example.test/yaku_IPhone/?view=phone#keep=yes');
  expect(replaceState).toHaveBeenCalledWith({ page: 1 }, '', '/yaku_IPhone/?view=phone#keep=yes');
  expect(consumeAiInvite()?.inviteKey).toBe('invite-secret');
  expect(fetch).not.toHaveBeenCalled();
  clearAiInvite();
  expect(consumeAiInvite()).toBeNull();
});
