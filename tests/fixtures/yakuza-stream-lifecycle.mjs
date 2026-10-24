import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { readJsonlGzip } from '../../scripts/lib/yakuza-pipeline.mjs';

const [scenario, directory, delayArgument = '0'] = process.argv.slice(2);
const delayMs = Number(delayArgument);
const iterations = scenario === 'truncated' ? 40 : 1;
const filename = path.join(directory, `${scenario}.jsonl.gz`);
const largeBody = Array.from({ length: 10_000 }, (_, index) =>
  JSON.stringify({ index, synthetic: createHash('sha256').update(String(index)).digest('hex') }),
).join('\n');
const payload =
  scenario === 'truncated'
    ? gzipSync('{}\n').subarray(0, -4)
    : scenario === 'invalid-json'
      ? gzipSync(`{broken}\n${largeBody}`)
      : scenario === 'invalid-utf8'
        ? gzipSync(Buffer.concat([Buffer.from([0xff, 0x0a]), Buffer.from(largeBody)]))
        : gzipSync(largeBody);
if (scenario !== 'missing-file') await writeFile(filename, payload);

// Observe actual file descriptor lifetime in this isolated process. The large
// synthetic file keeps source reads outstanding when the consumer stops early.
const nativeOpen = fs.open;
const nativeClose = fs.close;
const descriptors = new Set();
let opened = 0;
let closed = 0;
fs.open = (...args) => {
  const callback = args.pop();
  nativeOpen(...args, (error, fd) => {
    if (!error) {
      descriptors.add(fd);
      opened++;
    }
    callback(error, fd);
  });
};
fs.close = (fd, callback) => {
  nativeClose(fd, (error) => {
    if (!error && descriptors.delete(fd)) closed++;
    callback(error);
  });
};

let yielded = 0;
async function consume() {
  for await (const item of readJsonlGzip(filename)) {
    assert.equal(item.lineNumber, 1);
    yielded++;
    if (delayMs) await delay(delayMs);
  }
}

try {
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (scenario === 'truncated') {
      await assert.rejects(consume(), { code: 'Z_BUF_ERROR' });
    } else if (scenario === 'missing-file') {
      await assert.rejects(consume(), { code: 'ENOENT' });
    } else if (scenario === 'invalid-json') {
      await assert.rejects(consume(), SyntaxError);
    } else if (scenario === 'invalid-utf8') {
      await assert.rejects(consume(), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
    } else if (scenario === 'normal') {
      for await (const item of readJsonlGzip(filename)) {
        assert.equal(item.lineNumber, yielded + 1);
        assert.equal(item.row.index, yielded);
        yielded++;
      }
      assert.equal(yielded, 10_000);
    } else if (scenario === 'early-break') {
      for await (const item of readJsonlGzip(filename)) {
        assert.equal(item.lineNumber, 1);
        yielded++;
        break;
      }
    } else if (scenario === 'consumer-error') {
      const failure = new Error('synthetic consumer failure');
      await assert.rejects(
        async () => {
          for await (const item of readJsonlGzip(filename)) {
            assert.equal(item.lineNumber, 1);
            yielded++;
            throw failure;
          }
        },
        (error) => error === failure,
      );
    } else {
      throw new Error(`Unknown synthetic scenario: ${scenario}`);
    }
    assert.equal(descriptors.size, 0, 'reader must close its file before returning');
  }
  assert.equal(opened, scenario === 'missing-file' ? 0 : iterations);
  assert.equal(closed, opened);
  if (scenario === 'truncated') assert.ok(yielded > 0, 'exercise errors after yielding a row');
  if (['early-break', 'consumer-error'].includes(scenario)) assert.equal(yielded, 1);
  // Leave late stream errors and unhandled rejections fatal; do not intercept
  // them with a process error handler. The parent also enforces a bounded exit.
  await delay(0);
  process.stdout.write(
    JSON.stringify({ scenario, delayMs, iterations, yielded, opened, closed }) + '\n',
  );
} finally {
  fs.open = nativeOpen;
  fs.close = nativeClose;
}
