import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchDataset, validateManifest } from '../scripts/lib/yakuza-download.mjs';
import { preprocessDataset, readJsonlGzip } from '../scripts/lib/yakuza-pipeline.mjs';

const directories = [];
const execFileAsync = promisify(execFile);
const lifecycleFixture = fileURLToPath(
  new URL('./fixtures/yakuza-stream-lifecycle.mjs', import.meta.url),
);
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yakuza-test-'));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
const sha = (data) => createHash('sha256').update(data).digest('hex');
function manifestFor(buffer) {
  return {
    schemaVersion: 1,
    dataset: 'liwu/MNBVC',
    revision: 'a'.repeat(40),
    files: [
      {
        id: 'synthetic',
        path: 'game/Yakuza/20230924/Synthetic.jsonl.gz',
        bytes: buffer.length,
        sha256: sha(buffer),
      },
    ],
  };
}
function row(ko, key = 'demo') {
  return {
    ko_text: ko,
    ja_text: 'synthetic Japanese field',
    en_text: 'synthetic English field',
    zh_text: '',
    是否重复: true,
    扩展字段: JSON.stringify({
      k: `msg_replacer.bin.json@1@middle_file/auth/event/${key}@table@3@fixture@message`,
    }),
  };
}
async function dataset(rows) {
  const dir = await temp();
  const bytes = gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const manifest = manifestFor(bytes);
  await mkdir(path.join(dir, 'raw'));
  await writeFile(path.join(dir, 'raw', 'Synthetic.jsonl.gz'), bytes);
  return { dir, bytes, manifest };
}

async function lifecycleProbe(scenario, delayMs = 0) {
  const directory = await temp();
  // A child process makes an uncaught stream error or hung iterator a normal
  // test failure instead of poisoning the Vitest worker. Keep its bound below
  // the existing 5-second test timeout; do not tolerate retries or lost errors.
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['--unhandled-rejections=strict', lifecycleFixture, scenario, directory, String(delayMs)],
    { timeout: 4000, killSignal: 'SIGKILL' },
  );
  expect(stderr).toBe('');
  return JSON.parse(stdout);
}

describe('gzip stream lifecycle', () => {
  it.each([0, 1, 5, 25])(
    'rejects truncated gzip with %ims of consumer work without uncaught errors',
    async (delayMs) => {
      const result = await lifecycleProbe('truncated', delayMs);
      expect(result).toMatchObject({ delayMs, iterations: 40, opened: 40, closed: 40 });
      expect(result.yielded).toBeGreaterThan(0);
    },
  );
  it.each([
    'normal',
    'missing-file',
    'invalid-json',
    'invalid-utf8',
    'early-break',
    'consumer-error',
  ])('closes the source and preserves the result of %s', async (scenario) => {
    const result = await lifecycleProbe(scenario);
    expect(result.opened).toBe(scenario === 'missing-file' ? 0 : 1);
    expect(result.closed).toBe(result.opened);
  });
});

describe('pinned archive collection', () => {
  it('verifies a cached file and never silently trusts corruption', async () => {
    const { dir, manifest } = await dataset([row('첫 번째 합성 문장')]);
    let requests = 0;
    const fetchImpl = () => {
      requests++;
      throw new Error('should not download');
    };
    expect((await fetchDataset(manifest, { dataDir: dir, fetchImpl }))[0].status).toBe(
      'verified-cache',
    );
    expect(requests).toBe(0);
    await writeFile(
      path.join(dir, 'raw', 'Synthetic.jsonl.gz'),
      Buffer.alloc(manifest.files[0].bytes),
    );
    await expect(fetchDataset(manifest, { dataDir: dir, fetchImpl })).rejects.toThrow('SHA-256');
    expect(requests).toBe(0);
  });
  it('publishes only a whole archive with the expected digest', async () => {
    const bytes = gzipSync('fixture');
    const dir = await temp();
    const manifest = manifestFor(bytes);
    const response = await fetchDataset(manifest, {
      dataDir: dir,
      fetchImpl: async () => new Response(bytes),
    });
    expect(response[0].status).toBe('downloaded');
    expect(await readFile(path.join(dir, 'raw', 'Synthetic.jsonl.gz'))).toEqual(bytes);
  });
  it.each(['partial', 'truncated', 'wrong-hash'])(
    'rejects %s HTTP data without leaving a reusable archive',
    async (kind) => {
      const bytes = gzipSync('complete fixture');
      const dir = await temp();
      const manifest = manifestFor(bytes);
      const payload =
        kind === 'truncated'
          ? bytes.subarray(0, -2)
          : kind === 'wrong-hash'
            ? Buffer.alloc(bytes.length)
            : bytes;
      await expect(
        fetchDataset(manifest, {
          dataDir: dir,
          fetchImpl: async () => new Response(payload, { status: kind === 'partial' ? 206 : 200 }),
        }),
      ).rejects.toThrow();
      expect(await readdir(path.join(dir, 'raw'))).toEqual([]);
      expect(await readdir(dir)).not.toContain('.fetch.lock');
    },
  );
  it('rejects traversal and duplicate paths before downloading', () => {
    const m = manifestFor(Buffer.from('x'));
    m.files[0].path = '../escape.gz';
    expect(() => validateManifest(m)).toThrow();
    const duplicated = manifestFor(Buffer.from('x'));
    duplicated.files.push({ ...duplicated.files[0], id: 'other' });
    expect(() => validateManifest(duplicated)).toThrow();
  });
});

describe('full corpus processing', () => {
  it('preserves all rows, languages, non-roster speakers and context-specific repeats', async () => {
    const { dir, manifest } = await dataset([
      row('알겠습니다.', 'one'),
      row('알겠습니다.', 'two'),
      row('알겠습니다.', 'one'),
      { ...row('목록 밖 인물의 합성 문장', 'three'), de_text: 'Synthetisch' },
      row('', 'four'),
      row('합성 ${value}', 'five'),
    ]);
    const first = await preprocessDataset(manifest, {
      dataDir: dir,
      characters: [{ id: 'kiryu', aliases: ['키류'] }],
    });
    expect(first.report.counts).toEqual({ input: 6, normalized: 6, trainingEligible: 0 });
    const rows = gunzipSync(
      await readFile(path.join(first.directory, 'synthetic.normalized.jsonl.gz')),
    )
      .toString()
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(
      rows.every(
        (r) =>
          r.review.trainingEligible === false &&
          r.review.speaker === null &&
          r.review.recipient === null,
      ),
    ).toBe(true);
    expect(rows[0].duplicate.of).toBeNull();
    expect(rows[1].duplicate.of).toBeNull();
    expect(rows[2].duplicate.of).toBe(rows[0].id);
    expect(rows[3].languages.de).toBe('Synthetisch');
    expect(rows[3].mentionedCharacters).toEqual([]);
    expect(rows[4].routing).toBe('no_korean');
    expect(rows[5].routing).toBe('quality_review');
    expect(first.report.files[0].upstreamDuplicateTrue).toBe(6);
    const second = await preprocessDataset(manifest, {
      dataDir: dir,
      characters: [{ id: 'kiryu', aliases: ['키류'] }],
    });
    expect(second.directory).toBe(first.directory);
    expect(second.reproduced).toBe(true);
    expect(await readdir(path.join(dir, 'processed'))).toEqual([first.report.runId]);
  });
  it.each(['invalid-utf8', 'truncated-gzip', 'invalid-json', 'blank-line'])(
    'does not promote a run with %s',
    async (kind) => {
      const dir = await temp();
      const bytes =
        kind === 'invalid-utf8'
          ? gzipSync(Buffer.from([0xff, 0x0a]))
          : kind === 'truncated-gzip'
            ? gzipSync('{}\n').subarray(0, -4)
            : gzipSync(kind === 'invalid-json' ? '{broken}\n' : '\n');
      await mkdir(path.join(dir, 'raw'));
      await writeFile(path.join(dir, 'raw', 'Synthetic.jsonl.gz'), bytes);
      await expect(preprocessDataset(manifestFor(bytes), { dataDir: dir })).rejects.toThrow();
      expect(await readdir(path.join(dir, 'processed'))).toEqual([]);
      expect(await readdir(dir)).not.toContain('latest.json');
      expect(await readdir(dir)).not.toContain('latest.json.tmp');
    },
  );
  it.each(['truncated-gzip', 'invalid-json', 'invalid-record'])(
    'preserves an earlier run and releases the lock after %s',
    async (kind) => {
      const { dir, bytes, manifest } = await dataset([row('정상 결과 보존을 확인하는 합성 문장')]);
      const first = await preprocessDataset(manifest, { dataDir: dir });
      const latest = await readFile(path.join(dir, 'latest.json'));
      const checksums = await readFile(path.join(first.directory, 'checksums.json'));
      const broken =
        kind === 'truncated-gzip'
          ? gzipSync('{}\n').subarray(0, -4)
          : gzipSync(kind === 'invalid-json' ? '{broken}\n' : 'null\n');
      const filename = path.join(dir, 'raw', 'Synthetic.jsonl.gz');
      await writeFile(filename, broken);
      await expect(preprocessDataset(manifestFor(broken), { dataDir: dir })).rejects.toThrow();
      expect(await readdir(path.join(dir, 'processed'))).toEqual([first.report.runId]);
      expect(await readFile(path.join(dir, 'latest.json'))).toEqual(latest);
      expect(await readFile(path.join(first.directory, 'checksums.json'))).toEqual(checksums);
      expect(await readdir(dir)).not.toContain('latest.json.tmp');
      expect(await readFile(filename)).toEqual(broken);
      await writeFile(filename, bytes);
      expect((await preprocessDataset(manifest, { dataDir: dir })).reproduced).toBe(true);
    },
  );
  it('rejects corruption of an existing output rather than replacing it silently', async () => {
    const { dir, manifest } = await dataset([row('검증용 합성 문장')]);
    const first = await preprocessDataset(manifest, { dataDir: dir });
    await writeFile(path.join(first.directory, 'report.json'), 'corrupt');
    await expect(preprocessDataset(manifest, { dataDir: dir })).rejects.toThrow(
      'Existing run differs',
    );
    expect(await readFile(path.join(first.directory, 'report.json'), 'utf8')).toBe('corrupt');
  });
  it('accepts a final JSON record without newline and records its position', async () => {
    const dir = await temp();
    const filename = path.join(dir, 'fixture.gz');
    const lines = ['{}\r', '{"ko_text":"합성"}'];
    await writeFile(filename, gzipSync(lines.join('\n')));
    const result = [];
    for await (const item of readJsonlGzip(filename)) result.push(item);
    expect(result).toEqual(
      lines.map((line, index) => ({
        row: JSON.parse(line),
        lineNumber: index + 1,
        rawRowHash: sha(line),
      })),
    );
  });
});
