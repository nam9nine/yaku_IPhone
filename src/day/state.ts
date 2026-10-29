import { majimaCheckIns } from './proactive';
import {
  appendPhoneEvent,
  validPhoneEventLog,
  type PhoneEventLog,
  type PhoneEventId,
} from './phoneEvents';
import {
  callScripts,
  contactIds,
  ingredients,
  questFollowups,
  reminders,
  storyRounds,
  type ContactId,
  type DayMessage,
  type IngredientId,
  type ReminderId,
  type StoryChoice,
} from './content';

export interface StoryPending {
  choiceId: string;
  deliverAt: number;
}
export interface StoryCall {
  id: string;
  caller: ContactId;
  direction: 'incoming' | 'outgoing';
  phase: 'ringing' | 'connected';
  elapsedMs: number;
  lines: string[];
  source: 'quest' | 'scheduled' | 'user';
}
export interface StoryCallRecord {
  id: string;
  caller: ContactId;
  direction: 'incoming' | 'outgoing';
  result: 'missed' | 'declined' | 'completed';
  time: string;
  read: boolean;
}
export interface DayState {
  ingredients: Record<IngredientId, boolean>;
  reminders: Record<Exclude<ReminderId, 'shopping'>, boolean>;
  readThreads: ContactId[];
  replies: ContactId[];
  legacyReplies: ContactId[];
  aiReplies: ContactId[];
  replySent: boolean;
  missedCall: boolean;
  missedCallRead: boolean;
  callStatus: null | 'ringing' | 'missed' | 'answered';
  storyMessages: Record<ContactId, DayMessage[]>;
  phoneEvents: PhoneEventLog;
  storyChoiceHistory: Record<ContactId, string[]>;
  storyPending: Partial<Record<ContactId, StoryPending>>;
  completedQuests: ReminderId[];
  kamurochoNotified: boolean;
  storySequence: number;
  elapsedMs: number;
  affinity: number;
  call: StoryCall | null;
  callLog: StoryCallRecord[];
  callSerial: number;
  scheduledCalls: number;
  nextCallInMs: number;
  nextMajimaTextInMs: number;
  majimaCheckInsSent: number;
}
export type DayAction =
  | { type: 'read-thread'; id: string }
  | { type: 'ingredient'; id: IngredientId; done: boolean }
  | { type: 'reminder'; id: ReminderId; done: boolean }
  | { type: 'reply'; id: string; source?: 'ai' }
  | { type: 'story-choice'; id: string; choiceId: string; source?: 'ai' }
  | { type: 'tick'; elapsedMs: number; allowCalls: boolean }
  | { type: 'defer-contact' }
  | { type: 'start-call'; id: string }
  | { type: 'read-call' }
  | { type: 'answer-call' }
  | { type: 'miss-call'; reason?: 'declined' | 'missed' }
  | { type: 'end-call' }
  | { type: 'notify-kamurocho' }
  | { type: 'reset' };
export const DAY_STORAGE_KEY = 'yaku-iphone.day.v1';
const contactRecord = <T>(factory: () => T) =>
  Object.fromEntries(contactIds.map((id) => [id, factory()])) as Record<ContactId, T>;
export function initialDay(): DayState {
  return {
    ingredients: { potato: false, onion: false, meat: false, curry: false },
    reminders: { garden: false, mame: false, uniform: false, parcel: false },
    readThreads: [],
    replies: [],
    legacyReplies: [],
    aiReplies: [],
    replySent: false,
    missedCall: false,
    missedCallRead: false,
    callStatus: null,
    storyMessages: contactRecord(() => []),
    phoneEvents: { haruka: [], majima: [] },
    storyChoiceHistory: contactRecord(() => []),
    storyPending: {},
    completedQuests: [],
    kamurochoNotified: false,
    storySequence: 0,
    elapsedMs: 0,
    affinity: 0,
    call: null,
    callLog: [],
    callSerial: 0,
    scheduledCalls: 0,
    nextCallInMs: 60_000,
    nextMajimaTextInMs: 90_000,
    majimaCheckInsSent: 0,
  };
}
export function shoppingComplete(state: DayState): boolean {
  return ingredients.every(({ id }) => state.ingredients[id]);
}
export function remainingReminders(state: DayState): number {
  return (
    reminders.length -
    Number(shoppingComplete(state)) -
    Object.values(state.reminders).filter(Boolean).length
  );
}
export function affinityTone(state: DayState): 'warm' | 'neutral' | 'cool' {
  return state.affinity <= -2 ? 'cool' : state.affinity >= 2 ? 'warm' : 'neutral';
}
function isContact(id: string): id is ContactId {
  return (contactIds as readonly string[]).includes(id);
}
function questComplete(state: DayState, id: ReminderId) {
  return id === 'shopping' ? shoppingComplete(state) : state.reminders[id];
}
export function getStoryChoices(state: DayState, id: ContactId): StoryChoice[] {
  if (state.storyPending[id]) return [];
  const chosen = state.storyChoiceHistory[id];
  if (id === 'haruka')
    return storyRounds.haruka
      .flat()
      .filter(
        (choice) =>
          !!choice.quest && questComplete(state, choice.quest) && !chosen.includes(choice.id),
      );
  const nextRound = chosen.length
    ? Math.max(
        ...chosen.map((choiceId) =>
          storyRounds[id].findIndex((round) => round.some((choice) => choice.id === choiceId)),
        ),
      ) + 1
    : id !== 'majima' && state.replies.includes(id)
      ? 1
      : 0;
  return storyRounds[id][nextRound] ?? [];
}
function eventTime(state: DayState) {
  const minutes = 16 * 60 + 40 + Math.floor(state.elapsedMs / 60_000);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function appendMessage(
  state: DayState,
  id: ContactId,
  text: string,
  outgoing = false,
  now?: number,
): DayState {
  const sequence = state.storySequence + 1;
  return {
    ...state,
    storySequence: sequence,
    storyMessages: {
      ...state.storyMessages,
      [id]: [
        ...state.storyMessages[id],
        {
          id: `story-${sequence}`,
          sequence,
          text,
          outgoing,
          time: eventTime(state),
          ...(Number.isSafeInteger(now) && Number(now) >= 0 ? { createdAt: now } : {}),
        },
      ].slice(-200),
    },
    readThreads: outgoing
      ? [...new Set([...state.readThreads, id])]
      : state.readThreads.filter((contact) => contact !== id),
  };
}
function beginCall(
  state: DayState,
  caller: ContactId,
  direction: StoryCall['direction'],
  source: StoryCall['source'],
): DayState {
  if (state.call) return state;
  const serial = state.callSerial + 1;
  const lines =
    caller === 'majima' && affinityTone(state) === 'cool'
      ? ['뭐고. 용건 있으면 말해라.', '알았다. 오늘은 길게 얘기 안 한다.']
      : [...callScripts[caller]];
  return {
    ...state,
    callSerial: serial,
    missedCall: true,
    missedCallRead: direction === 'outgoing',
    callStatus: 'ringing',
    call: {
      id: `call-${serial}`,
      caller,
      direction,
      phase: 'ringing',
      elapsedMs: 0,
      lines,
      source,
    },
  };
}
function finishCall(state: DayState, result: StoryCallRecord['result'], now?: number): DayState {
  const call = state.call;
  if (!call) return state;
  const read = result === 'completed' || call.direction === 'outgoing';
  let next: DayState = {
    ...state,
    call: null,
    affinity: Math.max(
      -5,
      Math.min(
        5,
        state.affinity +
          (call.caller === 'majima'
            ? result === 'missed'
              ? 0
              : result === 'completed' && call.elapsedMs >= 12_000
                ? 1
                : -1
            : 0),
      ),
    ),
    callStatus: result === 'completed' ? 'answered' : 'missed',
    missedCallRead: read,
    callLog: [
      {
        id: call.id,
        caller: call.caller,
        direction: call.direction,
        result,
        time: eventTime(state),
        read,
      },
      ...state.callLog,
    ].slice(0, 40),
    nextCallInMs: 120_000 + ((state.callSerial * 79_019) % 120_001),
    nextMajimaTextInMs: Math.max(60_000, state.nextMajimaTextInMs),
  };
  if (call.caller === 'majima') {
    const event: PhoneEventId =
      result === 'missed'
        ? 'majima-call-missed'
        : result === 'declined'
          ? 'majima-call-declined'
          : call.elapsedMs < 12_000
            ? 'majima-call-short'
            : 'majima-call-completed';
    next = { ...next, phoneEvents: appendPhoneEvent(next.phoneEvents, event) };
  }
  if (call.caller === 'majima' && (result !== 'completed' || call.elapsedMs < 12_000)) {
    const cold = affinityTone(state) === 'cool';
    next = appendMessage(
      next,
      'majima',
      cold
        ? '끊을 거면 됐다. 나중에 니가 연락해라.'
        : result === 'missed'
          ? '또 못 받았나. 폰 보이면 연락해라.'
          : '왜 끊노! 볼일 끝나면 니가 다시 걸어라.',
      false,
      now,
    );
  }
  return next;
}
const questPhoneEvents: Partial<Record<ReminderId, PhoneEventId>> = {
  shopping: 'haruka-shopping-checked',
  garden: 'haruka-garden-checked',
  mame: 'haruka-mame-checked',
  uniform: 'haruka-uniform-checked',
};
function completeQuest(state: DayState, id: ReminderId, now?: number): DayState {
  if (!questComplete(state, id)) return state;
  const event = questPhoneEvents[id];
  const withEvent = event
    ? { ...state, phoneEvents: appendPhoneEvent(state.phoneEvents, event) }
    : state;
  if (state.completedQuests.includes(id)) return withEvent;
  const followup = questFollowups[id];
  let next = appendMessage(
    { ...withEvent, completedQuests: [...state.completedQuests, id] },
    followup.character,
    followup.text,
    false,
    now,
  );
  if (id === 'shopping') next = beginCall(next, 'majima', 'incoming', 'quest');
  return next;
}
const schedule: ContactId[] = [
  'majima',
  'daigo',
  'majima',
  'saejima',
  'majima',
  'date',
  'majima',
  'yuki',
  'majima',
  'mine',
  'majima',
  'akiyama',
  'majima',
  'haruka',
];

export function dayReducer(state: DayState, action: DayAction, now?: number): DayState {
  switch (action.type) {
    case 'reset':
      return initialDay();
    case 'defer-contact':
      if (state.nextCallInMs >= 30_000 && state.nextMajimaTextInMs >= 30_000) return state;
      return {
        ...state,
        nextCallInMs: Math.max(30_000, state.nextCallInMs),
        nextMajimaTextInMs: Math.max(30_000, state.nextMajimaTextInMs),
      };
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
      return completeQuest(
        { ...state, ingredients: { ...state.ingredients, [action.id]: action.done } },
        'shopping',
        now,
      );
    }
    case 'reminder': {
      if (!reminders.some(({ id }) => id === action.id)) return state;
      if (action.id === 'shopping')
        return completeQuest(
          {
            ...state,
            ingredients: Object.fromEntries(
              ingredients.map(({ id }) => [id, action.done]),
            ) as DayState['ingredients'],
          },
          'shopping',
          now,
        );
      if (state.reminders[action.id] === action.done) return state;
      return completeQuest(
        { ...state, reminders: { ...state.reminders, [action.id]: action.done } },
        action.id,
        now,
      );
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
        legacyReplies:
          action.source === 'ai'
            ? state.legacyReplies
            : [...new Set([...state.legacyReplies, action.id])],
        aiReplies: action.source === 'ai' ? [...state.aiReplies, action.id] : state.aiReplies,
        replySent: state.replySent || action.id === 'haruka',
        readThreads: [...new Set([...state.readThreads, action.id])],
      };
    }
    case 'story-choice': {
      if (!isContact(action.id)) return state;
      const id = action.id;
      const choice = getStoryChoices(state, id).find((item) => item.id === action.choiceId);
      if (!choice) return state;
      let next: DayState = {
        ...state,
        storyChoiceHistory: {
          ...state.storyChoiceHistory,
          [id]: [...state.storyChoiceHistory[id], choice.id],
        },
        affinity: Math.max(-5, Math.min(5, state.affinity + (choice.affinityDelta ?? 0))),
        replies:
          id === 'haruka' && choice.quest !== 'shopping'
            ? state.replies
            : [...new Set([...state.replies, id])],
        aiReplies:
          action.source === 'ai' && (id !== 'haruka' || choice.quest === 'shopping')
            ? [...new Set([...state.aiReplies, id])]
            : state.aiReplies,
        replySent: state.replySent || (id === 'haruka' && choice.quest === 'shopping'),
        readThreads: [...new Set([...state.readThreads, id])],
      };
      if (action.source === 'ai') return next;
      next = appendMessage(next, id, choice.text, true, now);
      return {
        ...next,
        storyPending: {
          ...next.storyPending,
          [id]: {
            choiceId: choice.id,
            deliverAt: next.elapsedMs + 6000 + ((next.storySequence * 7919) % 6001),
          },
        },
      };
    }
    case 'tick': {
      if (!action.allowCalls && !state.call && !Object.keys(state.storyPending).length)
        return state;
      const delta = Math.min(
        1000,
        Math.max(0, Number.isFinite(action.elapsedMs) ? action.elapsedMs : 0),
      );
      if (!delta) return state;
      let next: DayState = { ...state, elapsedMs: state.elapsedMs + delta };
      for (const id of contactIds) {
        const pending = next.storyPending[id];
        if (!pending || next.elapsedMs < pending.deliverAt) continue;
        const choice = storyRounds[id].flat().find((item) => item.id === pending.choiceId);
        const pendingMap = { ...next.storyPending };
        delete pendingMap[id];
        next = { ...next, storyPending: pendingMap };
        if (choice)
          next = appendMessage(
            next,
            id,
            id === 'majima' && affinityTone(next) === 'cool'
              ? '알았다. 더 할 말 없으면 이만하자.'
              : choice.response,
            false,
            now,
          );
      }
      if (next.call) {
        next = { ...next, call: { ...next.call, elapsedMs: next.call.elapsedMs + delta } };
        const call = next.call!;
        if (call.phase === 'ringing' && call.direction === 'outgoing' && call.elapsedMs >= 2500)
          return {
            ...next,
            callStatus: 'answered',
            missedCallRead: true,
            call: { ...call, phase: 'connected', elapsedMs: 0 },
          };
        if (call.phase === 'ringing' && call.direction === 'incoming' && call.elapsedMs >= 20_000)
          return finishCall(next, 'missed', now);
        return next;
      }
      if (!action.allowCalls || Object.keys(next.storyPending).length) return next;
      next = {
        ...next,
        nextCallInMs: Math.max(0, next.nextCallInMs - delta),
        nextMajimaTextInMs: Math.max(0, next.nextMajimaTextInMs - delta),
      };
      if (next.nextCallInMs === 0) {
        const caller = schedule[next.scheduledCalls % schedule.length];
        next = beginCall(
          { ...next, scheduledCalls: next.scheduledCalls + 1 },
          caller,
          'incoming',
          'scheduled',
        );
      } else if (
        next.nextMajimaTextInMs === 0 &&
        next.majimaCheckInsSent < majimaCheckIns.length &&
        affinityTone(next) !== 'cool'
      ) {
        const checkIn = majimaCheckIns[next.majimaCheckInsSent];
        next = appendMessage(
          {
            ...next,
            majimaCheckInsSent: next.majimaCheckInsSent + 1,
            nextMajimaTextInMs: 90_000 + ((next.majimaCheckInsSent * 53_023) % 90_001),
            nextCallInMs: Math.max(45_000, next.nextCallInMs),
            phoneEvents: appendPhoneEvent(next.phoneEvents, checkIn.id),
          },
          'majima',
          checkIn.text,
          false,
          now,
        );
      }
      return next;
    }
    case 'notify-kamurocho': {
      if (state.kamurochoNotified || state.call) return state;
      let next = appendMessage(
        {
          ...state,
          kamurochoNotified: true,
          phoneEvents: appendPhoneEvent(state.phoneEvents, 'majima-kamurocho-intent'),
        },
        'majima',
        '형님, 카무로쵸로 갈 생각입니다. 도착하면 연락드리겠습니다.',
        true,
        now,
      );
      next = beginCall(next, 'majima', 'incoming', 'quest');
      return {
        ...next,
        call: next.call
          ? {
              ...next.call,
              lines: [
                '오, 이제 좀 말이 통하네!',
                '아직 도착한 건 아니제? 볼일 끝내고 연락해라.',
                '기다린 만큼 제대로 상대해 줘야 한다, 키류쨩.',
              ],
            }
          : null,
      };
    }
    case 'start-call':
      return isContact(action.id) ? beginCall(state, action.id, 'outgoing', 'user') : state;
    case 'answer-call':
      return state.call?.phase === 'ringing' && state.call.direction === 'incoming'
        ? {
            ...state,
            callStatus: 'answered',
            missedCallRead: true,
            call: { ...state.call, phase: 'connected', elapsedMs: 0 },
          }
        : state;
    case 'miss-call':
      return state.call?.phase === 'ringing'
        ? finishCall(state, action.reason ?? 'declined', now)
        : state;
    case 'end-call':
      return state.call
        ? finishCall(state, state.call.phase === 'connected' ? 'completed' : 'declined', now)
        : state;
    case 'read-call':
      return state.missedCall && (!state.missedCallRead || state.callLog.some((item) => !item.read))
        ? {
            ...state,
            missedCallRead: true,
            callLog: state.callLog.map((item) => ({ ...item, read: true })),
          }
        : state;
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
function nonnegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
export function validDay(value: unknown): value is DayState {
  if (!record(value) || !record(value.ingredients) || !record(value.reminders)) return false;
  if (
    Object.keys(value.ingredients).length !== ingredients.length ||
    !ingredients.every(
      ({ id }) => typeof (value.ingredients as Record<string, unknown>)[id] === 'boolean',
    ) ||
    Object.keys(value.reminders).length !== reminders.length - 1 ||
    !reminders
      .filter((item) => item.id !== 'shopping')
      .every(({ id }) => typeof (value.reminders as Record<string, unknown>)[id] === 'boolean')
  )
    return false;
  if (
    !contactsArray(value.readThreads) ||
    !contactsArray(value.replies) ||
    !contactsArray(value.legacyReplies) ||
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
    (value.missedCallRead && !value.missedCall) ||
    !value.replies.every(
      (id) =>
        (value.readThreads as ContactId[]).includes(id) ||
        (record(value.storyMessages) &&
          Array.isArray(value.storyMessages[id]) &&
          value.storyMessages[id].length > 0),
    ) ||
    !value.aiReplies.every((id) => (value.replies as ContactId[]).includes(id))
  )
    return false;
  if (
    !validPhoneEventLog(value.phoneEvents) ||
    !record(value.storyMessages) ||
    !record(value.storyChoiceHistory) ||
    !record(value.storyPending) ||
    Object.keys(value.storyMessages).length !== contactIds.length ||
    Object.keys(value.storyChoiceHistory).length !== contactIds.length
  )
    return false;
  for (const id of contactIds) {
    const rows = value.storyMessages[id];
    const chosen = value.storyChoiceHistory[id];
    const pending = value.storyPending[id];
    if (
      !Array.isArray(rows) ||
      rows.length > 200 ||
      !rows.every(
        (row) =>
          record(row) &&
          typeof row.id === 'string' &&
          typeof row.text === 'string' &&
          row.text.length <= 2000 &&
          typeof row.outgoing === 'boolean' &&
          typeof row.time === 'string' &&
          nonnegative(row.sequence) &&
          (row.createdAt === undefined || nonnegative(row.createdAt)),
      )
    )
      return false;
    const allowed = storyRounds[id].flat().map((item) => item.id);
    if (
      !Array.isArray(chosen) ||
      chosen.length > storyRounds[id].length ||
      new Set(chosen).size !== chosen.length ||
      !chosen.every((choice) => allowed.includes(choice))
    )
      return false;
    if (
      pending !== undefined &&
      (!record(pending) ||
        typeof pending.choiceId !== 'string' ||
        !chosen.includes(pending.choiceId) ||
        !nonnegative(pending.deliverAt))
    )
      return false;
  }
  if (
    Object.keys(value.storyPending).some((id) => !isContact(id)) ||
    !Array.isArray(value.completedQuests) ||
    new Set(value.completedQuests).size !== value.completedQuests.length ||
    !value.completedQuests.every((id) => reminders.some((item) => item.id === id))
  )
    return false;
  if (
    typeof value.kamurochoNotified !== 'boolean' ||
    !nonnegative(value.storySequence) ||
    !nonnegative(value.elapsedMs) ||
    !Number.isInteger(value.affinity) ||
    Number(value.affinity) < -5 ||
    Number(value.affinity) > 5 ||
    !nonnegative(value.callSerial) ||
    !nonnegative(value.scheduledCalls) ||
    !nonnegative(value.nextMajimaTextInMs) ||
    value.nextMajimaTextInMs > 180_000 ||
    !nonnegative(value.majimaCheckInsSent) ||
    value.majimaCheckInsSent > majimaCheckIns.length ||
    !nonnegative(value.nextCallInMs) ||
    value.nextCallInMs > 360_000
  )
    return false;
  if (
    value.call !== null &&
    (!record(value.call) ||
      typeof value.call.id !== 'string' ||
      typeof value.call.caller !== 'string' ||
      !isContact(value.call.caller) ||
      !['incoming', 'outgoing'].includes(String(value.call.direction)) ||
      !['ringing', 'connected'].includes(String(value.call.phase)) ||
      !nonnegative(value.call.elapsedMs) ||
      !['quest', 'scheduled', 'user'].includes(String(value.call.source)) ||
      !Array.isArray(value.call.lines) ||
      value.call.lines.length < 1 ||
      value.call.lines.length > 10 ||
      !value.call.lines.every((line) => typeof line === 'string' && line.length < 1000))
  )
    return false;
  if (
    !Array.isArray(value.callLog) ||
    value.callLog.length > 40 ||
    !value.callLog.every(
      (row) =>
        record(row) &&
        typeof row.id === 'string' &&
        typeof row.caller === 'string' &&
        isContact(row.caller) &&
        ['incoming', 'outgoing'].includes(String(row.direction)) &&
        ['missed', 'declined', 'completed'].includes(String(row.result)) &&
        typeof row.time === 'string' &&
        typeof row.read === 'boolean',
    )
  )
    return false;
  return (
    !ingredients.every(({ id }) => (value.ingredients as Record<string, unknown>)[id]) ||
    value.missedCall
  );
}
export function loadDay(
  storage: Pick<Storage, 'getItem'>,
  now?: number,
): {
  state: DayState;
  unavailable: boolean;
} {
  try {
    const raw = storage.getItem(DAY_STORAGE_KEY);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (record(value)) {
        if (!('callStatus' in value)) value.callStatus = value.missedCall ? 'missed' : null;
        if (!('aiReplies' in value)) value.aiReplies = [];
        for (const key of ['readThreads', 'replies', 'aiReplies'])
          if (Array.isArray(value[key])) value[key] = value[key].filter((id) => id !== 'nishiki');
        if (
          record(value.reminders) &&
          !('uniform' in value.reminders) &&
          !('parcel' in value.reminders)
        )
          value.reminders = { ...value.reminders, uniform: false, parcel: false };
        if (!('legacyReplies' in value))
          value.legacyReplies =
            !('storyChoiceHistory' in value) && Array.isArray(value.replies)
              ? [...value.replies]
              : [];
        const defaults = initialDay();
        if (!('completedQuests' in value) && record(value.reminders))
          value.completedQuests = reminders
            .filter(({ id }) =>
              id === 'shopping'
                ? value.missedCall
                : (value.reminders as Record<string, unknown>)[id] === true,
            )
            .map(({ id }) => id);
        for (const key of [
          'storyMessages',
          'phoneEvents',
          'storyChoiceHistory',
          'storyPending',
          'completedQuests',
          'kamurochoNotified',
          'storySequence',
          'elapsedMs',
          'affinity',
          'call',
          'callLog',
          'callSerial',
          'scheduledCalls',
          'nextCallInMs',
          'nextMajimaTextInMs',
          'majimaCheckInsSent',
        ] as const)
          if (!(key in value)) value[key] = defaults[key];
        // Legacy story rows have only a display clock, not an event date. Preserve their
        // order without inventing createdAt or turning old arrivals into new notifications.
        if (validDay(value)) {
          // A reload never restarts a ringing/connected call or immediately rings again.
          const saved = value.call
            ? finishCall(value, value.call.phase === 'connected' ? 'completed' : 'missed', now)
            : value;
          return {
            state: {
              ...saved,
              call: null,
              callStatus: saved.callStatus === 'ringing' ? 'missed' : saved.callStatus,
              nextCallInMs: Math.max(45_000, saved.nextCallInMs),
              nextMajimaTextInMs: Math.max(45_000, saved.nextMajimaTextInMs),
            },
            unavailable: false,
          };
        }
      }
    }
    return { state: initialDay(), unavailable: false };
  } catch {
    return { state: initialDay(), unavailable: true };
  }
}
