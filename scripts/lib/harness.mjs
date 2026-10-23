import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isSafeRelativePath } from './evidence.mjs';

export const REQUIRED_HARNESS_FILES = [
  'AGENTS.md',
  'docs/development.md',
  'docs/architecture.md',
  'docs/deployment.md',
  'docs/references.md',
  'docs/harness.md',
  'docs/visual-qa.md',
  'harness/plans/issue-1-harness.md',
  '.agents/skills/visual-review/SKILL.md',
  '.agents/skills/issue-delivery/SKILL.md',
  'scripts/check-harness.mjs',
  'scripts/check-evidence.mjs',
  'scripts/check-merge-gate.mjs',
  'references/manifest.json',
];

export function validateReferenceManifest(manifest) {
  const errors = [];
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length === 0
  ) {
    return {
      valid: false,
      errors: ['Reference manifest requires schemaVersion 1 and a nonempty sources array.'],
    };
  }
  const ids = new Set();
  for (const source of manifest.sources) {
    const name = source?.id ?? '(unnamed)';
    if (
      typeof source?.id !== 'string' ||
      !/^[a-z\d][a-z\d-]*$/.test(source.id) ||
      ids.has(source.id)
    ) {
      errors.push(
        `Reference source ID must be unique and use lowercase letters, digits, or hyphens: ${name}.`,
      );
    }
    ids.add(source?.id);
    let url;
    try {
      url = new URL(source?.sourceUrl);
    } catch {
      /* Report below. */
    }
    if (!url || url.protocol !== 'https:')
      errors.push(`Reference ${name} requires an HTTPS sourceUrl.`);
    if (
      !['repository', 'official-document', 'official-image', 'reference-site'].includes(
        source?.type,
      )
    )
      errors.push(`Reference ${name} has an unsupported type.`);
    if (source?.type === 'repository' && !/^[a-f\d]{40}$/i.test(source.commitSha ?? ''))
      errors.push(`Repository reference ${name} must pin a full commit SHA.`);
    if (
      !source?.license ||
      typeof source.license.status !== 'string' ||
      !source.license.status.trim()
    )
      errors.push(`Reference ${name} requires license status.`);
    if (typeof source?.purpose !== 'string' || !source.purpose.trim())
      errors.push(`Reference ${name} requires its intended purpose.`);
    if (!Array.isArray(source?.artifacts)) {
      errors.push(`Reference ${name} requires an artifacts array.`);
      continue;
    }
    for (const artifact of source.artifacts) {
      if (!isSafeRelativePath(artifact?.localPath) || !artifact.localPath.startsWith('references/'))
        errors.push(`Reference ${name} has an unsafe artifact path.`);
      if (!/^[a-f\d]{64}$/i.test(artifact?.sha256 ?? ''))
        errors.push(`Reference ${name} artifact requires SHA-256.`);
      if (!Number.isSafeInteger(artifact?.bytes) || artifact.bytes < 1)
        errors.push(`Reference ${name} artifact requires a positive byte count.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateHarness(rootDir) {
  const errors = REQUIRED_HARNESS_FILES.filter((file) => !existsSync(path.join(rootDir, file))).map(
    (file) => `Missing harness file: ${file}.`,
  );
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(rootDir, 'references/manifest.json'), 'utf8'),
    );
    errors.push(...validateReferenceManifest(manifest).errors);
  } catch (error) {
    errors.push(`Cannot read reference manifest: ${error.message}`);
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    for (const script of ['harness:check', 'evidence:check', 'merge-gate:check']) {
      if (typeof pkg.scripts?.[script] !== 'string' || !pkg.scripts[script].trim())
        errors.push(`Missing package script: ${script}.`);
    }
  } catch (error) {
    errors.push(`Cannot read package.json: ${error.message}`);
  }
  return { valid: errors.length === 0, errors };
}
