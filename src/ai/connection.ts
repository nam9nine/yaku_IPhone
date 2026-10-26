import { AI_ENDPOINT } from './config';

export const AI_CONNECTION_KEY = 'yaku-iphone.ai.session.v2';
export const LEGACY_AI_CONNECTION_KEY = 'yaku-iphone.ai.connection.v1';
export const AI_RESET_KEY = 'yaku-iphone.ai.reset.v1';
export const AI_RESET_EVENT = 'yaku-iphone-ai-reset';
const SERVICE = 'kiryu-character-chat-v2';

export function readAiResetId(): string | null {
  try {
    return localStorage.getItem(AI_RESET_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Change the browser's scope without deleting any server-side conversation. */
export function resetAiConnection(): boolean {
  try {
    // One durable write invalidates both current and legacy tokens. If it fails,
    // leave the phone untouched rather than resurrect old memory after reload.
    localStorage.setItem(AI_RESET_KEY, crypto.randomUUID());
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(AI_RESET_EVENT));
  return true;
}

export interface AiConnection {
  endpoint: string;
  token: string;
}

export function configuredEndpoint(): string {
  if (!AI_ENDPOINT) return '';
  const url = new URL(AI_ENDPOINT);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid deployment API origin');
  return url.origin;
}

export function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/\s/.test(value);
}

export function readAiConnection(): AiConnection | null {
  const endpoint = configuredEndpoint();
  if (!endpoint) return null;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(AI_CONNECTION_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const record = saved as Record<string, unknown>;
      if (
        record.service === SERVICE &&
        (record.resetId ?? null) === readAiResetId() &&
        validToken(record.token)
      )
        return { endpoint, token: record.token };
    }
    if (readAiResetId() !== null) return null;
    // The same Mac's legacy records were imported. Reuse only the token and let
    // this deployment validate it; never send anything to the saved old endpoint.
    const legacy: unknown = JSON.parse(localStorage.getItem(LEGACY_AI_CONNECTION_KEY) ?? 'null');
    if (legacy && typeof legacy === 'object') {
      const record = legacy as Record<string, unknown>;
      if (validToken(record.token)) return { endpoint, token: record.token };
    }
  } catch {
    return null;
  }
  return null;
}

export function saveAiConnection(
  connection: AiConnection | null,
  resetId = readAiResetId(),
): boolean {
  try {
    if (resetId !== readAiResetId()) return false;
    if (connection) {
      localStorage.setItem(
        AI_CONNECTION_KEY,
        JSON.stringify({ service: SERVICE, token: connection.token, resetId }),
      );
    } else {
      localStorage.removeItem(AI_CONNECTION_KEY);
    }
    localStorage.removeItem(LEGACY_AI_CONNECTION_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Retire old invite URLs without reading, retaining, or following their values. */
export function clearLegacyAiFragment(): void {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (!fragment.has('aiEndpoint') && !fragment.has('aiInvite')) return;
  fragment.delete('aiEndpoint');
  fragment.delete('aiInvite');
  const remaining = fragment.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`,
  );
}
