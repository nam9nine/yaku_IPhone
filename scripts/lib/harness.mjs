import { existsSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  const artifactPaths = new Set();
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
    const date = source?.retrievedOn;
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      errors.push(`Reference ${name} requires a valid retrievedOn calendar date.`);
    if (
      !Array.isArray(source?.keyPaths) ||
      source.keyPaths.some((file) => !isSafeRelativePath(file)) ||
      (source.type === 'repository' && source.keyPaths.length === 0)
    )
      errors.push(`Reference ${name} requires safe keyPaths (nonempty for repositories).`);
    if (
      !source?.license ||
      typeof source.license.status !== 'string' ||
      !source.license.status.trim()
    )
      errors.push(`Reference ${name} requires license status.`);
    if (typeof source?.purpose !== 'string' || !source.purpose.trim())
      errors.push(`Reference ${name} requires its intended purpose.`);
    if (!Array.isArray(source?.artifacts) || source.artifacts.length === 0) {
      errors.push(`Reference ${name} requires a nonempty artifacts array.`);
      continue;
    }
    if (
      source.type === 'repository' &&
      !source.artifacts.some((artifact) => artifact.role === 'archive')
    )
      errors.push(`Repository reference ${name} requires a pinned archive.`);
    if (
      source.license?.status === 'license-file-reviewed' &&
      (!isSafeRelativePath(source.license.localPath) ||
        !source.license.localPath.startsWith('references/licenses/') ||
        !source.artifacts.some(
          (artifact) =>
            artifact.role === 'license' && artifact.localPath === source.license.localPath,
        ))
    )
      errors.push(`Reference ${name} requires a matching preserved license artifact.`);
    for (const artifact of source.artifacts) {
      let artifactUrl;
      try {
        artifactUrl = new URL(artifact?.url);
      } catch {
        /* Report below. */
      }
      if (
        !artifactUrl ||
        artifactUrl.protocol !== 'https:' ||
        artifactUrl.username ||
        artifactUrl.password
      )
        errors.push(`Reference ${name} requires an HTTPS artifact URL without credentials.`);
      if (!['archive', 'license', 'html', 'image'].includes(artifact?.role))
        errors.push(`Reference ${name} artifact requires a supported role.`);
      if (
        artifact?.role === 'archive' &&
        !artifactUrl?.pathname.split('/').includes(source.commitSha)
      )
        errors.push(`Reference ${name} archive URL must pin its commit SHA.`);
      if (!isSafeRelativePath(artifact?.localPath) || !artifact.localPath.startsWith('references/'))
        errors.push(`Reference ${name} has an unsafe artifact path.`);
      if (artifactPaths.has(artifact?.localPath))
        errors.push(`Duplicate artifact path: ${artifact.localPath}.`);
      artifactPaths.add(artifact?.localPath);
      if (!/^[a-f\d]{64}$/i.test(artifact?.sha256 ?? ''))
        errors.push(`Reference ${name} artifact requires SHA-256.`);
      if (!Number.isSafeInteger(artifact?.bytes) || artifact.bytes < 1)
        errors.push(`Reference ${name} artifact requires a positive byte count.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateLicenseArtifacts(manifest, rootDir, trackedFiles) {
  const errors = [];
  for (const source of manifest.sources ?? []) {
    if (source?.license?.status !== 'license-file-reviewed') continue;
    const file = source.license.localPath;
    if (!isSafeRelativePath(file) || !file.startsWith('references/licenses/')) continue;
    const artifact = source.artifacts?.find(
      (entry) => entry.role === 'license' && entry.localPath === file,
    );
    if (!artifact) continue;
    if (!trackedFiles.has(file)) errors.push(`License must be tracked by Git: ${file}.`);
    try {
      const fullPath = path.join(rootDir, file);
      const relativePath = path.relative(realpathSync(rootDir), realpathSync(fullPath));
      if (
        !lstatSync(fullPath).isFile() ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      )
        throw new Error('License is not a regular repository file.');
      const bytes = readFileSync(fullPath);
      if (
        bytes.length !== artifact.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
      )
        errors.push(`License integrity mismatch: ${file}.`);
    } catch {
      errors.push(`Missing preserved license: ${file}.`);
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
    const trackedFiles = new Set(
      execFileSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' }).split('\0'),
    );
    errors.push(...validateLicenseArtifacts(manifest, rootDir, trackedFiles).errors);
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
