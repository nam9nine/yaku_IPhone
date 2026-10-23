import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractEvidence,
  hasClosingIssueLink,
  isBaselineChange,
  isUiChange,
  validateEvidence,
} from '../../scripts/lib/evidence.mjs';

const headSha = 'a'.repeat(40);
const artifact = 'harness/evidence/foundation.png';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=',
  'base64',
);
const review = () => ({
  reviewer: 'independent-agent',
  verdict: 'pass',
  summary: 'Reviewed implementation diff and the captured foundation fixture.',
});
const evidence = () => ({
  schemaVersion: 1,
  headSha,
  issue: 1,
  environment: { platform: 'test environment', node: '24.22.0', playwright: '1.64.1' },
  checks: ['npm run check', 'npm run test:e2e', 'npm run test:visual'].map((command) => ({
    command,
    result: 'pass',
    details: 'Observed successful exit.',
  })),
  review: review(),
  visual: {
    status: 'pass',
    scenes: ['foundation, 390x844'],
    reason: 'Foundation fixture only.',
    references: ['apple-lock'],
    artifacts: [artifact],
    comparison: 'Foundation fixture is legible and unclipped; no iPhone UI fidelity claim.',
    baselineChanged: false,
  },
});

let rootDir;
let options;
beforeEach(() => {
  rootDir = mkdtempSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '.evidence-fixture-'),
  );
  mkdirSync(path.join(rootDir, 'harness/evidence'), { recursive: true });
  mkdirSync(path.join(rootDir, 'references'));
  writeFileSync(path.join(rootDir, artifact), image);
  writeFileSync(
    path.join(rootDir, 'references/manifest.json'),
    JSON.stringify({ schemaVersion: 1, sources: [{ id: 'apple-lock' }] }),
  );
  options = {
    rootDir,
    headSha,
    changedFiles: ['src/App.tsx'],
    author: 'pr-author',
    trackedFiles: new Set([artifact]),
    prBody: 'Closes #1',
    repository: 'owner/repo',
  };
});
afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

describe('SHA-bound evidence', () => {
  it.each(['environment', 'checks'])('rejects missing execution %s', (field) => {
    const input = evidence();
    delete input[field];
    expect(validateEvidence(input, options).valid).toBe(false);
  });
  it.each(['fail', 'not-run'])('rejects required verification %s', (result) => {
    const input = evidence();
    input.checks[1].result = result;
    expect(validateEvidence(input, options).errors.join('\n')).toContain(
      'Required verification must pass',
    );
  });
  it('rejects missing screenshot scenes', () => {
    const input = evidence();
    delete input.visual.scenes;
    expect(validateEvidence(input, options).valid).toBe(false);
  });
  it('accepts actual tracked screenshot evidence with a matching issue and head', () => {
    expect(validateEvidence(evidence(), options)).toEqual({
      valid: true,
      errors: [],
      requiresVisual: true,
    });
  });

  it.each(['b'.repeat(40), 'abc123', '', undefined])('rejects stale or missing SHA %s', (sha) => {
    expect(validateEvidence({ ...evidence(), headSha: sha }, options).errors.join('\n')).toContain(
      'missing or stale',
    );
  });

  it.each([0, -1, '1', null, undefined])('rejects absent or invalid issue %s', (issue) => {
    expect(validateEvidence({ ...evidence(), issue }, options).valid).toBe(false);
  });

  it('requires a closing issue link outside the evidence JSON', () => {
    const body = `<!-- harness-evidence -->\n${JSON.stringify({ note: 'Closes #1' })}\n<!-- /harness-evidence -->`;
    expect(validateEvidence(evidence(), { ...options, prBody: body }).errors.join('\n')).toContain(
      'PR prose must close',
    );
    expect(validateEvidence(evidence(), { ...options, prBody: 'Closes #11' }).valid).toBe(false);
  });

  it.each([
    undefined,
    { reviewer: '', verdict: 'pass', summary: 'Checked' },
    { reviewer: 'SELF', verdict: 'pass', summary: 'Checked' },
    { reviewer: '@PR-AUTHOR', verdict: 'pass', summary: 'Checked' },
    { reviewer: 'review-agent', verdict: 'fail', summary: 'Blocking defect' },
    { reviewer: 'review-agent', verdict: 'pass', summary: '' },
  ])('rejects missing, self, or failing independent review', (reviewValue) => {
    expect(validateEvidence({ ...evidence(), review: reviewValue }, options).valid).toBe(false);
  });

  it('does not permit visual not-applicable for a UI change', () => {
    const input = evidence();
    input.visual = {
      status: 'not-applicable',
      reason: 'Only a small UI change.',
      baselineChanged: false,
    };
    expect(validateEvidence(input, options).errors.join('\n')).toContain(
      'require visual.status pass',
    );
  });

  it('permits justified non-UI changes without fake screenshots', () => {
    const input = evidence();
    input.visual = {
      status: 'not-applicable',
      reason: 'Only changes evidence validator logic.',
      baselineChanged: false,
    };
    expect(
      validateEvidence(input, { ...options, changedFiles: ['scripts/lib/evidence.mjs'] }).valid,
    ).toBe(true);
    input.visual.reason = '';
    expect(validateEvidence(input, { ...options, changedFiles: ['docs/harness.md'] }).valid).toBe(
      false,
    );
  });

  it.each(['references', 'artifacts', 'comparison'])('rejects missing visual %s', (field) => {
    const input = evidence();
    delete input.visual[field];
    expect(validateEvidence(input, options).valid).toBe(false);
  });

  it('rejects an unknown Apple/source reference instead of accepting an arbitrary label', () => {
    const input = evidence();
    input.visual.references = ['invented-reference'];
    expect(validateEvidence(input, options).errors.join('\n')).toContain(
      'Unknown reference source',
    );
  });

  it('fails when the source manifest is unavailable', () => {
    rmSync(path.join(rootDir, 'references/manifest.json'));
    expect(validateEvidence(evidence(), options).errors.join('\n')).toContain(
      'Cannot validate reference IDs',
    );
  });

  it('requires a real tracked artifact, not just an existing local screenshot', () => {
    expect(
      validateEvidence(evidence(), { ...options, trackedFiles: new Set() }).errors.join('\n'),
    ).toContain('not tracked');
    rmSync(path.join(rootDir, artifact));
    expect(validateEvidence(evidence(), options).errors.join('\n')).toContain('does not exist');
  });

  it.each([
    'https://example.test/screen.png',
    '../screen.png',
    '/tmp/screen.png',
    'harness/../screen.png',
    'harness\\screen.png',
  ])('rejects external and escaping screenshot paths: %s', (file) => {
    const input = evidence();
    input.visual.artifacts = [file];
    expect(validateEvidence(input, options).errors.join('\n')).toContain(
      'Invalid screenshot artifact path',
    );
  });

  it('rejects symlinks escaping the repository', () => {
    rmSync(path.join(rootDir, artifact));
    symlinkSync(fileURLToPath(import.meta.url), path.join(rootDir, artifact));
    expect(validateEvidence(evidence(), options).errors.join('\n')).toContain(
      'within the repository',
    );
  });

  it('rejects text renamed to PNG', () => {
    writeFileSync(path.join(rootDir, artifact), 'This is a placeholder, not a screenshot.');
    expect(validateEvidence(evidence(), options).errors.join('\n')).toContain('must be a PNG');
  });

  it('requires baselineChanged to match the diff and an independent baseline review', () => {
    const input = evidence();
    const baselineOptions = {
      ...options,
      changedFiles: ['tests/visual/__screenshots__/home-chromium-linux.png'],
    };
    expect(validateEvidence(input, baselineOptions).valid).toBe(false);
    input.visual.baselineChanged = true;
    expect(validateEvidence(input, baselineOptions).errors.join('\n')).toContain(
      'visual.baselineReview',
    );
    input.visual.baselineReview = review();
    expect(validateEvidence(input, baselineOptions).valid).toBe(true);
    expect(validateEvidence(input, options).errors.join('\n')).toContain('must agree');
  });

  it('fails closed for absent or malformed authoritative input', () => {
    expect(validateEvidence(null, options).valid).toBe(false);
    expect(validateEvidence(evidence(), { ...options, changedFiles: undefined }).valid).toBe(false);
    expect(
      validateEvidence(evidence(), { ...options, changedFiles: ['../other/src/App.tsx'] }).valid,
    ).toBe(false);
    expect(validateEvidence(evidence()).valid).toBe(false);
  });
});

describe('PR body extraction and linkage', () => {
  it('accepts a plain or fenced JSON object and no executable JavaScript', () => {
    const json = JSON.stringify(evidence());
    expect(
      extractEvidence(`Closes #1\n<!-- harness-evidence -->\n${json}\n<!-- /harness-evidence -->`),
    ).toEqual(evidence());
    expect(
      extractEvidence(
        `<!-- harness-evidence -->\n\`\`\`json\n${json}\n\`\`\`\n<!-- /harness-evidence -->`,
      ),
    ).toEqual(evidence());
    expect(() =>
      extractEvidence(
        '<!-- harness-evidence -->\n({headSha: process.exit(0)})\n<!-- /harness-evidence -->',
      ),
    ).toThrow('Invalid harness evidence JSON');
  });

  it.each([
    '',
    '<!-- harness-evidence -->{}',
    '<!-- /harness-evidence --><!-- harness-evidence -->',
    '<!-- harness-evidence -->[]<!-- /harness-evidence -->',
    '<!-- harness-evidence -->{}<!-- /harness-evidence --><!-- harness-evidence -->{}<!-- /harness-evidence -->',
  ])('rejects malformed, missing, or duplicate evidence blocks', (body) => {
    expect(() => extractEvidence(body)).toThrow();
  });

  it('accepts matching closing keywords and rejects a link to another repository or code example', () => {
    expect(hasClosingIssueLink('Fixes #1', 1)).toBe(true);
    expect(hasClosingIssueLink('Resolves owner/repo#1', 1, 'owner/repo')).toBe(true);
    expect(hasClosingIssueLink('Closes other/repo#1', 1, 'owner/repo')).toBe(false);
    expect(hasClosingIssueLink('```md\nCloses #1\n```', 1)).toBe(false);
    expect(hasClosingIssueLink('<!-- Closes #1 -->', 1)).toBe(false);
    expect(hasClosingIssueLink('Related #1', 1)).toBe(false);
  });
});

describe('conservative change classification', () => {
  it.each([
    'src/state.ts',
    'public/icon.svg',
    'index.html',
    'styles/home.css',
    'package-lock.json',
    'package.json',
    'playwright.visual.config.ts',
    'tests/e2e/smoke.spec.ts',
    'tests/visual/home.spec.ts',
  ])('requires visual evidence for %s', (file) => {
    expect(isUiChange([file])).toBe(true);
  });

  it('allows documentation and pure harness changes without UI evidence', () => {
    expect(
      isUiChange([
        'docs/harness.md',
        'references/pages/apple.html',
        'scripts/lib/evidence.mjs',
        'tests/harness/evidence.test.mjs',
      ]),
    ).toBe(false);
  });

  it.each([
    'tests/home.spec.ts-snapshots/home.png',
    'harness/baselines/home.png',
    'tests/visual/__screenshots__/lock.png',
    'src/state.test.ts.snap',
  ])('detects baseline changes in %s', (file) => {
    expect(isBaselineChange(file)).toBe(true);
  });
});
