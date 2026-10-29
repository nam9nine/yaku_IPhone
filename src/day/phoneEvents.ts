import catalog from './phone-events.json' with { type: 'json' };

export type PhoneEventId = keyof typeof catalog.events;
export type PhoneEventCharacter = 'haruka' | 'majima';
export type PhoneEventLog = Record<PhoneEventCharacter, PhoneEventId[]>;

function character(value: string): value is PhoneEventCharacter {
  return value === 'haruka' || value === 'majima';
}
function allowed(id: unknown, owner: string): id is PhoneEventId {
  return (
    typeof id === 'string' &&
    Object.hasOwn(catalog.events, id) &&
    catalog.events[id as PhoneEventId].character === owner
  );
}
/** These are browser IF actions, not proof of a canonical event or a real-world purchase. */
export function appendPhoneEvent(log: PhoneEventLog, event: PhoneEventId): PhoneEventLog {
  const owner = catalog.events[event].character;
  if (!character(owner)) return log;
  return { ...log, [owner]: [...log[owner].filter((id) => id !== event), event].slice(-4) };
}
/** Oldest to newest; repeat types occupy only their latest position. Never cross characters. */
export function recentPhoneEvents(
  state: { phoneEvents: PhoneEventLog },
  owner: string,
): PhoneEventId[] {
  if (!character(owner)) return [];
  return [...new Set([...state.phoneEvents[owner]].reverse().filter((id) => allowed(id, owner)))]
    .slice(0, 4)
    .reverse();
}
export function validPhoneEventLog(value: unknown): value is PhoneEventLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const log = value as Record<string, unknown>;
  if (Object.keys(log).length !== 2) return false;
  return ['haruka', 'majima'].every((owner) => {
    const events = log[owner];
    return (
      Array.isArray(events) &&
      events.length <= 4 &&
      new Set(events).size === events.length &&
      events.every((event) => allowed(event, owner))
    );
  });
}
