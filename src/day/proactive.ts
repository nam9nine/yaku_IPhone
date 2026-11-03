import catalog from './phone-events.json' with { type: 'json' };
import type { PhoneEventId } from './phoneEvents';

const checkInIds = [
  'majima-proactive-check-phone',
  'majima-proactive-challenge',
  'majima-proactive-karaoke',
  'majima-proactive-rematch',
  'majima-proactive-call-me',
  'majima-proactive-plans',
  'majima-proactive-quiet',
  'majima-proactive-bowling',
  'majima-proactive-darts',
  'majima-proactive-pocket',
  'majima-proactive-hello',
] as const satisfies readonly PhoneEventId[];

/**
 * Authored IF messages, not fabricated model responses or canon quotes. One delivery each per reset.
 * The text comes from the shared event catalog, so the AI reads the exact line shown in the thread.
 */
export const majimaCheckIns: { id: PhoneEventId; text: string }[] = checkInIds.map((id) => ({
  id,
  text: catalog.events[id].message,
}));
