import { describe, expect, it } from 'vitest';
import { ingredients } from './content';
import {
  DAY_STORAGE_KEY,
  dayReducer,
  initialDay,
  loadDay,
  remainingReminders,
  shoppingComplete,
  validDay,
} from './state';

function completeShopping() {
  return ingredients.reduce(
    (state, item) => dayReducer(state, { type: 'ingredient', id: item.id, done: true }),
    initialDay(),
  );
}

describe('나팔꽃의 공유된 하루', () => {
  it('starts with four needed ingredients and three unfinished reminders', () => {
    const state = initialDay();
    expect(shoppingComplete(state)).toBe(false);
    expect(remainingReminders(state)).toBe(3);
    expect(state.missedCall).toBe(false);
  });
  it('only the fourth ingredient completes shopping, changes the count and triggers one missed call', () => {
    let state = initialDay();
    for (const item of ingredients.slice(0, 3))
      state = dayReducer(state, { type: 'ingredient', id: item.id, done: true });
    expect(remainingReminders(state)).toBe(3);
    expect(state.missedCall).toBe(false);
    state = dayReducer(state, { type: 'ingredient', id: 'curry', done: true });
    expect(shoppingComplete(state)).toBe(true);
    expect(remainingReminders(state)).toBe(2);
    expect(state.missedCall).toBe(true);
    expect(dayReducer(state, { type: 'ingredient', id: 'curry', done: true })).toBe(state);
  });
  it('never sends the early Haruka reply or an unknown conversation', () => {
    const state = initialDay();
    expect(dayReducer(state, { type: 'reply', id: 'haruka' })).toBe(state);
    expect(dayReducer(state, { type: 'reply', id: 'stranger' })).toBe(state);
  });
  it('stores the outgoing reply and authored response as one event that cannot replay', () => {
    const state = dayReducer(completeShopping(), { type: 'reply', id: 'haruka' });
    expect(state.replySent).toBe(true);
    expect(state.replies).toEqual(['haruka']);
    expect(state.readThreads).toContain('haruka');
    expect(dayReducer(state, { type: 'reply', id: 'haruka' })).toBe(state);
    expect(validDay(state)).toBe(true);
  });
  it('keeps history when ingredients are unchecked without repeating the phone event', () => {
    let state = dayReducer(completeShopping(), { type: 'reply', id: 'haruka' });
    state = dayReducer(state, { type: 'read-call' });
    state = dayReducer(state, { type: 'ingredient', id: 'potato', done: false });
    expect(remainingReminders(state)).toBe(3);
    expect(state.replySent).toBe(true);
    expect(state.missedCallRead).toBe(true);
    expect(validDay(state)).toBe(true);
    state = dayReducer(state, { type: 'ingredient', id: 'potato', done: true });
    expect(state.missedCallRead).toBe(true);
    expect(state.replies).toHaveLength(1);
  });
  it('changing the shopping reminder changes all four checklist items in the same transaction', () => {
    const done = dayReducer(initialDay(), { type: 'reminder', id: 'shopping', done: true });
    expect(shoppingComplete(done)).toBe(true);
    expect(done.missedCall).toBe(true);
    const undone = dayReducer(done, { type: 'reminder', id: 'shopping', done: false });
    expect(Object.values(undone.ingredients)).toEqual([false, false, false, false]);
    expect(remainingReminders(undone)).toBe(3);
    expect(undone.missedCall).toBe(true);
  });
  it('garden and Mame reminders share the same total without completing shopping', () => {
    const state = dayReducer(
      dayReducer(initialDay(), { type: 'reminder', id: 'garden', done: true }),
      { type: 'reminder', id: 'mame', done: true },
    );
    expect(remainingReminders(state)).toBe(1);
    expect(shoppingComplete(state)).toBe(false);
    expect(state.missedCall).toBe(false);
    expect(
      remainingReminders(dayReducer(state, { type: 'reminder', id: 'shopping', done: true })),
    ).toBe(0);
  });
  it('reading a thread is idempotent and cannot record an unknown contact', () => {
    const state = dayReducer(initialDay(), { type: 'read-thread', id: 'haruka' });
    expect(state.readThreads).toEqual(['haruka']);
    expect(dayReducer(state, { type: 'read-thread', id: 'haruka' })).toBe(state);
    expect(dayReducer(state, { type: 'read-thread', id: 'stranger' })).toBe(state);
  });
  it('offers other contact replies once without advancing the curry event', () => {
    const state = dayReducer(initialDay(), { type: 'reply', id: 'majima' });
    expect(state.replies).toEqual(['majima']);
    expect(state.replySent).toBe(false);
    expect(state.missedCall).toBe(false);
    expect(validDay(state)).toBe(true);
    expect(dayReducer(state, { type: 'reply', id: 'majima' })).toBe(state);
  });
  it('cannot mark a phone event read before it exists', () => {
    const state = initialDay();
    expect(dayReducer(state, { type: 'read-call' })).toBe(state);
  });
  it('reset creates fresh nested state and clears all story progression', () => {
    const old = dayReducer(completeShopping(), { type: 'reply', id: 'haruka' });
    const next = dayReducer(old, { type: 'reset' });
    expect(next).toEqual(initialDay());
    expect(next.ingredients).not.toBe(old.ingredients);
  });
});

describe('저장된 하루 검증', () => {
  it.each([
    null,
    [],
    {},
    { ...initialDay(), ingredients: { potato: 'yes', onion: false, meat: false, curry: false } },
    { ...initialDay(), reminders: { shopping: true, garden: false, mame: false } },
    { ...initialDay(), readThreads: ['haruka', 'haruka'] },
    { ...initialDay(), readThreads: ['stranger'] },
    { ...initialDay(), replySent: true },
    { ...initialDay(), replies: ['haruka'], replySent: true, readThreads: ['haruka'] },
    { ...initialDay(), replies: ['majima'] },
    { ...initialDay(), missedCallRead: true },
    { ...completeShopping(), missedCall: false },
  ])('rejects corrupt or contradictory saved values (%#)', (value) => {
    expect(validDay(value)).toBe(false);
  });
  it('roundtrips a fully completed and read story', () => {
    const state = dayReducer(dayReducer(completeShopping(), { type: 'reply', id: 'haruka' }), {
      type: 'read-call',
    });
    const loaded = loadDay({
      getItem: (key) => (key === DAY_STORAGE_KEY ? JSON.stringify(state) : null),
    });
    expect(loaded.state).toEqual(state);
    expect(loaded.unavailable).toBe(false);
  });
  it('falls back safely when storage is denied', () => {
    expect(
      loadDay({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toEqual({ state: initialDay(), unavailable: true });
  });
  it('does not apply invalid stored state or malformed JSON', () => {
    expect(loadDay({ getItem: () => '{' }).state).toEqual(initialDay());
    expect(
      loadDay({ getItem: () => JSON.stringify({ ...initialDay(), replySent: true }) }).state,
    ).toEqual(initialDay());
  });
});
