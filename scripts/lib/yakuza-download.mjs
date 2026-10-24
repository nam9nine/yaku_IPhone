import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export function validateManifest(manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.dataset !== 'liwu/MNBVC' ||
    !/^[a-f0-9]{40}$/.test(manifest.revision) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  )
    throw new Error('Invalid pinned dataset manifest.');
  const ids = new Set();
  const paths = new Set();
  for (const file of manifest.files) {
    if (
      !/^[a-z0-9-]+$/.test(file.id) ||
      ids.has(file.id) ||
      paths.has(file.path) ||
      !/^game\/Yakuza\/20230924\/[A-Za-z0-9_]+\.jsonl\.gz$/.test(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      file.bytes > 128 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error(`Invalid dataset file: ${file.id}`);
    ids.add(file.id);
    paths.add(file.path);
  }
  return manifest;
}

export async function verifyFile(filename, expected) {
  const info = await stat(filename);
  if (!info.isFile() || info.size !== expected.bytes) throw new Error(`Size mismatch: ${filename}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  const digest = hash.digest('hex');
  if (digest !== expected.sha256) throw new Error(`SHA-256 mismatch: ${filename}`);
  return { bytes: info.size, sha256: digest };
}

export async function fetchDataset(
  manifest,
  { dataDir, fetchImpl = fetch, onProgress = () => {} },
) {
  validateManifest(manifest);
  const rawDir = path.join(dataDir, 'raw');
  await mkdir(rawDir, { recursive: true });
  const lockPath = path.join(dataDir, '.fetch.lock');
  const lock = await open(lockPath, 'wx');
  const results = [];
  try {
    for (const file of manifest.files) {
      const filename = path.join(rawDir, path.basename(file.path));
      const present = await stat(filename).then(
        () => true,
        (error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
      if (present) {
        results.push({
          id: file.id,
          ...(await verifyFile(filename, file)),
          status: 'verified-cache',
        });
        onProgress(results.at(-1));
        continue;
      }
      const url = `https://huggingface.co/datasets/${manifest.dataset}/resolve/${manifest.revision}/${file.path}`;
      const temp = `${filename}.${process.pid}.part`;
      const handle = await open(temp, 'wx');
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(180_000),
          headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'yaku-iPhone-dataset/1.0' },
        });
        // A proxy-cached partial response is not a complete archive.
        if (response.status !== 200 || !response.body)
          throw new Error(`Download HTTP ${response.status}: ${file.id}`);
        let bytes = 0;
        const hash = createHash('sha256');
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > file.bytes) throw new Error(`Oversize download: ${file.id}`);
          hash.update(chunk);
          await handle.writeFile(chunk);
        }
        if (bytes !== file.bytes || hash.digest('hex') !== file.sha256)
          throw new Error(`Download integrity mismatch: ${file.id}`);
        await handle.sync();
        await handle.close();
        await rename(temp, filename);
        results.push({ id: file.id, bytes, sha256: file.sha256, status: 'downloaded' });
        onProgress(results.at(-1));
      } catch (error) {
        await handle.close().catch(() => {});
        await rm(temp, { force: true });
        throw error;
      }
    }
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
  return results;
}
