#!/usr/bin/env node
import { validateHarness } from './lib/harness.mjs';

const result = validateHarness(process.cwd());
if (result.valid) {
  console.log('Harness structure and reference manifest passed.');
} else {
  console.error(`Harness check failed:\n${result.errors.join('\n')}`);
  process.exitCode = 1;
}
