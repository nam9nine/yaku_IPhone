import { isCallEvents } from './client';
import type { AiThread } from './messenger';

/** Calls remain in durable history and the call view, never in SMS presentation. */
export function messageThread(thread: AiThread): AiThread {
  const callPending = isCallEvents(thread.pending?.phoneEvents);
  const callFailed = isCallEvents(thread.failedMessage?.phoneEvents);
  return {
    ...thread,
    messages: thread.messages.filter((message) => !isCallEvents(message.phone_events)),
    displayedMessages: thread.displayedMessages.filter(
      (message) => !isCallEvents(message.phone_events),
    ),
    pending: callPending ? null : thread.pending,
    failedMessage: callFailed ? null : thread.failedMessage,
    error: callPending || callFailed ? null : thread.error,
  };
}
