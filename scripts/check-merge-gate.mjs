#!/usr/bin/env node
import { validateMergeResults } from './lib/merge-gate.mjs';

try {
  const flag = process.argv.indexOf('--results');
  const raw = flag >= 0 ? process.argv[flag + 1] : process.env.HARNESS_JOB_RESULTS;
  if (!raw)
    throw new Error(
      'Supply HARNESS_JOB_RESULTS or --results with quality/browser/evidence job results.',
    );
  const result = validateMergeResults(JSON.parse(raw));
  if (!result.valid) throw new Error(result.errors.join('\n'));
  console.log('Merge gate passed: quality, browser, and evidence all succeeded.');
} catch (error) {
  console.error(`Merge gate failed: ${error.message}`);
  process.exitCode = 1;
}
