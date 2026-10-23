import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/baselines/{platform}/{projectName}/{arg}{ext}',
  updateSnapshots: 'none',
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixels: 0 } },
});
