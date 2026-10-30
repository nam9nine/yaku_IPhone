import { aiRequest, AiRequestError, type RelationshipTone } from './client';
import type { AiConnection } from './connection';

export interface EpisodeMessageAction {
  kind: 'message';
  id: string;
  job_id: string;
}
export interface EpisodeCallAction {
  kind: 'call';
  id: string;
  call_id: string;
}
export interface EpisodeStatus {
  protocol: 1;
  enabled: boolean;
  episode: {
    episode_id: string;
    instance_id: string;
    version: number;
    phase: 'not_started' | 'awaiting_reply' | 'accepted' | 'deferred' | 'closed';
    contact_stage: string;
  } | null;
  action: EpisodeMessageAction | EpisodeCallAction | null;
  accepted?: boolean;
}
export type EpisodeReport =
  | { kind: 'presence'; active: boolean; relationship_tone: RelationshipTone }
  | { kind: 'delivered'; action_id: string; job_id: string }
  | { kind: 'call_started'; action_id: string; call_id: string }
  | { kind: 'call_result'; call_id: string; outcome: 'missed' | 'declined' | 'idle' | 'ended' };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 160;
export function validEpisodeStatus(value: unknown): value is EpisodeStatus {
  if (!record(value) || value.protocol !== 1 || typeof value.enabled !== 'boolean') return false;
  if (value.accepted !== undefined && typeof value.accepted !== 'boolean') return false;
  const episode = value.episode;
  if (
    episode !== null &&
    (!record(episode) ||
      !identifier(episode.episode_id) ||
      !identifier(episode.instance_id) ||
      !Number.isSafeInteger(episode.version) ||
      Number(episode.version) < 1 ||
      !['not_started', 'awaiting_reply', 'accepted', 'deferred', 'closed'].includes(
        String(episode.phase),
      ) ||
      typeof episode.contact_stage !== 'string')
  )
    return false;
  const action = value.action;
  return (
    action === null ||
    (record(action) &&
      identifier(action.id) &&
      ((action.kind === 'message' && identifier(action.job_id)) ||
        (action.kind === 'call' && identifier(action.call_id))))
  );
}
export async function episodeRequest(
  connection: AiConnection,
  signal?: AbortSignal,
  report?: EpisodeReport & { client_id: string; sequence: number },
  keepalive = false,
): Promise<EpisodeStatus> {
  const result = await aiRequest(
    connection.endpoint,
    '/v1/episodes/majima' + (report ? '' : '?protocol=1'),
    {
      token: connection.token,
      signal,
      ...(report ? { body: { protocol: 1, ...report } } : {}),
      keepalive,
    },
  );
  if (!validEpisodeStatus(result)) throw new AiRequestError('연락 상태를 확인할 수 없습니다.');
  return result;
}
/** Non-secret scope marker; no visitor token is copied into phone state. */
export function episodeScope(connection: AiConnection): string {
  let hash = 2166136261;
  for (const c of connection.endpoint + ':' + connection.token)
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `episode-${hash >>> 0}`;
}

/** Public capability probe never creates a visitor or reads a conversation. */
export async function episodeAvailable(endpoint: string, signal?: AbortSignal): Promise<boolean> {
  const value = await aiRequest(endpoint, '/v1/health', { signal });
  return record(value) && value.episode_protocol === 1 && value.episodes_enabled === true;
}
