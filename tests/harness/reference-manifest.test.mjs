import { describe, expect, it } from 'vitest';
import { validateReferenceManifest, validateLicenseArtifacts } from '../../scripts/lib/harness.mjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const manifest = () => ({
  schemaVersion: 1,
  sources: [
    {
      id: 'reference-code',
      type: 'repository',
      sourceUrl: 'https://github.com/example/reference',
      commitSha: 'a'.repeat(40),
      retrievedOn: '2026-10-23',
      keyPaths: ['README.md'],
      license: { status: 'MIT' },
      purpose: 'Study mobile home layout.',
      artifacts: [
        {
          role: 'archive',
          url: `https://codeload.github.com/example/reference/tar.gz/${'a'.repeat(40)}`,
          localPath: 'references/upstream/reference.tar.gz',
          sha256: 'b'.repeat(64),
          bytes: 100,
        },
      ],
    },
  ],
});

describe('reference provenance structure', () => {
  it('requires a tracked, present, unchanged license file', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'yaku-license-'));
    try {
      const file = 'references/licenses/example.LICENSE';
      const bytes = Buffer.from('MIT notice fixture');
      const artifact = {
        role: 'license',
        localPath: file,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const input = {
        sources: [
          { license: { status: 'license-file-reviewed', localPath: file }, artifacts: [artifact] },
        ],
      };
      const tracked = new Set([file]);
      expect(validateLicenseArtifacts(input, rootDir, tracked).valid).toBe(false);
      mkdirSync(path.join(rootDir, 'references/licenses'), { recursive: true });
      writeFileSync(path.join(rootDir, file), bytes);
      expect(validateLicenseArtifacts(input, rootDir, tracked).valid).toBe(true);
      expect(validateLicenseArtifacts(input, rootDir, new Set()).valid).toBe(false);
      writeFileSync(path.join(rootDir, file), 'changed notice');
      expect(validateLicenseArtifacts(input, rootDir, tracked).valid).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
  it.each(['retrievedOn', 'keyPaths', 'artifacts'])('rejects missing provenance %s', (field) => {
    const input = manifest();
    delete input.sources[0][field];
    expect(validateReferenceManifest(input).valid).toBe(false);
  });
  it('rejects nonexistent dates, absent archives and unpinned artifact URLs', () => {
    const input = manifest();
    input.sources[0].retrievedOn = '2026-02-31';
    input.sources[0].artifacts[0].url = 'https://example.com/main';
    expect(validateReferenceManifest(input).errors.join('\n')).toContain('calendar date');
    expect(validateReferenceManifest(input).errors.join('\n')).toContain('archive URL');
    input.sources[0].artifacts = [];
    expect(validateReferenceManifest(input).valid).toBe(false);
  });
  it('accepts a pinned source with artifact integrity metadata', () => {
    expect(validateReferenceManifest(manifest())).toEqual({ valid: true, errors: [] });
  });

  it('rejects duplicate sources, moving repository versions, unsafe paths, and missing hashes', () => {
    const input = manifest();
    input.sources.push(structuredClone(input.sources[0]));
    input.sources[0].commitSha = 'main';
    input.sources[0].artifacts[0].localPath = '../escape.tar.gz';
    input.sources[0].artifacts[0].sha256 = '';
    const errors = validateReferenceManifest(input).errors.join('\n');
    expect(errors).toContain('unique');
    expect(errors).toContain('commit SHA');
    expect(errors).toContain('unsafe artifact path');
    expect(errors).toContain('SHA-256');
  });

  it.each([null, {}, { schemaVersion: 1, sources: [] }, { schemaVersion: 2, sources: [] }])(
    'rejects missing or unsupported source manifests',
    (input) => {
      expect(validateReferenceManifest(input).valid).toBe(false);
    },
  );
});
