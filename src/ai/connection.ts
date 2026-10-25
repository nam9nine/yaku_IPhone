export const AI_CONNECTION_KEY = 'yaku-iphone.ai.connection.v1';

export interface AiConnection {
  endpoint: string;
  token: string;
}

export interface AiInvite {
  endpoint: string;
  inviteKey: string;
}

export function normalizeEndpoint(value: string, development = import.meta.env.DEV): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Mac 서버의 HTTPS 주소를 입력해 주세요.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:')) {
    throw new Error('HTTPS 주소가 필요합니다.');
  }
  if (url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    throw new Error('주소에 계정 정보, 쿼리 또는 #을 포함할 수 없습니다.');
  }
  return url.href.replace(/\/+$/, '');
}

export function readAiConnection(): AiConnection | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(AI_CONNECTION_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const stored = value as Record<string, unknown>;
    if (typeof stored.endpoint !== 'string' || typeof stored.token !== 'string') return null;
    const endpoint = normalizeEndpoint(stored.endpoint);
    if (stored.origin !== new URL(endpoint).origin || !validToken(stored.token)) return null;
    return { endpoint, token: stored.token };
  } catch {
    return null;
  }
}

export function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/\s/.test(value);
}

export function saveAiConnection(connection: AiConnection | null): boolean {
  try {
    if (connection) {
      localStorage.setItem(
        AI_CONNECTION_KEY,
        JSON.stringify({ ...connection, origin: new URL(connection.endpoint).origin }),
      );
    } else {
      localStorage.removeItem(AI_CONNECTION_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

let pendingInvite: AiInvite | null = null;

/** Read at app startup, before visiting Messages. Never makes a network request. */
export function consumeAiInvite(): AiInvite | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (fragment.has('aiEndpoint') || fragment.has('aiInvite')) {
    pendingInvite = {
      endpoint: fragment.get('aiEndpoint') ?? '',
      inviteKey: fragment.get('aiInvite') ?? '',
    };
    fragment.delete('aiEndpoint');
    fragment.delete('aiInvite');
    const remaining = fragment.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`,
    );
  }
  return pendingInvite;
}

export function clearAiInvite(): void {
  pendingInvite = null;
}
