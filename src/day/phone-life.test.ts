import { describe, expect, it } from 'vitest';
import { dayReducer, initialDay } from './state';

describe('phone life consequences', () => {
  it('counts one Majima call consequence without changing other relationships', () => {
    let state = dayReducer(initialDay(), { type: 'start-call', id: 'majima' });
    state = dayReducer(state, { type: 'end-call' });
    expect(state.affinity).toBe(-1);
    expect(dayReducer(state, { type: 'end-call' })).toBe(state);
    state = dayReducer(state, { type: 'start-call', id: 'majima' });
    for (let i = 0; i < 15; i++)
      state = dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: true });
    state = dayReducer(state, { type: 'end-call' });
    expect(state.affinity).toBe(0);
    state = dayReducer(state, { type: 'start-call', id: 'date' });
    state = dayReducer(state, { type: 'end-call' });
    expect(state.affinity).toBe(0);
  });
  it('does not rewrite idle locked storage on every second', () => {
    const state = initialDay();
    expect(dayReducer(state, { type: 'tick', elapsedMs: 1000, allowCalls: false })).toBe(state);
  });
});
