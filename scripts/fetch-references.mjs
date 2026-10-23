#!/usr/bin/env node
/** Fetch reviewed references only. No packages, hooks, or upstream code are run. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2));
const allowedFlags = new Set(['--verify-only', '--extract', '--help']);
const maxDownloadBytes = 512 * 1024 * 1024;
const maxExpandedBytes = 1024 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasControlCharacters(value) {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}

function safePath(value) {
  assert(typeof value === 'string' && value.length > 0, 'Missing local path');
  assert(
    !isAbsolute(value) && !value.includes('\\') && !hasControlCharacters(value),
    `Unsafe path: ${value}`,
  );
  const parts = value.split('/');
  assert(
    parts.every((part) => part && part !== '.' && part !== '..'),
    `Unsafe path: ${value}`,
  );
  assert(
    value.startsWith('references/upstream/') || value.startsWith('references/licenses/'),
    `Path outside reference storage: ${value}`,
  );
  const full = resolve(root, ...parts);
  assert(!relative(root, full).startsWith(`..${sep}`), `Path escapes project: ${value}`);
  return full;
}

async function ensurePlainParents(full, create = false) {
  const parts = relative(root, dirname(full)).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    if (create)
      await mkdir(current).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (!create && error.code === 'ENOENT') return;
      throw error;
    }
    assert(stat.isDirectory() && !stat.isSymbolicLink(), `Unsafe parent directory: ${current}`);
  }
}

async function digestFile(full) {
  await ensurePlainParents(full);
  let stat;
  try {
    stat = await lstat(full);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), `Expected regular file: ${full}`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(full)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

function checkDigest(actual, expected, label) {
  assert(
    actual && actual.sha256 === expected.sha256 && actual.bytes === expected.bytes,
    `Integrity mismatch: ${label}. Existing files and recorded hashes are never overwritten automatically.`,
  );
}

function validateManifest(manifest) {
  assert(
    manifest.schemaVersion === 1 && Array.isArray(manifest.sources),
    'Unsupported reference manifest',
  );
  const ids = new Set();
  const destinations = new Set();
  for (const source of manifest.sources) {
    assert(
      /^[a-z0-9-]+$/.test(source.id) && !ids.has(source.id),
      `Invalid or duplicate source ID: ${source.id}`,
    );
    ids.add(source.id);
    assert(new URL(source.sourceUrl).protocol === 'https:', `HTTPS source required: ${source.id}`);
    assert(
      Array.isArray(source.artifacts) && source.artifacts.length > 0,
      `Missing artifacts: ${source.id}`,
    );
    if (source.type === 'repository') {
      assert(/^[0-9a-f]{40}$/.test(source.commitSha), `Full commit SHA required: ${source.id}`);
      safePath(source.localExtractedPath);
    }
    for (const artifact of source.artifacts) {
      const url = new URL(artifact.url);
      assert(
        url.protocol === 'https:' && !url.username && !url.password,
        `Invalid artifact URL: ${source.id}`,
      );
      safePath(artifact.localPath);
      assert(
        !destinations.has(artifact.localPath),
        `Duplicate artifact path: ${artifact.localPath}`,
      );
      destinations.add(artifact.localPath);
      assert(/^[0-9a-f]{64}$/.test(artifact.sha256), `Missing SHA-256: ${artifact.localPath}`);
      assert(
        Number.isSafeInteger(artifact.bytes) &&
          artifact.bytes > 0 &&
          artifact.bytes <= maxDownloadBytes,
        `Invalid file size: ${artifact.localPath}`,
      );
      if (artifact.role === 'archive') {
        assert(artifact.url.includes(source.commitSha), `Unpinned archive: ${source.id}`);
        assert(
          /^[a-zA-Z0-9_.-]+$/.test(artifact.archiveRoot),
          `Missing safe archive root: ${source.id}`,
        );
      }
    }
  }
}

async function fetchArtifact(source, artifact) {
  const destination = safePath(artifact.localPath);
  const existing = await digestFile(destination);
  if (existing) {
    checkDigest(existing, artifact, artifact.localPath);
    return 'verified';
  }
  assert(
    !flags.has('--verify-only'),
    `Missing local artifact: ${artifact.localPath}. Run without --verify-only to fetch it.`,
  );
  await ensurePlainParents(destination, true);
  const temporary = `${destination}.partial-${randomUUID()}`;
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const response = await fetch(artifact.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(240_000),
      headers: { 'User-Agent': 'yaku-iPhone-reference-archiver/1.0' },
    });
    assert(response.ok && response.body, `Download failed (${response.status}): ${artifact.url}`);
    assert(new URL(response.url).protocol === 'https:', 'Refusing a redirect to non-HTTPS');
    const verify = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > artifact.bytes || bytes > maxDownloadBytes)
          return callback(new Error(`Download exceeds recorded size: ${source.id}`));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      verify,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    checkDigest({ sha256: hash.digest('hex'), bytes }, artifact, artifact.localPath);
    await rename(temporary, destination);
    return 'downloaded';
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function tarText(buffer) {
  return buffer.toString('utf8').replace(/\0.*$/s, '');
}
function tarNumber(buffer) {
  const value = tarText(buffer).trim();
  assert(/^[0-7]*$/.test(value), 'Unsupported tar numeric encoding');
  return Number.parseInt(value || '0', 8);
}
function paxFields(buffer) {
  const fields = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(32, offset);
    assert(space > offset, 'Malformed PAX record');
    const length = Number(buffer.subarray(offset, space).toString('ascii'));
    assert(
      Number.isSafeInteger(length) &&
        length > space - offset + 1 &&
        offset + length <= buffer.length,
      'Malformed PAX length',
    );
    const record = buffer.subarray(space + 1, offset + length).toString('utf8');
    assert(record.endsWith('\n') && record.includes('='), 'Malformed PAX value');
    const equals = record.indexOf('=');
    fields[record.slice(0, equals)] = record.slice(equals + 1, -1);
    offset += length;
  }
  return fields;
}

function archiveMembers(buffer, expectedRoot) {
  const entries = [];
  let nextPax = {};
  let globalPax = {};
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return entries;
    let checksum = 0;
    for (let index = 0; index < 512; index++)
      checksum += index >= 148 && index < 156 ? 32 : header[index];
    assert(checksum === tarNumber(header.subarray(148, 156)), 'Invalid tar header checksum');
    const size = tarNumber(header.subarray(124, 136));
    assert(
      Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= buffer.length,
      'Truncated tar entry',
    );
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'g') {
      globalPax = { ...globalPax, ...paxFields(data) };
      continue;
    }
    if (type === 'x') {
      nextPax = paxFields(data);
      continue;
    }
    assert(
      type === '0' || type === '5',
      `Refusing tar links, special files, or unsupported entry type: ${type}`,
    );
    const fields = { ...globalPax, ...nextPax };
    nextPax = {};
    const prefix = tarText(header.subarray(345, 500));
    const name = tarText(header.subarray(0, 100));
    const path = (fields.path || (prefix ? `${prefix}/${name}` : name)).replace(/\/$/, '');
    assert(!path.includes('\\') && !hasControlCharacters(path), `Unsafe archive member: ${path}`);
    const parts = path.split('/');
    assert(
      parts.every((part) => part && part !== '.' && part !== '..') && parts[0] === expectedRoot,
      `Archive path escapes pinned root: ${path}`,
    );
    if (fields.size !== undefined)
      assert(Number(fields.size) === size, 'Unsupported PAX size override');
    if (parts.length === 1) {
      assert(type === '5', 'Expected archive root directory');
      continue;
    }
    entries.push({ path: parts.slice(1).join('/'), directory: type === '5', data });
  }
  throw new Error('Tar archive is missing its end marker');
}

async function extractArchive(source, artifact) {
  const compressed = await readFile(safePath(artifact.localPath));
  checkDigest(
    { sha256: createHash('sha256').update(compressed).digest('hex'), bytes: compressed.length },
    artifact,
    source.id,
  );
  const entries = archiveMembers(
    gunzipSync(compressed, { maxOutputLength: maxExpandedBytes }),
    artifact.archiveRoot,
  );
  const files = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.path));
  for (const keyPath of source.keyPaths)
    assert(files.has(keyPath), `Missing upstream key path: ${source.id}/${keyPath}`);
  let fileCount = 0;
  for (const entry of entries) {
    const destination = safePath(`${source.localExtractedPath}/${entry.path}`);
    await ensurePlainParents(destination, true);
    if (entry.directory) {
      await mkdir(destination).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const stat = await lstat(destination);
      assert(
        stat.isDirectory() && !stat.isSymbolicLink(),
        `Unsafe extraction directory: ${destination}`,
      );
      continue;
    }
    const expected = {
      sha256: createHash('sha256').update(entry.data).digest('hex'),
      bytes: entry.data.length,
    };
    const existing = await digestFile(destination);
    if (existing) checkDigest(existing, expected, destination);
    else await writeFile(destination, entry.data, { flag: 'wx', mode: 0o644 });
    fileCount++;
  }
  return fileCount;
}

async function main() {
  for (const flag of flags) assert(allowedFlags.has(flag), `Unknown option: ${flag}`);
  if (flags.has('--help')) {
    console.log(
      'Usage: node scripts/fetch-references.mjs [--verify-only | --extract]\nDefault: verify existing artifacts and fetch missing artifacts.\n--verify-only: offline, read-only integrity check.\n--extract: also safely expand pinned archives into ignored upstream source folders.\nNo dependencies, install scripts, or upstream code are executed.',
    );
    return;
  }
  assert(
    !(flags.has('--verify-only') && flags.has('--extract')),
    '--verify-only cannot be combined with --extract',
  );
  const manifest = JSON.parse(await readFile(resolve(root, 'references/manifest.json'), 'utf8'));
  validateManifest(manifest);
  let count = 0;
  let downloaded = 0;
  let extractedFiles = 0;
  for (const source of manifest.sources) {
    for (const artifact of source.artifacts) {
      const result = await fetchArtifact(source, artifact);
      count++;
      if (result === 'downloaded') downloaded++;
      console.log(`${result}: ${artifact.localPath}`);
      if (flags.has('--extract') && artifact.role === 'archive')
        extractedFiles += await extractArchive(source, artifact);
    }
  }
  console.log(
    `References: ${manifest.sources.length} sources, ${count} artifacts verified, ${downloaded} downloaded${flags.has('--extract') ? `, ${extractedFiles} extracted source files verified` : ''}.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
