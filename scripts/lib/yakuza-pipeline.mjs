import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { compose, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { normalizeRecord } from './yakuza-normalize.mjs';
import { validateManifest, verifyFile } from './yakuza-download.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const increment = (object, key) => {
  Object.defineProperty(object, key, {
    value: (Object.hasOwn(object, key) ? object[key] : 0) + 1,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};
const json = (value) => `${JSON.stringify(value)}\n`;

export async function* readJsonlGzip(filename) {
  const input = compose(createReadStream(filename), createGunzip());
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let lineNumber = 0;
  let bytes = 0;
  try {
    for await (const chunk of input) {
      bytes += chunk.length;
      if (bytes > 4 * 1024 ** 3) throw new Error('Decompressed input exceeds 4 GiB limit.');
      pending += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        lineNumber++;
        if (!line.trim()) throw new Error(`Blank JSONL record: ${lineNumber}`);
        if (line.length > 8 * 1024 ** 2) throw new Error('JSONL record exceeds limit.');
        yield { row: JSON.parse(line), lineNumber, rawRowHash: hash(line) };
      }
      if (pending.length > 8 * 1024 ** 2) throw new Error('JSONL record exceeds limit.');
    }
    pending += decoder.decode();
    if (pending.length) {
      if (!pending.trim()) throw new Error('Blank final JSONL record.');
      yield { row: JSON.parse(pending), lineNumber: ++lineNumber, rawRowHash: hash(pending) };
    }
  } finally {
    input.destroy();
  }
}

class IndexWriter {
  constructor(handle) {
    this.handle = handle;
    this.buffer = '';
    this.closed = false;
  }
  async add(value) {
    this.buffer += json(value);
    if (this.buffer.length > 256 * 1024) await this.flush();
  }
  async flush() {
    if (this.buffer) {
      await this.handle.writeFile(this.buffer);
      this.buffer = '';
    }
  }
  async close() {
    if (this.closed) return;
    try {
      await this.flush();
    } finally {
      this.closed = true;
      await this.handle.close();
    }
  }
}

export function routeRecord(record, exactDuplicate) {
  if (exactDuplicate) return 'exact_source_duplicate';
  if (!record.korean.clean.trim()) return 'no_korean';
  if (record.korean.warnings.length || !/[\p{Script=Hangul}]/u.test(record.korean.clean))
    return 'quality_review';
  if (['dialogue_candidate', 'mail_candidate'].includes(record.classification.kind))
    return 'dialogue_review';
  return 'other_review';
}

async function outputHashes(directory) {
  const results = {};
  for (const name of (await readdir(directory)).sort()) {
    if (name === 'checksums.json') continue;
    const filename = path.join(directory, name);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(filename)) digest.update(chunk);
    results[name] = { bytes: (await stat(filename)).size, sha256: digest.digest('hex') };
  }
  return results;
}

export async function preprocessDataset(
  manifest,
  { dataDir, characters = [], codeFingerprint = 'development', onProgress = () => {} },
) {
  validateManifest(manifest);
  const configuration = { schemaVersion: 1, manifest, characters, codeFingerprint };
  const runId = hash(JSON.stringify(configuration)).slice(0, 24);
  const parent = path.join(dataDir, 'processed');
  await mkdir(parent, { recursive: true });
  const lockPath = path.join(parent, '.process.lock');
  const lock = await open(lockPath, 'wx');
  const temporary = await mkdtemp(path.join(parent, `.${runId}-`));
  const finalDir = path.join(parent, runId);
  const writers = {};
  try {
    for (const name of [
      'dialogue-candidates',
      'quarantine',
      'mentions',
      'names',
      'scenes',
      'review-samples',
    ]) {
      writers[name] = new IndexWriter(await open(path.join(temporary, `${name}.jsonl`), 'wx'));
    }
    const report = {
      schemaVersion: 1,
      runId,
      dataset: manifest.dataset,
      revision: manifest.revision,
      codeFingerprint,
      trainingReady: false,
      allCharactersRetained: true,
      annotationStatus: 'speaker, recipient and dialogue order unverified; no SFT export',
      samplePolicy:
        'deterministic first examples per category and seeded-name mention; not a random corpus quality estimate',
      counts: { input: 0, normalized: 0, trainingEligible: 0 },
      files: [],
    };
    for (const file of manifest.files) {
      const filename = path.join(dataDir, 'raw', path.basename(file.path));
      await verifyFile(filename, file);
      const stats = {
        id: file.id,
        input: 0,
        normalized: 0,
        languages: {},
        classifications: {},
        routes: {},
        warnings: {},
        changes: {},
        mentions: {},
        upstreamDuplicateTrue: 0,
        unlocated: 0,
        scenes: 0,
      };
      const seen = new Map();
      const scenes = new Map();
      const sampled = new Map();
      const normalizedName = `${file.id}.normalized.jsonl.gz`;
      async function* records() {
        for await (const { row, lineNumber, rawRowHash } of readJsonlGzip(filename)) {
          const record = normalizeRecord(row, {
            gameId: file.id,
            sourcePath: file.path,
            sourceRevision: manifest.revision,
            lineNumber,
            characters,
          });
          record.source.rawRowHash = rawRowHash;
          // Retain every normalized record. Dedup only marks repeated source+content,
          // never equal dialogue from different scenes or missing source locators.
          const duplicateKey = record.source.rawKey
            ? hash(JSON.stringify([record.source.rawKey, record.languages]))
            : null;
          const duplicateOf = duplicateKey ? (seen.get(duplicateKey) ?? null) : null;
          if (duplicateKey && !duplicateOf) seen.set(duplicateKey, record.id);
          record.duplicate = {
            of: duplicateOf,
            scope: 'same-source-key-and-all-language-texts',
            removed: false,
          };
          record.routing = routeRecord(record, duplicateOf !== null);
          if (record.korean.clean.trim() && !/[\p{Script=Hangul}]/u.test(record.korean.clean))
            record.review.holdReasons.push('korean_language_review');
          const pointer = {
            id: record.id,
            gameId: file.id,
            normalizedFile: normalizedName,
            lineNumber,
            rawRowHash,
            sceneGroup: record.sceneGroup,
            kind: record.classification.kind,
            routing: record.routing,
            trainingEligible: false,
          };
          stats.input++;
          stats.normalized++;
          for (const [language, text] of Object.entries(record.languages))
            if (text.trim()) increment(stats.languages, language);
          increment(stats.classifications, record.classification.kind);
          increment(stats.routes, record.routing);
          for (const warning of record.korean.warnings) increment(stats.warnings, warning);
          for (const change of record.korean.changes) increment(stats.changes, change);
          if (row['是否重复'] === true) stats.upstreamDuplicateTrue++;
          if (!record.locator.sceneCandidate) stats.unlocated++;
          else {
            const group = record.sceneGroup;
            if (!scenes.has(group))
              scenes.set(group, {
                sceneGroup: group,
                container: record.locator.container,
                candidatePath: record.locator.sceneCandidate,
                records: 0,
                koreanRecords: 0,
                kinds: {},
                mentions: {},
                firstSourceLine: lineNumber,
                orderStatus: 'unverified',
              });
            const scene = scenes.get(group);
            scene.records++;
            if (record.korean.clean.trim()) scene.koreanRecords++;
            increment(scene.kinds, record.classification.kind);
            for (const mention of record.mentionedCharacters) increment(scene.mentions, mention.id);
          }
          if (record.routing === 'dialogue_review')
            await writers['dialogue-candidates'].add(pointer);
          if (['quality_review', 'no_korean'].includes(record.routing))
            await writers.quarantine.add({ ...pointer, reasons: record.review.holdReasons });
          if (record.classification.kind === 'name_candidate')
            await writers.names.add({
              ...pointer,
              languages: record.languages,
              status: 'name-candidate-not-a-confirmed-character',
            });
          if (record.mentionedCharacters.length) {
            await writers.mentions.add({
              ...pointer,
              mentions: record.mentionedCharacters,
              speaker: null,
              recipient: null,
              status: 'mention-only-not-speaker-or-relationship',
            });
            for (const mention of record.mentionedCharacters) increment(stats.mentions, mention.id);
          }
          const sampleKeys = [
            `kind:${record.classification.kind}`,
            `route:${record.routing}`,
            ...record.korean.warnings.map((w) => `warning:${w}`),
            ...record.mentionedCharacters.map((m) => `mention:${m.id}`),
          ];
          const take = sampleKeys.filter((key) => (sampled.get(key) ?? 0) < 3);
          if (take.length) {
            for (const key of take) sampled.set(key, (sampled.get(key) ?? 0) + 1);
            await writers['review-samples'].add({ sampleReasons: take, ...record });
          }
          yield json(record);
        }
      }
      await pipeline(
        Readable.from(records()),
        createGzip(),
        createWriteStream(path.join(temporary, normalizedName), { flags: 'wx' }),
      );
      for (const scene of [...scenes.values()].sort((a, b) =>
        a.sceneGroup.localeCompare(b.sceneGroup, 'en'),
      ))
        await writers.scenes.add({ gameId: file.id, ...scene });
      stats.scenes = scenes.size;
      if (
        stats.input !== stats.normalized ||
        Object.values(stats.routes).reduce((a, b) => a + b, 0) !== stats.input
      )
        throw new Error(`Row conservation failed: ${file.id}`);
      report.files.push(stats);
      report.counts.input += stats.input;
      report.counts.normalized += stats.normalized;
      onProgress(stats);
    }
    for (const writer of Object.values(writers)) await writer.close();
    await writeFile(
      path.join(temporary, 'configuration.json'),
      `${JSON.stringify(configuration, null, 2)}\n`,
    );
    await writeFile(path.join(temporary, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const checksums = await outputHashes(temporary);
    await writeFile(
      path.join(temporary, 'checksums.json'),
      `${JSON.stringify(checksums, null, 2)}\n`,
    );
    const exists = await stat(finalDir).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (exists) {
      const saved = JSON.parse(await readFile(path.join(finalDir, 'checksums.json'), 'utf8'));
      if (
        JSON.stringify(saved) !== JSON.stringify(checksums) ||
        JSON.stringify(await outputHashes(finalDir)) !== JSON.stringify(checksums)
      )
        throw new Error('Existing run differs; preserved it for investigation.');
      await rm(temporary, { recursive: true });
    } else await rename(temporary, finalDir);
    const pointer = { runId, relativePath: `processed/${runId}`, trainingReady: false };
    await writeFile(path.join(dataDir, 'latest.json.tmp'), `${JSON.stringify(pointer, null, 2)}\n`);
    await rename(path.join(dataDir, 'latest.json.tmp'), path.join(dataDir, 'latest.json'));
    return { report, directory: finalDir, reproduced: exists };
  } catch (error) {
    for (const writer of Object.values(writers)) await writer.close().catch(() => {});
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
