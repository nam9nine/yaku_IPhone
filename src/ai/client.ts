import { validToken, type AiConnection } from './connection';

export const aiCharacters = ['haruka', 'majima'] as const;
export type AiCharacter = (typeof aiCharacters)[number];
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

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
}
export interface AiHistory {
  messages: AiMessage[];
  pending_job: string | null;
}
export interface AiJob {
  job_id: string;
  character: AiCharacter;
  status: 'queued' | 'generating' | 'complete' | 'error';
  reply?: string;
  error?: { code: string; message: string };
  messages?: AiMessage[];
  request?: { id: string; message: string; time: string };
}
export type HealthStatus = 'ready' | 'loading' | 'error';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}
function messages(value: unknown): value is AiMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (message: unknown) =>
        record(message) &&
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        typeof message.time === 'string',
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

function serverError(status: number): AiRequestError {
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
  if (status === 401 || status === 403)
    return new AiRequestError('접속 권한이 만료되었습니다. Mac에 다시 연결해 주세요.', 'auth');
  if (status === 409)
    return new AiRequestError('Mac에서 이전 답장을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.');
  if (status === 429) return new AiRequestError('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  if (status === 503)
    return new AiRequestError('Mac의 모델이 준비되지 않았습니다. 서버 상태를 확인해 주세요.');
  return new AiRequestError('Mac에서 요청을 처리하지 못했습니다. 다시 시도해 주세요.');
}

export function generationError(code?: string): string {
  if (code === 'context_limit')
    return '대화가 길이 한도에 도달했습니다. 메시지를 줄이거나 Mac에 다시 연결해 새 대화를 시작해 주세요.';
  if (code === 'output_limit')
    return '답장이 길이 한도 안에서 끝나지 않았습니다. 질문을 더 짧게 나누어 다시 보내 주세요.';
  return 'Mac에서 답장을 만들지 못했습니다. 서버 상태를 확인한 뒤 메시지를 다시 보내 주세요.';
}

export async function aiRequest(
  endpoint: string,
  path: string,
  options: { token?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 12_000);
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw serverError(response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    throw new AiRequestError('Mac에 연결할 수 없습니다. 서버와 인터넷 연결을 확인해 주세요.');
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
  throw new AiRequestError('Mac 서버의 응답 형식을 확인해 주세요.');
}

export async function createSession(
  endpoint: string,
  inviteKey: string,
  signal?: AbortSignal,
): Promise<AiConnection> {
  const value = await aiRequest(endpoint, '/v1/sessions', {
    body: { invite_key: inviteKey },
    signal,
  });
  if (!record(value) || !validToken(value.token)) {
    throw new AiRequestError('Mac 서버가 유효한 접속 정보를 보내지 않았습니다.');
  }
  return { endpoint, token: value.token };
}

export async function getHistory(
  connection: AiConnection,
  character: AiCharacter,
  signal?: AbortSignal,
): Promise<AiHistory> {
  const value = await aiRequest(connection.endpoint, `/v1/history?character=${character}`, {
    token: connection.token,
    signal,
  });
  if (
    !record(value) ||
    !messages(value.messages) ||
    !(value.pending_job === null || typeof value.pending_job === 'string')
  ) {
    throw new AiRequestError('Mac 서버의 대화 기록을 읽을 수 없습니다.');
  }
  return { messages: value.messages, pending_job: value.pending_job };
}

export async function postChat(
  connection: AiConnection,
  character: AiCharacter,
  message: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<string> {
  const value = await aiRequest(connection.endpoint, '/v1/chat', {
    token: connection.token,
    body: { character, message, request_id: requestId },
    signal,
  });
  if (!record(value) || typeof value.job_id !== 'string' || !value.job_id) {
    throw new AiRequestError('Mac 서버의 전송 상태를 확인할 수 없습니다.');
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
    (value.messages !== undefined && !messages(value.messages)) ||
    (value.request !== undefined &&
      (!record(value.request) ||
        typeof value.request.id !== 'string' ||
        typeof value.request.message !== 'string' ||
        typeof value.request.time !== 'string'))
  ) {
    throw new AiRequestError('Mac 서버의 답장 상태를 확인할 수 없습니다.');
  }
  return value as unknown as AiJob;
}

export function shouldSendOnEnter(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
