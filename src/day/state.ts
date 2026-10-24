import {
  contactIds,
  ingredients,
  type ContactId,
  type IngredientId,
  type ReminderId,
} from './content';

export interface DayState {
  ingredients: Record<IngredientId, boolean>;
  reminders: { garden: boolean; mame: boolean };
  readThreads: ContactId[];
  replies: ContactId[];
  aiReplies: ContactId[];
  replySent: boolean;
  missedCall: boolean;
  missedCallRead: boolean;
  callStatus: null | 'ringing' | 'missed' | 'answered';
}
export type DayAction =
  | { type: 'read-thread'; id: string }
  | { type: 'ingredient'; id: IngredientId; done: boolean }
  | { type: 'reminder'; id: ReminderId; done: boolean }
  | { type: 'reply'; id: string; source?: 'ai' }
  | { type: 'read-call' }
  | { type: 'answer-call' }
  | { type: 'miss-call' }
  | { type: 'reset' };
export const DAY_STORAGE_KEY = 'yaku-iphone.day.v1';
export function initialDay(): DayState {
  return {
    ingredients: { potato: false, onion: false, meat: false, curry: false },
    reminders: { garden: false, mame: false },
    readThreads: [],
    replies: [],
    aiReplies: [],
    replySent: false,
    missedCall: false,
    missedCallRead: false,
    callStatus: null,
  };
}
export function shoppingComplete(state: DayState): boolean {
  return ingredients.every(({ id }) => state.ingredients[id]);
}
export function remainingReminders(state: DayState): number {
  return (
    3 -
    Number(shoppingComplete(state)) -
    Number(state.reminders.garden) -
    Number(state.reminders.mame)
  );
}
function isContact(id: string): id is ContactId {
  return (contactIds as readonly string[]).includes(id);
}
export function dayReducer(state: DayState, action: DayAction): DayState {
  switch (action.type) {
    case 'reset':
      return initialDay();
    case 'read-thread':
      return !isContact(action.id) || state.readThreads.includes(action.id)
        ? state
        : { ...state, readThreads: [...state.readThreads, action.id] };
    case 'ingredient': {
      if (
        !ingredients.some(({ id }) => id === action.id) ||
        state.ingredients[action.id] === action.done
      )
        return state;
      const next = { ...state, ingredients: { ...state.ingredients, [action.id]: action.done } };
      return {
        ...next,
        missedCall: state.missedCall || shoppingComplete(next),
        callStatus: !state.missedCall && shoppingComplete(next) ? 'ringing' : state.callStatus,
      };
    }
    case 'reminder': {
      if (action.id === 'shopping') {
        const next = {
          ...state,
          ingredients: Object.fromEntries(
            ingredients.map(({ id }) => [id, action.done]),
          ) as DayState['ingredients'],
        };
        return {
          ...next,
          missedCall: state.missedCall || action.done,
          callStatus: !state.missedCall && action.done ? 'ringing' : state.callStatus,
        };
      }
      if (action.id !== 'garden' && action.id !== 'mame') return state;
      return { ...state, reminders: { ...state.reminders, [action.id]: action.done } };
    }
    case 'reply': {
      if (
        !isContact(action.id) ||
        state.replies.includes(action.id) ||
        (action.id === 'haruka' && !shoppingComplete(state))
      )
        return state;
      return {
        ...state,
        replies: [...state.replies, action.id],
        aiReplies: action.source === 'ai' ? [...state.aiReplies, action.id] : state.aiReplies,
        replySent: state.replySent || action.id === 'haruka',
        readThreads: state.readThreads.includes(action.id)
          ? state.readThreads
          : [...state.readThreads, action.id],
      };
    }
    case 'answer-call':
      return state.callStatus === 'ringing'
        ? { ...state, callStatus: 'answered', missedCallRead: true }
        : state;
    case 'miss-call':
      return state.callStatus === 'ringing'
        ? { ...state, callStatus: 'missed', missedCallRead: false }
        : state;
    case 'read-call':
      return state.missedCall && !state.missedCallRead ? { ...state, missedCallRead: true } : state;
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function contactsArray(value: unknown): value is ContactId[] {
  return (
    Array.isArray(value) &&
    value.length <= contactIds.length &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && isContact(id))
  );
}
export function validDay(value: unknown): value is DayState {
  if (!record(value) || !record(value.ingredients) || !record(value.reminders)) return false;
  const items = value.ingredients;
  const tasks = value.reminders;
  if (
    Object.keys(items).length !== ingredients.length ||
    !ingredients.every(({ id }) => typeof items[id] === 'boolean') ||
    Object.keys(tasks).length !== 2 ||
    typeof tasks.garden !== 'boolean' ||
    typeof tasks.mame !== 'boolean'
  )
    return false;
  if (
    !contactsArray(value.readThreads) ||
    !contactsArray(value.replies) ||
    !contactsArray(value.aiReplies) ||
    typeof value.replySent !== 'boolean' ||
    typeof value.missedCall !== 'boolean' ||
    typeof value.missedCallRead !== 'boolean' ||
    ![null, 'ringing', 'missed', 'answered'].includes(value.callStatus as string | null) ||
    value.missedCall === (value.callStatus === null)
  )
    return false;
  if (
    value.replySent !== value.replies.includes('haruka') ||
    (value.replySent && !value.missedCall) ||
    (value.missedCallRead && !value.missedCall)
  )
    return false;
  if (!value.replies.every((id) => (value.readThreads as ContactId[]).includes(id))) return false;
  if (!value.aiReplies.every((id) => (value.replies as ContactId[]).includes(id))) return false;
  return !ingredients.every(({ id }) => items[id]) || value.missedCall;
}
export function loadDay(storage: Pick<Storage, 'getItem'>): {
  state: DayState;
  unavailable: boolean;
} {
  try {
    const raw = storage.getItem(DAY_STORAGE_KEY);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      // Old v1 records had no incoming phase. A page reload never rings again.
      if (record(value) && !('callStatus' in value))
        value.callStatus = value.missedCall ? 'missed' : null;
      if (record(value) && !('aiReplies' in value)) value.aiReplies = [];
      if (validDay(value))
        return {
          state: value.callStatus === 'ringing' ? { ...value, callStatus: 'missed' } : value,
          unavailable: false,
        };
    }
    return { state: initialDay(), unavailable: false };
  } catch {
    return { state: initialDay(), unavailable: true };
  }
}
