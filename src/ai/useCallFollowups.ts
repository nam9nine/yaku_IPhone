import { useEffect } from 'react';
import { useDay } from '../day/DayContext';
import type { AiMessengerView } from './useAiMessenger';

/** Durable phone events are acknowledged only after the API accepts their UUID. */
export function useCallFollowups(ai: AiMessengerView, online: boolean): void {
  const { state, dispatch } = useDay();
  const pending = state.pendingCallFollowups;
  useEffect(() => {
    if (!online || !pending.length) return;
    let current = true;
    const pump = () => {
      const seen = new Set<string>();
      for (const event of pending) {
        if (seen.has(event.character)) continue;
        seen.add(event.character);
        void ai.messenger
          .followUp(
            event.character,
            event.requestId,
            {
              call_id: event.callId,
              reason: event.reason,
              direction: event.direction,
            },
            event.relationshipTone,
          )
          .then((accepted) => {
            if (current && accepted) dispatch({ type: 'ack-followup', requestId: event.requestId });
          })
          .catch(() => {
            /* Keep the durable event for the next attempt. */
          });
      }
    };
    pump();
    const timer = window.setInterval(pump, 3000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [ai.messenger, online, pending, dispatch]);
}
