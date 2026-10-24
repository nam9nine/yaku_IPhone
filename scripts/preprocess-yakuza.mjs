import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { preprocessDataset } from './lib/yakuza-pipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string', default: path.join(root, 'references/local/yakuza-corpus') },
  },
});
const manifest = JSON.parse(
  await readFile(path.join(root, 'references/yakuza-dataset.json'), 'utf8'),
);
const { characters } = JSON.parse(
  await readFile(path.join(root, 'references/yakuza-characters.json'), 'utf8'),
);
const digest = createHash('sha256');
for (const file of [
  'scripts/preprocess-yakuza.mjs',
  'scripts/lib/yakuza-pipeline.mjs',
  'scripts/lib/yakuza-normalize.mjs',
  'scripts/lib/yakuza-download.mjs',
]) {
  digest.update(file).update(await readFile(path.join(root, file)));
}
const result = await preprocessDataset(manifest, {
  dataDir: path.resolve(values['data-dir']),
  characters,
  codeFingerprint: digest.digest('hex'),
  onProgress: (file) =>
    console.log(
      `${file.id}: ${file.input} records; ${file.routes.dialogue_review ?? 0} dialogue candidates; training eligible: 0`,
    ),
});
console.log(
  JSON.stringify(
    {
      directory: result.directory,
      counts: result.report.counts,
      reproduced: result.reproduced,
      trainingReady: false,
    },
    null,
    2,
  ),
);
