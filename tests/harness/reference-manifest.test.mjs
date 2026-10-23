import { describe, expect, it } from 'vitest';
import { validateReferenceManifest } from '../../scripts/lib/harness.mjs';

const manifest = () => ({
  schemaVersion: 1,
  sources: [
    {
      id: 'reference-code',
      type: 'repository',
      sourceUrl: 'https://github.com/example/reference',
      commitSha: 'a'.repeat(40),
      license: { status: 'MIT' },
      purpose: 'Study mobile home layout.',
      artifacts: [
        { localPath: 'references/upstream/reference.tar.gz', sha256: 'b'.repeat(64), bytes: 100 },
      ],
    },
  ],
});

describe('reference provenance structure', () => {
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
