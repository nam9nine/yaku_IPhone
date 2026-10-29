import type { AiMessage } from './client';
import { typingDelay, type ReplyReceipt } from './presentation';

interface TimelineMessage {
  createdAt?: number;
  displayedAt?: number;
  time?: string | null;
}
function epoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function serverTimestamp(time: string | null | undefined): number | undefined {
  // A local display string such as "16:40" or "어제" does not establish an event date.
  if (!time || !/^\d{4}-\d{2}-\d{2}T/.test(time)) return undefined;
  const value = Date.parse(time);
  return epoch(value) ? value : undefined;
}
export function displayedMessageTime(
  message: AiMessage,
  receipt?: ReplyReceipt,
): number | undefined {
  if (receipt) {
    const value =
      message.role === 'assistant'
        ? receipt.deliverAt
        : receipt.typingAt - typingDelay(receipt.requestId);
    if (epoch(value)) return value;
  }
  return serverTimestamp(message.time);
}
function timestamp(message: TimelineMessage): number | undefined {
  if (epoch(message.displayedAt)) return message.displayedAt;
  if (epoch(message.createdAt)) return message.createdAt;
  return serverTimestamp(message.time);
}
/** Initial/legacy story has no real timestamp. Keep it first; then merge actual arrivals stably. */
export function mergeMessageTimeline<T extends TimelineMessage, R extends TimelineMessage = T>(
  story: readonly T[],
  remote: readonly R[],
): (T | R)[] {
  const initial = story.filter((message) => timestamp(message) === undefined);
  const local = story.filter((message) => timestamp(message) !== undefined);
  const merged: (T | R)[] = [...initial];
  let localIndex = 0;
  let remoteIndex = 0;
  // Each source already has an authoritative sequence. Merge the streams without
  // sorting either one: null dates in imported history are unknown, not the future.
  // Keep those rows beside the preceding remote rows, before a dated new arrival.
  while (localIndex < local.length && remoteIndex < remote.length) {
    const localAt = timestamp(local[localIndex])!;
    const remoteAt = timestamp(remote[remoteIndex]);
    if (remoteAt !== undefined && localAt <= remoteAt) merged.push(local[localIndex++]);
    else merged.push(remote[remoteIndex++]);
  }
  return [...merged, ...local.slice(localIndex), ...remote.slice(remoteIndex)];
}
