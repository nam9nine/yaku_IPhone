import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { reviewDataset } from './lib/yakuza-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string', default: path.join(root, 'references/local/yakuza-corpus') },
    'input-run': { type: 'string' },
    seed: { type: 'string', default: 'yakuza-review-v1' },
    'samples-per-stratum': { type: 'string', default: '3' },
  },
});
const digest = createHash('sha256');
for (const filename of [
  'scripts/review-yakuza.mjs',
  'scripts/lib/yakuza-review.mjs',
  'scripts/lib/yakuza-pipeline.mjs',
  'scripts/lib/yakuza-download.mjs',
  'scripts/lib/yakuza-normalize.mjs',
])
  digest.update(filename).update(await readFile(path.join(root, filename)));
const result = await reviewDataset({
  dataDir: path.resolve(values['data-dir']),
  inputRunId: values['input-run'],
  codeFingerprint: digest.digest('hex'),
  seed: values.seed,
  samplesPerStratum: Number(values['samples-per-stratum']),
});
console.log(
  JSON.stringify(
    {
      directory: result.directory,
      counts: result.report.counts,
      lanes: result.report.lanes,
      reproduced: result.reproduced,
      trainingReady: false,
    },
    null,
    2,
  ),
);
