import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fetchDataset } from './lib/yakuza-download.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string', default: path.join(root, 'references/local/yakuza-corpus') },
    manifest: { type: 'string', default: path.join(root, 'references/yakuza-dataset.json') },
  },
});
const manifest = JSON.parse(await readFile(values.manifest, 'utf8'));
const dataDir = path.resolve(values['data-dir']);
const files = await fetchDataset(manifest, {
  dataDir,
  onProgress: (item) => console.log(`${item.id}: ${item.status} (${item.bytes} bytes)`),
});
const receipt = { schemaVersion: 1, dataset: manifest.dataset, revision: manifest.revision, files };
const receiptPath = path.join(dataDir, 'download-receipt.json');
await writeFile(`${receiptPath}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`);
await rename(`${receiptPath}.tmp`, receiptPath);
console.log(`Verified ${files.length} archives. Local data: ${dataDir}`);
