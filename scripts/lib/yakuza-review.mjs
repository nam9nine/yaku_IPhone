import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { readJsonlGzip } from './yakuza-pipeline.mjs';
import { validateManifest } from './yakuza-download.mjs';
import { parseSourceKey } from './yakuza-normalize.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value)}\n`;
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digestPattern = /^[a-f0-9]{64}$/;
const runPattern = /^[a-f0-9]{24}$/;
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const object = (map) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b, 'en')));

export function reviewLane(record) {
  const container = record.locator.container;
  const field = record.source.rawKey?.split('@').at(-1) ?? null;
  const reasons = [];
  if (container === 'talk.bin.json' && field === '21') reasons.push('mixed_numeric_field_21');
  let lane;
  if (!record.korean.clean.trim()) lane = 'no_korean';
  else if (
    record.routing === 'quality_review' ||
    record.korean.warnings.length ||
    !/[\p{Script=Hangul}]/u.test(record.korean.clean)
  )
    lane = 'quality_review';
  else if (record.routing === 'exact_source_duplicate') lane = 'source_duplicate_review';
  else if (container === 'pause_mail.bin.json' && field === 'name') lane = 'mail_name_review';
  else if (
    record.routing === 'dialogue_review' &&
    ['dialogue_candidate', 'mail_candidate'].includes(record.classification.kind)
  ) {
    if (record.classification.kind === 'mail_candidate') lane = 'mail_review';
    else if (
      /(?:^|[/_.-])(?:minigame|tutorial|shop)(?:$|[/_.-])/i.test(
        record.locator.sceneCandidate ?? '',
      )
    ) {
      lane = 'gameplay_context_review';
      reasons.push('source_path_gameplay_context_not_confirmed_ui');
    } else lane = 'dialogue_context_review';
  } else if (
    ['ui_text.bin.json', 'ui_texture_text.bin.json'].includes(container) &&
    field === 'text'
  ) {
    lane = 'ui_review';
    reasons.push('explicit_ui_text_source');
  } else if (record.classification.kind === 'name_candidate') lane = 'name_review';
  else if (record.classification.kind === 'ui_candidate') lane = 'ui_review';
  else lane = 'other_review';
  return { lane, reasons, sourceField: field };
}

async function hashes(directory) {
  const result = {};
  for (const name of (await readdir(directory)).sort()) {
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(name)) throw new Error('Unsafe artifact path.');
    const filename = path.join(directory, name);
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Artifact must be a regular file.');
    if (name === 'checksums.json') continue;
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(filename)) digest.update(chunk);
    result[name] = { bytes: info.size, sha256: digest.digest('hex') };
  }
  return result;
}

async function verifiedHashes(directory) {
  const info = await lstat(path.join(directory, 'checksums.json'));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe checksums file.');
  const expected = JSON.parse(await readFile(path.join(directory, 'checksums.json'), 'utf8'));
  if (!expected || Array.isArray(expected) || typeof expected !== 'object')
    throw new Error('Invalid checksums.');
  for (const [name, entry] of Object.entries(expected)) {
    if (
      !/^[a-z0-9][a-z0-9.-]*$/i.test(name) ||
      name === 'checksums.json' ||
      !Number.isSafeInteger(entry?.bytes) ||
      entry.bytes < 0 ||
      !digestPattern.test(entry.sha256)
    ) {
      throw new Error('Invalid checksum entry or path.');
    }
  }
  const actual = await hashes(directory);
  if (
    JSON.stringify(actual) !== JSON.stringify(Object.fromEntries(Object.entries(expected).sort()))
  ) {
    throw new Error('Input/output checksum mismatch; existing files preserved.');
  }
  return actual;
}

async function writer(filename) {
  const handle = await open(filename, 'wx');
  let buffer = '',
    closed = false;
  return {
    async add(value) {
      buffer += json(value);
      if (buffer.length >= 256 * 1024) {
        await handle.writeFile(buffer);
        buffer = '';
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        if (buffer) await handle.writeFile(buffer);
      } finally {
        await handle.close();
      }
    },
  };
}

function validateRecord(record, file, revision, lineNumber) {
  const source = record?.source;
  const expectedId = sha(
    JSON.stringify([file.id, file.path, revision, lineNumber, source?.rawKey]),
  );
  if (
    source?.gameId !== file.id ||
    source.path !== file.path ||
    source.revision !== revision ||
    source.lineNumber !== lineNumber ||
    !digestPattern.test(source.rawRowHash) ||
    record.id !== expectedId ||
    !(source.rawKey === null || typeof source.rawKey === 'string')
  ) {
    throw new Error(`Invalid record provenance: ${file.id}:${lineNumber}`);
  }
  if (
    typeof record.korean?.clean !== 'string' ||
    typeof record.korean.raw !== 'string' ||
    !Array.isArray(record.korean.warnings) ||
    !record.languages ||
    !record.locator ||
    !record.classification ||
    typeof record.routing !== 'string' ||
    !Array.isArray(record.mentionedCharacters) ||
    !Array.isArray(record.review?.holdReasons) ||
    record.review.speaker !== null ||
    record.review.recipient !== null ||
    record.review.storyGame !== null ||
    record.review.timeline !== null ||
    record.review.orderStatus !== 'unverified' ||
    record.review.trainingEligible !== false
  ) {
    throw new Error(`Invalid unverified record: ${file.id}:${lineNumber}`);
  }
  const locator = parseSourceKey(source.rawKey);
  const sceneGroup = locator.sceneCandidate
    ? sha(JSON.stringify([file.id, file.path, revision, locator.container, locator.sceneCandidate]))
    : `unresolved:${record.id}`;
  if (
    Object.entries(locator).some(([key, value]) => record.locator[key] !== value) ||
    record.sceneGroup !== sceneGroup
  )
    throw new Error('Invalid source locator or scene reference.');
  if (
    record.korean.raw !== (record.languages.ko ?? '') ||
    record.contentHash !==
      sha(JSON.stringify([record.korean.clean, (record.languages.ja ?? '').normalize('NFC')]))
  )
    throw new Error('Invalid normalized text reference.');
  for (const mention of record.mentionedCharacters) {
    if (typeof mention.id !== 'string' || !mention.id || !Array.isArray(mention.aliases))
      throw new Error('Invalid mention reference.');
  }
}

export async function reviewDataset({
  dataDir,
  inputRunId,
  codeFingerprint = 'development',
  seed = 'yakuza-review-v1',
  samplesPerStratum = 3,
}) {
  if (
    typeof seed !== 'string' ||
    !seed ||
    seed.length > 128 ||
    !Number.isSafeInteger(samplesPerStratum) ||
    samplesPerStratum < 1 ||
    samplesPerStratum > 20 ||
    typeof codeFingerprint !== 'string' ||
    !codeFingerprint
  )
    throw new Error('Invalid review configuration.');
  dataDir = await realpath(dataDir);
  if (inputRunId === undefined) {
    const pointer = JSON.parse(await readFile(path.join(dataDir, 'latest.json'), 'utf8'));
    if (pointer.relativePath !== `processed/${pointer.runId}` || pointer.trainingReady !== false)
      throw new Error('Invalid normalization pointer.');
    inputRunId = pointer.runId;
  }
  if (!runPattern.test(inputRunId)) throw new Error('Invalid input run ID.');
  const inputDir = path.join(dataDir, 'processed', inputRunId);
  if ((await realpath(inputDir)) !== inputDir)
    throw new Error('Symlinked input run is not allowed.');
  const inputChecksums = await verifiedHashes(inputDir);
  const inputConfig = JSON.parse(await readFile(path.join(inputDir, 'configuration.json'), 'utf8'));
  const inputReport = JSON.parse(await readFile(path.join(inputDir, 'report.json'), 'utf8'));
  validateManifest(inputConfig.manifest);
  if (
    sha(JSON.stringify(inputConfig)).slice(0, 24) !== inputRunId ||
    inputReport.runId !== inputRunId ||
    inputReport.trainingReady !== false ||
    inputReport.allCharactersRetained !== true ||
    inputReport.counts?.trainingEligible !== 0 ||
    !Array.isArray(inputReport.files) ||
    inputReport.files.length !== inputConfig.manifest.files.length
  )
    throw new Error('Input run metadata mismatch.');
  const expectedNormalized = inputConfig.manifest.files
    .map((file) => `${file.id}.normalized.jsonl.gz`)
    .sort();
  if (
    JSON.stringify(
      Object.keys(inputChecksums)
        .filter((name) => name.endsWith('.normalized.jsonl.gz'))
        .sort(),
    ) !== JSON.stringify(expectedNormalized)
  )
    throw new Error('Normalized file set does not match manifest.');
  const configuration = {
    schemaVersion: 1,
    inputRunId,
    inputChecksums,
    codeFingerprint,
    seed,
    samplesPerStratum,
  };
  const runId = sha(JSON.stringify(configuration)).slice(0, 24);
  const parent = path.join(dataDir, 'reviews');
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== parent)
    throw new Error('Symlinked review directory is not allowed.');
  const lockPath = path.join(parent, '.review.lock');
  const lock = await open(lockPath, 'wx');
  const finalDir = path.join(parent, runId);
  const pointerTemp = path.join(dataDir, `.latest-review-${randomUUID()}.tmp`);
  let temporary,
    promoted = false;
  const writers = {},
    laneCounts = new Map(),
    reasonCounts = new Map(),
    sourceCounts = new Map(),
    samples = new Map(),
    duplicates = new Map();
  const report = {
    schemaVersion: 1,
    runId,
    inputRunId,
    trainingReady: false,
    allCharactersRetained: true,
    annotationStatus: 'speaker, recipient and order unverified; no SFT or split export',
    counts: { input: 0, candidates: 0, held: 0, trainingEligible: 0 },
    files: [],
  };
  try {
    temporary = await mkdtemp(path.join(parent, `.${runId}-`));
    for (const name of ['review-candidates', 'review-held', 'duplicate-groups', 'review-samples'])
      writers[name] = await writer(path.join(temporary, `${name}.jsonl`));
    for (const file of inputConfig.manifest.files) {
      const normalizedFile = `${file.id}.normalized.jsonl.gz`;
      if (!inputChecksums[normalizedFile]) throw new Error('Missing normalized checksum.');
      let rows = 0;
      for await (const { row: record, lineNumber } of readJsonlGzip(
        path.join(inputDir, normalizedFile),
      )) {
        validateRecord(record, file, inputConfig.manifest.revision, lineNumber);
        const classification = reviewLane(record);
        const item = {
          id: record.id,
          source: record.source,
          normalizedReference: { inputRunId, normalizedFile, lineNumber },
          locator: record.locator,
          sceneGroup: record.sceneGroup,
          sourceClassification: record.classification,
          sourceRouting: record.routing,
          ...classification,
          korean: record.korean,
          ja: record.languages.ja ?? null,
          en: record.languages.en ?? null,
          mentionedCharacters: record.mentionedCharacters,
          review: record.review,
          trainingEligible: false,
          dialogueReviewEligible: classification.lane === 'dialogue_context_review',
          exactKoreanTextHash: record.korean.clean.trim() ? sha(record.korean.clean) : null,
        };
        const destination = item.dialogueReviewEligible ? 'candidates' : 'held';
        await writers[`review-${destination}`].add(item);
        rows++;
        report.counts.input++;
        report.counts[destination]++;
        count(laneCounts, item.lane);
        for (const reason of item.reasons) count(reasonCounts, reason);
        count(
          sourceCounts,
          JSON.stringify([file.id, item.lane, record.locator.container, item.sourceField]),
        );
        const priorities = [...new Set(record.mentionedCharacters.map((m) => m.id))];
        const strata = [
          ...(priorities.length ? priorities : [null]).map((id) => ['mention', id]),
          ...[...new Set(item.reasons)].map((reason) => ['review_reason', reason]),
          ...[...new Set(item.korean.warnings)].map((warning) => ['korean_warning', warning]),
        ];
        for (const [type, value] of strata) {
          const stratum = JSON.stringify([file.id, item.lane, type, value]);
          const ranked = samples.get(stratum) ?? [];
          ranked.push({ rank: sha(JSON.stringify([seed, stratum, item.id])), item });
          ranked.sort(
            (a, b) =>
              a.rank.localeCompare(b.rank, 'en') || a.item.id.localeCompare(b.item.id, 'en'),
          );
          samples.set(stratum, ranked.slice(0, samplesPerStratum));
        }
        if (item.exactKoreanTextHash) {
          const members = duplicates.get(item.exactKoreanTextHash) ?? [];
          members.push({
            id: item.id,
            gameId: file.id,
            sceneGroup: item.sceneGroup,
            normalizedFile,
            lineNumber,
          });
          duplicates.set(item.exactKoreanTextHash, members);
        }
      }
      const expected = inputReport.files.filter((entry) => entry.id === file.id);
      if (expected.length !== 1 || rows !== expected[0].normalized || rows !== expected[0].input)
        throw new Error(`Input row conservation failed: ${file.id}`);
      report.files.push({ id: file.id, input: rows });
    }
    if (
      report.counts.input !== inputReport.counts?.normalized ||
      report.counts.input !== inputReport.counts.input ||
      report.counts.candidates + report.counts.held !== report.counts.input
    )
      throw new Error('Input row conservation failed.');
    report.duplicateGroups = { sameContext: 0, crossContext: 0, rowsRemoved: 0 };
    for (const [textHash, members] of [...duplicates].sort(([a], [b]) =>
      a.localeCompare(b, 'en'),
    )) {
      if (members.length < 2) continue;
      const contexts = new Map();
      for (const member of members) {
        const group = contexts.get(member.sceneGroup) ?? [];
        group.push(member);
        contexts.set(member.sceneGroup, group);
      }
      for (const [sceneGroup, group] of contexts)
        if (group.length > 1) {
          await writers['duplicate-groups'].add({
            textHash,
            scope: 'same_context',
            contextStatus: 'source_groups_unverified',
            sceneGroup,
            members: group,
            removed: false,
          });
          report.duplicateGroups.sameContext++;
        }
      if (contexts.size > 1) {
        await writers['duplicate-groups'].add({
          textHash,
          scope: 'cross_context',
          contextStatus: 'source_groups_unverified',
          hasUnresolvedContext: members.some((member) =>
            member.sceneGroup.startsWith('unresolved:'),
          ),
          members,
          removed: false,
        });
        report.duplicateGroups.crossContext++;
      }
    }
    const selected = new Map();
    for (const [stratum, ranked] of [...samples].sort(([a], [b]) => a.localeCompare(b, 'en')))
      for (const { item } of ranked) {
        const entry = selected.get(item.id) ?? { ...item, sampleStrata: [] };
        entry.sampleStrata.push(stratum);
        selected.set(item.id, entry);
      }
    for (const [, item] of [...selected].sort(([a], [b]) => a.localeCompare(b, 'en')))
      await writers['review-samples'].add(item);
    report.lanes = object(laneCounts);
    report.reviewReasons = object(reasonCounts);
    report.sourceFields = object(sourceCounts);
    report.sampling = {
      method: 'sha256-ranked-within-game-lane-typed-review-strata',
      stratumTypes: ['mention', 'review_reason', 'korean_warning'],
      unmentionedValue: null,
      seed,
      samplesPerStratum,
      strata: samples.size,
      records: selected.size,
      accuracyEstimate: false,
    };
    for (const output of Object.values(writers)) await output.close();
    if (JSON.stringify(await verifiedHashes(inputDir)) !== JSON.stringify(inputChecksums))
      throw new Error('Input changed during review.');
    await writeFile(path.join(temporary, 'configuration.json'), pretty(configuration));
    await writeFile(path.join(temporary, 'report.json'), pretty(report));
    const checksums = await hashes(temporary);
    await writeFile(path.join(temporary, 'checksums.json'), pretty(checksums));
    const exists = await lstat(finalDir).then(
      () => true,
      (e) => {
        if (e.code === 'ENOENT') return false;
        throw e;
      },
    );
    if (exists) {
      if (
        (await realpath(finalDir)) !== finalDir ||
        JSON.stringify(await verifiedHashes(finalDir)) !== JSON.stringify(checksums)
      )
        throw new Error('Existing review differs; preserved it.');
      await rm(temporary, { recursive: true });
      temporary = null;
    } else {
      await rename(temporary, finalDir);
      temporary = null;
      promoted = true;
    }
    await writeFile(
      pointerTemp,
      pretty({ runId, inputRunId, relativePath: `reviews/${runId}`, trainingReady: false }),
      { flag: 'wx' },
    );
    await rename(pointerTemp, path.join(dataDir, 'latest-review.json'));
    return { directory: finalDir, report, reproduced: exists };
  } catch (error) {
    for (const output of Object.values(writers)) await output.close().catch(() => {});
    if (temporary) await rm(temporary, { recursive: true, force: true });
    if (promoted) await rm(finalDir, { recursive: true, force: true });
    await rm(pointerTemp, { force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
