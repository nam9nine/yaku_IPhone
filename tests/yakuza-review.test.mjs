import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeRecord } from '../scripts/lib/yakuza-normalize.mjs';
import { routeRecord } from '../scripts/lib/yakuza-pipeline.mjs';
import { reviewDataset, reviewLane } from '../scripts/lib/yakuza-review.mjs';

const temporary = [];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value)}\n`;
const key = (scene = 'main', field = '3', position = 1) =>
  `talk.bin.json@1@${scene}@table@${position}@@${field}`;
const sample = (ko, sourceKey = key()) => ({
  ko_text: ko,
  ja_text: 'Synthetic Japanese',
  en_text: 'Synthetic English',
  扩展字段: JSON.stringify({ k: sourceKey }),
});
afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture(rows, mutate = () => {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yakuza-review-'));
  temporary.push(dataDir);
  const raw = gzipSync(rows.map(json).join(''));
  const file = {
    id: 'synthetic',
    path: 'game/Yakuza/20230924/Synthetic.jsonl.gz',
    bytes: raw.length,
    sha256: sha(raw),
  };
  const manifest = {
    schemaVersion: 1,
    dataset: 'liwu/MNBVC',
    revision: 'a'.repeat(40),
    files: [file],
  };
  const config = {
    schemaVersion: 1,
    manifest,
    characters: [],
    codeFingerprint: 'synthetic-fixture',
  };
  const inputRunId = sha(JSON.stringify(config)).slice(0, 24);
  const inputDir = path.join(dataDir, 'processed', inputRunId);
  await mkdir(inputDir, { recursive: true });
  const records = rows.map((row, index) => {
    const record = normalizeRecord(row, {
      gameId: file.id,
      sourcePath: file.path,
      sourceRevision: manifest.revision,
      lineNumber: index + 1,
    });
    record.routing = routeRecord(record, false);
    return record;
  });
  mutate(records);
  await writeFile(
    path.join(inputDir, 'synthetic.normalized.jsonl.gz'),
    gzipSync(records.map(json).join('')),
  );
  await writeFile(path.join(inputDir, 'configuration.json'), json(config));
  await writeFile(
    path.join(inputDir, 'report.json'),
    json({
      runId: inputRunId,
      trainingReady: false,
      allCharactersRetained: true,
      counts: { input: rows.length, normalized: rows.length, trainingEligible: 0 },
      files: [{ id: file.id, input: rows.length, normalized: rows.length }],
    }),
  );
  await checksum(inputDir);
  await writeFile(
    path.join(dataDir, 'latest.json'),
    json({ runId: inputRunId, relativePath: `processed/${inputRunId}`, trainingReady: false }),
  );
  return { dataDir, inputDir, inputRunId, records };
}

async function checksum(directory) {
  const entries = {};
  for (const name of (await readdir(directory)).sort())
    if (name !== 'checksums.json') {
      const bytes = await readFile(path.join(directory, name));
      entries[name] = { bytes: bytes.length, sha256: sha(bytes) };
    }
  await writeFile(path.join(directory, 'checksums.json'), json(entries));
}
async function lines(directory, file) {
  return (await readFile(path.join(directory, `${file}.jsonl`), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
}

describe('derived review lanes', () => {
  it('separates all 30 synthetic mail name records from mail text without inferring senders', async () => {
    const { dataDir } = await fixture([
      ...Array.from({ length: 30 }, (_, i) =>
        sample(`합성 발신자 ${i}`, `pause_mail.bin.json@${i}@sender_${i}@name`),
      ),
      sample('합성 제목', 'pause_mail.bin.json@1@demo_mail@table@0@@1'),
      sample('합성 본문', 'pause_mail.bin.json@1@demo_mail@table@0@@2'),
    ]);
    const result = await reviewDataset({ dataDir });
    expect(result.report.lanes).toEqual({ mail_name_review: 30, mail_review: 2 });
    expect(result.report.counts).toEqual({
      input: 32,
      candidates: 0,
      held: 32,
      trainingEligible: 0,
    });
    expect(
      (await lines(result.directory, 'review-held')).every(
        (r) => r.review.speaker === null && r.review.recipient === null,
      ),
    ).toBe(true);
  });

  it('uses source boundaries instead of words in speech and preserves mixed field 21', async () => {
    const { records } = await fixture([
      sample('버튼을 눌렀다고 말했다. 조작이라는 단어도 있다.', key('story_main')),
      sample('배고프다는 합성 대사', key('demo_minigame_poker')),
      sample('합성 대사', key('workshop')),
      sample('합성 짧은 발화', key('elvis_player_conversion', '21')),
      sample('합성 버튼', 'ui_text.bin.json@1@demo@text'),
      sample('합성 이미지 문구', 'ui_texture_text.bin.json@1@demo@text'),
    ]);
    expect(records.map((r) => reviewLane(r).lane)).toEqual([
      'dialogue_context_review',
      'gameplay_context_review',
      'dialogue_context_review',
      'dialogue_context_review',
      'ui_review',
      'ui_review',
    ]);
    expect(reviewLane(records[3]).reasons).toContain('mixed_numeric_field_21');
  });

  it('preserves every row and provenance, including non-roster characters and repeated utterances', async () => {
    const input = await fixture([
      sample('같은 합성 발화', key('one', '3', 1)),
      sample('같은 합성 발화', key('one', '3', 2)),
      sample('같은 합성 발화', key('two', '3', 1)),
      sample('명단 밖 인물의 합성 발화', key('three')),
      sample('', key('four')),
      sample('합성 ${variable}', key('five')),
    ]);
    const before = await readFile(path.join(input.inputDir, 'synthetic.normalized.jsonl.gz'));
    const result = await reviewDataset(input);
    const output = [
      ...(await lines(result.directory, 'review-candidates')),
      ...(await lines(result.directory, 'review-held')),
    ].sort((a, b) => a.source.lineNumber - b.source.lineNumber);
    expect(output).toHaveLength(6);
    expect(output.map((r) => r.source)).toEqual(input.records.map((r) => r.source));
    expect(output.map((r) => r.korean)).toEqual(input.records.map((r) => r.korean));
    expect(
      output.every((r) => r.review.orderStatus === 'unverified' && r.trainingEligible === false),
    ).toBe(true);
    expect(output[3].mentionedCharacters).toEqual([]);
    const groups = await lines(result.directory, 'duplicate-groups');
    expect(groups.map((g) => [g.scope, g.members.length, g.removed])).toEqual([
      ['same_context', 2, false],
      ['cross_context', 3, false],
    ]);
    expect(await readFile(path.join(input.inputDir, 'synthetic.normalized.jsonl.gz'))).toEqual(
      before,
    );
  });

  it('reproduces hashes and samples later rows deterministically without changing normalization latest', async () => {
    const { dataDir, inputRunId } = await fixture(
      Array.from({ length: 40 }, (_, i) => sample(`서로 다른 합성 발화 ${i}`, key('one', '3', i))),
    );
    const latest = await readFile(path.join(dataDir, 'latest.json'));
    const first = await reviewDataset({ dataDir, seed: 'review-test' });
    const samples = await lines(first.directory, 'review-samples');
    expect(samples).toHaveLength(3);
    expect(samples.some((r) => r.source.lineNumber > 3)).toBe(true);
    const second = await reviewDataset({ dataDir, seed: 'review-test' });
    expect(second.reproduced).toBe(true);
    expect(second.directory).toBe(first.directory);
    expect(await lines(second.directory, 'review-samples')).toEqual(samples);
    expect(await readFile(path.join(dataDir, 'latest.json'))).toEqual(latest);
    expect(
      JSON.parse(await readFile(path.join(dataDir, 'latest-review.json'), 'utf8')).inputRunId,
    ).toBe(inputRunId);
  });

  it('samples priority mentions as metadata while retaining non-roster records and strata', async () => {
    const { dataDir } = await fixture(
      [sample('키류의 합성 문장'), sample('이름 없는 합성 인물 문장')],
      (records) => {
        records[0].mentionedCharacters = [{ id: 'kiryu', aliases: ['키류'] }];
      },
    );
    const result = await reviewDataset({ dataDir, samplesPerStratum: 1 });
    expect(result.report.counts.input).toBe(2);
    const samples = await lines(result.directory, 'review-samples');
    expect(samples).toHaveLength(2);
    expect(
      samples.flatMap((row) => row.sampleStrata.map((stratum) => JSON.parse(stratum).slice(2))),
    ).toEqual(
      expect.arrayContaining([
        ['mention', 'kiryu'],
        ['mention', null],
      ]),
    );
    expect(samples.every((row) => row.review.speaker === null)).toBe(true);
  });

  it('represents rare mixed fields and Korean warnings in typed strata with stable repeats', async () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => sample(`일반 합성 발화 ${i}`, key('main', '3', i))),
      ...Array.from({ length: 40 }, (_, i) =>
        sample(`게임 합성 발화 ${i}`, key('demo_minigame', '3', i)),
      ),
      ...Array.from({ length: 40 }, (_, i) =>
        sample(`합성 <Unknown> 경고 ${i}`, key('main', '3', i + 40)),
      ),
      sample('드문 혼합 필드 합성 발화', key('main', '21', 100)),
      sample('드문 게임 혼합 필드 합성 발화', key('demo_minigame', '21', 100)),
      sample('드문 혼합 필드 ${value}', key('main', '21', 101)),
      sample('드문 합성 \u0001 제어 문자', key('main', '3', 102)),
      sample('드문 합성 \uFFFD 대체 문자', key('main', '3', 103)),
    ];
    const { dataDir } = await fixture(rows, (records) => {
      records[0].mentionedCharacters = [{ id: 'mixed_numeric_field_21', aliases: ['합성'] }];
    });
    const first = await reviewDataset({ dataDir, samplesPerStratum: 1, seed: 'rare-risk' });
    const samples = await lines(first.directory, 'review-samples');
    const strata = new Set(samples.flatMap((row) => row.sampleStrata));
    for (const lane of ['dialogue_context_review', 'gameplay_context_review', 'quality_review']) {
      expect(
        strata.has(JSON.stringify(['synthetic', lane, 'review_reason', 'mixed_numeric_field_21'])),
      ).toBe(true);
    }
    for (const warning of [
      'unrecognized_angle_tag',
      'unresolved_template_variable',
      'unexpected_control_character',
      'replacement_character',
    ]) {
      expect(
        strata.has(JSON.stringify(['synthetic', 'quality_review', 'korean_warning', warning])),
      ).toBe(true);
    }
    expect(
      strata.has(
        JSON.stringify([
          'synthetic',
          'dialogue_context_review',
          'mention',
          'mixed_numeric_field_21',
        ]),
      ),
    ).toBe(true);
    expect([...strata].some((stratum) => stratum.includes('speaker_unverified'))).toBe(false);
    expect(first.report.counts.input).toBe(rows.length);
    const second = await reviewDataset({ dataDir, samplesPerStratum: 1, seed: 'rare-risk' });
    expect(second.reproduced).toBe(true);
    expect(await lines(second.directory, 'review-samples')).toEqual(samples);
  });
});

describe('review input integrity and atomic publication', () => {
  it('rejects corrupt normalized bytes before processing and preserves prior review outputs', async () => {
    const { dataDir, inputDir } = await fixture([sample('합성 검증 문장')]);
    const first = await reviewDataset({ dataDir });
    const previousPointer = await readFile(path.join(dataDir, 'latest-review.json'));
    const previousReport = await readFile(path.join(first.directory, 'report.json'));
    await writeFile(path.join(inputDir, 'synthetic.normalized.jsonl.gz'), 'corrupt');
    await expect(reviewDataset({ dataDir })).rejects.toThrow('checksum mismatch');
    expect(await readFile(path.join(dataDir, 'latest-review.json'))).toEqual(previousPointer);
    expect(await readFile(path.join(first.directory, 'report.json'))).toEqual(previousReport);
    expect(await readdir(path.join(dataDir, 'reviews'))).toEqual([first.report.runId]);
  });

  it('rejects invalid record references even when file checksums match and cleans staging and lock', async () => {
    const { dataDir } = await fixture([sample('합성 검증 문장')], (records) => {
      records[0].source.lineNumber = 99;
    });
    await expect(reviewDataset({ dataDir })).rejects.toThrow('record provenance');
    expect(await readdir(path.join(dataDir, 'reviews'))).toEqual([]);
    expect(await readdir(dataDir)).not.toContain('latest-review.json');
  });

  it('detects row count disagreement independently of checksums', async () => {
    const { dataDir, inputDir } = await fixture([sample('합성 검증 문장')]);
    const report = JSON.parse(await readFile(path.join(inputDir, 'report.json'), 'utf8'));
    report.files[0].normalized = 2;
    await writeFile(path.join(inputDir, 'report.json'), json(report));
    await checksum(inputDir);
    await expect(reviewDataset({ dataDir })).rejects.toThrow('row conservation');
    expect(await readdir(path.join(dataDir, 'reviews'))).toEqual([]);
  });

  it('rejects source-context references that disagree with the source key', async () => {
    const { dataDir } = await fixture([sample('합성 검증 문장')], (records) => {
      records[0].sceneGroup = 'b'.repeat(64);
    });
    await expect(reviewDataset({ dataDir })).rejects.toThrow('scene reference');
    expect(await readdir(path.join(dataDir, 'reviews'))).toEqual([]);
  });

  it.each(['storyGame', 'timeline'])(
    'rejects an inferred %s in an unverified input',
    async (field) => {
      const { dataDir } = await fixture([sample('합성 검증 문장')], (records) => {
        records[0].review[field] = 'unverified guess';
      });
      await expect(reviewDataset({ dataDir })).rejects.toThrow('unverified record');
      expect(await readdir(path.join(dataDir, 'reviews'))).toEqual([]);
    },
  );

  it('rejects unsafe pointers and checksum paths before writing review data', async () => {
    const { dataDir, inputDir, inputRunId } = await fixture([sample('합성 검증 문장')]);
    await writeFile(
      path.join(dataDir, 'latest.json'),
      json({ runId: inputRunId, relativePath: '../escape', trainingReady: false }),
    );
    await expect(reviewDataset({ dataDir })).rejects.toThrow('pointer');
    const checksums = JSON.parse(await readFile(path.join(inputDir, 'checksums.json'), 'utf8'));
    checksums['../outside'] = { bytes: 1, sha256: 'a'.repeat(64) };
    await writeFile(path.join(inputDir, 'checksums.json'), json(checksums));
    await expect(reviewDataset({ dataDir, inputRunId })).rejects.toThrow('path');
    expect(await readdir(dataDir)).not.toContain('reviews');
  });

  it('keeps an existing different review intact rather than overwriting it on repeat', async () => {
    const { dataDir } = await fixture([sample('합성 검증 문장')]);
    const first = await reviewDataset({ dataDir });
    await writeFile(path.join(first.directory, 'report.json'), 'existing corruption');
    await expect(reviewDataset({ dataDir })).rejects.toThrow('checksum mismatch');
    expect(await readFile(path.join(first.directory, 'report.json'), 'utf8')).toBe(
      'existing corruption',
    );
    expect(await readdir(path.join(dataDir, 'reviews'))).toEqual([first.report.runId]);
  });

  it('rolls back only its new directory if latest-review promotion fails', async () => {
    const { dataDir } = await fixture([sample('합성 검증 문장')]);
    const first = await reviewDataset({ dataDir });
    const previous = await readFile(path.join(first.directory, 'checksums.json'));
    await rm(path.join(dataDir, 'latest-review.json'));
    await mkdir(path.join(dataDir, 'latest-review.json'));
    await writeFile(path.join(dataDir, 'latest-review.json', 'preserve'), 'existing');
    await expect(reviewDataset({ dataDir, seed: 'second-run' })).rejects.toThrow();
    expect(await readdir(path.join(dataDir, 'reviews'))).toEqual([first.report.runId]);
    expect(await readFile(path.join(first.directory, 'checksums.json'))).toEqual(previous);
    expect(await readFile(path.join(dataDir, 'latest-review.json', 'preserve'), 'utf8')).toBe(
      'existing',
    );
    expect((await readdir(dataDir)).filter((name) => name.startsWith('.latest-review-'))).toEqual(
      [],
    );
  });
});
