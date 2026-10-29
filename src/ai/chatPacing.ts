/** A product pacing default after authored choices end, independent of model generation time. */
export const CONVERSATION_REST_MS = 45_000;
export function conversationRestDeadline(
  messages: {
    role: string;
    status?: string;
    time: string | null;
    displayedAt?: number;
  }[],
  completedCount?: number,
): number {
  const successful =
    completedCount ??
    messages.filter((message) => message.role === 'user' && message.status === 'complete').length;
  if (!successful || successful % 3 !== 0) return 0;
  const last = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!last) return 0;
  const at = last.displayedAt ?? (last.time ? Date.parse(last.time) : NaN);
  return Number.isFinite(at) ? at + CONVERSATION_REST_MS : 0;
}
