import type { AiCharacter, AiMessage } from './client';
import { readAiResetId, type AiConnection } from './connection';

export const AI_PRESENTATION_KEY = 'yaku-iphone.ai.delivery.v1';
export const MIN_TYPING_MS = 1500;
export interface ReplyReceipt {
  fast?: boolean;
  unsolicited?: boolean;
  requestId: string;
  character: AiCharacter;
  typingAt: number;
  deliverAt: number;
  jobId?: string;
  replyId?: string;
  delivered: boolean;
  read: boolean;
}

/** Stable jitter, not authentication. No token or message text is duplicated in this store. */
function fingerprint(value: string): string {
  let a = 2166136261;
  let b = 5381;
  for (const c of value) {
    a = Math.imul(a ^ c.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ c.charCodeAt(0);
  }
  return `${a >>> 0}-${b >>> 0}`;
}
export function typingDelay(requestId: string): number {
  return 15_000 + (Number(fingerprint(requestId).split('-')[0]) % 15_001);
}
export class ReplyPresentation {
  receipts: ReplyReceipt[] = [];
  private scope = '';
  private resetId = readAiResetId();
  use(connection: AiConnection | null): void {
    const scope = connection ? fingerprint(connection.endpoint + ':' + connection.token) : '';
    if (scope === this.scope && this.resetId === readAiResetId()) return;
    this.scope = scope;
    this.resetId = readAiResetId();
    this.receipts = [];
    if (!scope) return;
    try {
      const saved = JSON.parse(localStorage.getItem(AI_PRESENTATION_KEY) ?? 'null');
      if (
        saved?.scope !== scope ||
        saved.resetId !== this.resetId ||
        !Array.isArray(saved.receipts)
      )
        return;
      this.receipts = saved.receipts
        .filter(
          (r: ReplyReceipt) =>
            r &&
            typeof r.requestId === 'string' &&
            ['haruka', 'majima'].includes(r.character) &&
            Number.isFinite(r.typingAt) &&
            Number.isFinite(r.deliverAt) &&
            (r.fast === undefined || typeof r.fast === 'boolean') &&
            (r.unsolicited === undefined || typeof r.unsolicited === 'boolean') &&
            r.deliverAt >= r.typingAt + (r.fast ? 0 : MIN_TYPING_MS) &&
            typeof r.delivered === 'boolean' &&
            typeof r.read === 'boolean' &&
            (r.jobId === undefined || typeof r.jobId === 'string') &&
            (r.replyId === undefined || typeof r.replyId === 'string'),
        )
        .slice(-200);
    } catch {
      /* Storage is optional; current screen still works. */
    }
  }
  save(): void {
    if (!this.scope || this.resetId !== readAiResetId()) return;
    // Keep all pending/unread receipts and only the most recent read deliveries.
    this.receipts = this.receipts.filter((r, i, all) => !r.read || i >= all.length - 100);
    try {
      localStorage.setItem(
        AI_PRESENTATION_KEY,
        JSON.stringify({ scope: this.scope, resetId: this.resetId, receipts: this.receipts }),
      );
    } catch {
      /* Do not fail a successfully received message on storage failure. */
    }
  }
  begin(
    character: AiCharacter,
    requestId: string,
    startedAt = Date.now(),
    fast = false,
    unsolicited = false,
  ): ReplyReceipt {
    const existing = this.receipts.find((r) => r.requestId === requestId);
    if (existing) return existing;
    const typingAt = startedAt + (fast ? 0 : typingDelay(requestId));
    const receipt = {
      character,
      requestId,
      typingAt,
      deliverAt: typingAt + (fast ? 0 : MIN_TYPING_MS),
      ...(fast ? { fast: true } : {}),
      ...(unsolicited ? { unsolicited: true } : {}),
      delivered: false,
      read: false,
    };
    this.receipts.push(receipt);
    this.save();
    return receipt;
  }
  observe(character: AiCharacter, messages: AiMessage[]): void {
    for (const receipt of this.receipts.filter((r) => r.character === character && !r.delivered)) {
      if (receipt.fast || receipt.unsolicited) {
        const reply = messages.find(
          (m) =>
            m.role === 'assistant' &&
            m.request_id === receipt.requestId &&
            (m.request_kind === 'call_followup' || m.request_kind === 'proactive_episode') &&
            (m.status === undefined || m.status === 'complete'),
        );
        if (reply && !receipt.replyId) {
          receipt.replyId = reply.id;
          receipt.jobId = reply.job_id ?? receipt.jobId;
          receipt.deliverAt = Math.max(
            receipt.typingAt + (receipt.fast ? 0 : MIN_TYPING_MS),
            Date.now(),
          );
        }
        continue;
      }
      const index = messages.findIndex(
        (m) => m.role === 'user' && m.request_id === receipt.requestId,
      );
      if (index < 0) continue;
      const request = messages[index];
      receipt.jobId = request.job_id ?? receipt.jobId;
      if (request.status === 'error' || request.status === 'interrupted') {
        receipt.delivered = true;
        receipt.read = true;
        continue;
      }
      const next =
        messages.find((m) => m.role === 'assistant' && m.request_id === receipt.requestId) ??
        messages[index + 1];
      if (
        !receipt.replyId &&
        next?.role === 'assistant' &&
        next.request_kind !== 'call_followup' &&
        next.request_kind !== 'proactive_episode' &&
        (!next.request_id || next.request_id === receipt.requestId) &&
        (next.status === undefined || next.status === 'complete')
      ) {
        receipt.replyId = next.id;
        const acceptedAt = request.time ? Date.parse(request.time) : NaN;
        const completedAt = next.time ? Date.parse(next.time) : NaN;
        // Use a server-to-server duration, never compare clocks on two devices.
        const duration = completedAt - acceptedAt;
        receipt.deliverAt = Math.max(
          receipt.typingAt + MIN_TYPING_MS,
          Number.isFinite(duration) && duration >= 0
            ? receipt.typingAt + duration
            : Date.now() + typingDelay(receipt.requestId),
        );
      }
    }
    this.save();
  }
  settleBeforeInput(requestId: string): void {
    const receipt = this.receipts.find((r) => r.requestId === requestId && !r.delivered);
    if (!receipt) return;
    if (!receipt.replyId) {
      this.cancel(requestId);
      return;
    }
    // Already committed text stays in canonical history, but does not become a delayed new arrival.
    receipt.delivered = true;
    receipt.read = true;
    this.save();
  }
  cancel(requestId: string): void {
    this.receipts = this.receipts.filter((r) => r.requestId !== requestId);
    this.save();
  }
}
