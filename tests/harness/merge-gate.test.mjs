import { describe, expect, it } from 'vitest';
import { validateMergeResults } from '../../scripts/lib/merge-gate.mjs';

describe('merge gate', () => {
  it('passes only when every required job succeeds', () => {
    expect(
      validateMergeResults({ quality: 'success', browser: 'success', evidence: 'success' }),
    ).toEqual({ valid: true, errors: [] });
  });

  it.each(['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'pending', undefined])(
    'rejects %s for every required job',
    (state) => {
      for (const job of ['quality', 'browser', 'evidence']) {
        const results = {
          quality: 'success',
          browser: 'success',
          evidence: 'success',
          [job]: state,
        };
        expect(validateMergeResults(results).valid).toBe(false);
        expect(validateMergeResults(results).errors[0]).toContain(job);
      }
    },
  );

  it.each([undefined, null, [], 'success', {}])(
    'fails closed for absent or malformed job results',
    (results) => {
      expect(validateMergeResults(results).valid).toBe(false);
    },
  );
});
