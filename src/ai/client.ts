import { validToken, type AiConnection } from './connection';
import phoneCatalog from '../day/phone-events.json' with { type: 'json' };

export const aiCharacters = ['haruka', 'majima'] as const;
export type AiCharacter = (typeof aiCharacters)[number];
export type PhoneEventId = keyof typeof phoneCatalog.events;
export function isPhoneEvents(character: AiCharacter, value: unknown): value is PhoneEventId[] {
  return (
    Array.isArray(value) &&
    value.length <= 4 &&
    value.every(
      (id) =>
        typeof id === 'string' &&
        Object.hasOwn(phoneCatalog.events, id) &&
        phoneCatalog.events[id as PhoneEventId].character === character,
    ) &&
    new Set(value).size === value.length
  );
}
export type RelationshipTone = 'warm' | 'neutral' | 'cool';
export interface CallFollowupTrigger {
  call_id: string;
  reason: 'missed' | 'declined' | 'idle';
  direction: 'incoming' | 'outgoing';
}
export function isCallFollowupTrigger(value: unknown): value is CallFollowupTrigger {
  return (
    record(value) &&
    typeof value.call_id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value.call_id) &&
    ['missed', 'declined', 'idle'].includes(String(value.reason)) &&
    ['incoming', 'outgoing'].includes(String(value.direction)) &&
    (value.reason === 'idle' || value.direction === 'incoming')
  );
}
export const isRelationshipTone = (value: unknown): value is RelationshipTone =>
  value === 'warm' || value === 'neutral' || value === 'cool';
export const AI_MAX_MESSAGE_LENGTH = 1000;
export const AI_MAX_MESSAGE_BYTES = 4096;
export function messageWithinLimits(message: string): boolean {
  return (
    message.length <= AI_MAX_MESSAGE_LENGTH &&
    new TextEncoder().encode(message).length <= AI_MAX_MESSAGE_BYTES
  );
}
export function isAiCharacter(value: string | undefined): value is AiCharacter {
  return value === 'haruka' || value === 'majima';
}

export const isCallEvents = (events: readonly string[] | undefined): boolean =>
  !!events?.some((id) => id === 'majima-call-live' || id === 'haruka-call-live');

export interface AiMessage {
  request_kind?: 'chat' | 'call_followup';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string | null;
  status?: 'queued' | 'generating' | 'complete' | 'error' | 'interrupted';
  request_id?: string | null;
  job_id?: string | null;
  relationship_tone?: RelationshipTone;
  phone_events?: PhoneEventId[];
  /** Client presentation time, derived locally; server history remains unchanged. */
  displayedAt?: number;
}
export interface AiHistory {
  messages: AiMessage[];
  pending_job: string | null;
  next_cursor: string | null;
  /** Absent only for older servers or fixtures; independent of history pagination. */
  completed_exchanges?: number;
}
export interface AiJob {
  request_kind?: 'chat' | 'call_followup';
  job_id: string;
  character: AiCharacter;
  status: 'queued' | 'generating' | 'complete' | 'error';
  reply?: string;
  error?: { code: string; message: string };
  messages?: AiMessage[];
  request?: {
    id: string;
    message?: string;
    kind?: 'chat' | 'call_followup';
    trigger?: CallFollowupTrigger;
    time: string | null;
    relationship_tone?: RelationshipTone;
    phone_events?: PhoneEventId[];
  };
}
export type HealthStatus = 'ready' | 'loading' | 'error';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}
function messages(value: unknown, character: AiCharacter): value is AiMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (message: unknown) =>
        record(message) &&
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        (message.request_kind === undefined ||
          ['chat', 'call_followup'].includes(String(message.request_kind))) &&
        (message.time === null || typeof message.time === 'string') &&
        (message.relationship_tone === undefined ||
          isRelationshipTone(message.relationship_tone)) &&
        (message.phone_events === undefined || isPhoneEvents(character, message.phone_events)),
    )
  );
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string = 'network',
  ) {
    super(message);
  }
}

const BLOCKED_CONTENT_MESSAGE =
  '이 대화에서는 노골적인 성적 내용은 주고받지 않습니다. 다른 이야기로 보내 주세요.';

function serverError(status: number, code?: string): AiRequestError {
  if (status === 400 && code === 'content_blocked')
    return new AiRequestError(BLOCKED_CONTENT_MESSAGE, 'content_blocked');
  if (status === 400 || status === 422)
    return new AiRequestError(
      '메시지를 보낼 수 없습니다. 내용을 수정해 다시 보내 주세요.',
      'invalid_input',
    );
  if (status === 413)
    return new AiRequestError(
      '메시지가 너무 깁니다. 1000자 이내로 줄여 다시 보내 주세요.',
      'input_limit',
    );
  if (status === 401) return new AiRequestError('대화 연결을 갱신하고 있습니다.', 'auth');
  if (status === 403)
    return new AiRequestError('지금은 대화에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  if (status === 409)
    return new AiRequestError('이전 답장을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.', 'busy');
  if (status === 429) return new AiRequestError('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  if (status === 503)
    return new AiRequestError('지금은 답장을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.');
  return new AiRequestError('요청을 처리하지 못했습니다. 다시 시도해 주세요.');
}

export function generationError(code?: string): string {
  if (code === 'content_blocked') return BLOCKED_CONTENT_MESSAGE;
  if (code === 'context_limit')
    return '메시지를 조금 짧게 나누어 보내 주세요. 기존 대화는 보관됩니다.';
  if (code === 'output_limit' || code === 'response_truncated')
    return '답장이 길이 한도 안에서 끝나지 않았습니다. 질문을 더 짧게 나누어 다시 보내 주세요.';
  return '답장을 만들지 못했습니다. 잠시 후 다시 보내 주세요.';
}

export async function aiRequest(
  endpoint: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
    signal?: AbortSignal;
    method?: 'GET' | 'POST' | 'DELETE';
    keepalive?: boolean;
  } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 12_000);
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
      keepalive: options.keepalive,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      // Only known codes may select fixed UI text. Never render server exception text.
      const body: unknown = await response.json().catch(() => null);
      const code =
        record(body) && record(body.error) && typeof body.error.code === 'string'
          ? body.error.code
          : undefined;
      throw serverError(response.status, code);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    throw new AiRequestError('지금은 대화에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function getHealth(endpoint: string, signal?: AbortSignal): Promise<HealthStatus> {
  const value = await aiRequest(endpoint, '/v1/health', { signal });
  if (record(value) && ['ready', 'loading', 'error'].includes(String(value.status))) {
    return value.status as HealthStatus;
  }
  throw new AiRequestError('대화 서비스의 응답을 읽을 수 없습니다.');
}

export async function createSession(endpoint: string, signal?: AbortSignal): Promise<AiConnection> {
  const value = await aiRequest(endpoint, '/v1/sessions', {
    body: {},
    signal,
  });
  if (!record(value) || !validToken(value.token)) {
    throw new AiRequestError('대화 연결을 시작하지 못했습니다.');
  }
  return { endpoint, token: value.token };
}

export async function getHistory(
  connection: AiConnection,
  character: AiCharacter,
  signal?: AbortSignal,
  cursor?: string | null,
): Promise<AiHistory> {
  const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
  const value = await aiRequest(
    connection.endpoint,
    `/v1/history?character=${character}${suffix}`,
    {
      token: connection.token,
      signal,
    },
  );
  if (
    !record(value) ||
    !messages(value.messages, character) ||
    !(value.pending_job === null || typeof value.pending_job === 'string') ||
    !(value.next_cursor === null || typeof value.next_cursor === 'string') ||
    (value.completed_exchanges !== undefined &&
      (typeof value.completed_exchanges !== 'number' ||
        !Number.isSafeInteger(value.completed_exchanges) ||
        value.completed_exchanges < 0))
  ) {
    throw new AiRequestError('대화 기록을 읽을 수 없습니다.');
  }
  return {
    messages: value.messages,
    pending_job: value.pending_job,
    next_cursor: value.next_cursor,
    ...(value.completed_exchanges === undefined
      ? {}
      : { completed_exchanges: value.completed_exchanges as number }),
  };
}

export async function postChat(
  connection: AiConnection,
  character: AiCharacter,
  message: string,
  requestId: string,
  signal?: AbortSignal,
  relationshipTone: RelationshipTone = 'neutral',
  phoneEvents: readonly PhoneEventId[] = [],
): Promise<string> {
  if (!isRelationshipTone(relationshipTone))
    throw new AiRequestError('올바른 인연 상태가 필요합니다.', 'invalid_input');
  if (!isPhoneEvents(character, phoneEvents))
    throw new AiRequestError('올바른 전화·할 일 상태가 필요합니다.', 'invalid_input');
  const value = await aiRequest(connection.endpoint, '/v1/chat', {
    token: connection.token,
    body: {
      character,
      message,
      request_id: requestId,
      relationship_tone: relationshipTone,
      phone_events: phoneEvents,
    },
    signal,
  });
  if (!record(value) || typeof value.job_id !== 'string' || !value.job_id) {
    throw new AiRequestError('전송 상태를 확인할 수 없습니다.');
  }
  return value.job_id;
}

export async function getJob(
  connection: AiConnection,
  jobId: string,
  character: AiCharacter,
  signal?: AbortSignal,
): Promise<AiJob> {
  const value = await aiRequest(connection.endpoint, `/v1/jobs/${encodeURIComponent(jobId)}`, {
    token: connection.token,
    signal,
  });
  if (
    !record(value) ||
    value.job_id !== jobId ||
    value.character !== character ||
    !['queued', 'generating', 'complete', 'error'].includes(String(value.status)) ||
    (value.messages !== undefined && !messages(value.messages, character)) ||
    (value.request !== undefined &&
      (!record(value.request) ||
        typeof value.request.id !== 'string' ||
        (value.request.kind === 'call_followup'
          ? !isCallFollowupTrigger(value.request.trigger) || value.request.message !== undefined
          : typeof value.request.message !== 'string') ||
        (value.request.time !== null && typeof value.request.time !== 'string') ||
        (value.request.relationship_tone !== undefined &&
          !isRelationshipTone(value.request.relationship_tone)) ||
        (value.request.phone_events !== undefined &&
          !isPhoneEvents(character, value.request.phone_events))))
  ) {
    throw new AiRequestError('답장 상태를 확인할 수 없습니다.');
  }
  return value as unknown as AiJob;
}

export async function postCallFollowup(
  connection: AiConnection,
  character: AiCharacter,
  requestId: string,
  trigger: CallFollowupTrigger,
  relationshipTone: RelationshipTone,
  signal?: AbortSignal,
): Promise<string> {
  if (!isCallFollowupTrigger(trigger) || !isRelationshipTone(relationshipTone))
    throw new AiRequestError('전화 상태를 확인할 수 없습니다.', 'invalid_input');
  const value = await aiRequest(connection.endpoint, '/v1/call-followups', {
    token: connection.token,
    signal,
    body: { character, request_id: requestId, ...trigger, relationship_tone: relationshipTone },
  });
  if (!record(value) || typeof value.job_id !== 'string' || !value.job_id)
    throw new AiRequestError('전화 후속 상태를 확인할 수 없습니다.');
  return value.job_id;
}

export function shouldSendOnEnter(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
