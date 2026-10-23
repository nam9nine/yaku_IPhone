import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

const SHA_PATTERN = /^[a-f\d]{40}$/i;
const OPEN_MARKER = '<!-- harness-evidence -->';
const CLOSE_MARKER = '<!-- /harness-evidence -->';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizeIdentity = (value) => value.trim().replace(/^@/, '').toLowerCase();

export function extractEvidence(body) {
  if (
    typeof body !== 'string' ||
    body.split(OPEN_MARKER).length !== 2 ||
    body.split(CLOSE_MARKER).length !== 2
  ) {
    throw new Error('PR body must contain exactly one harness-evidence marker pair.');
  }
  const start = body.indexOf(OPEN_MARKER) + OPEN_MARKER.length;
  const end = body.indexOf(CLOSE_MARKER);
  if (end < start) throw new Error('harness-evidence markers are out of order.');
  let json = body.slice(start, end).trim();
  if (json.startsWith('```')) {
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(json);
    if (!fenced)
      throw new Error('Evidence must be one JSON object, optionally inside a JSON code fence.');
    json = fenced[1];
  }
  try {
    const evidence = JSON.parse(json);
    if (!isObject(evidence)) throw new Error('Expected a JSON object.');
    return evidence;
  } catch (error) {
    throw new Error(`Invalid harness evidence JSON: ${error.message}`, { cause: error });
  }
}

export function isBaselineChange(file) {
  return (
    /(^|\/)(?:__snapshots__|__screenshots__|[^/]+-snapshots|baselines?|snapshots?)(?:\/|$)/i.test(
      file,
    ) || /\.snap$/i.test(file)
  );
}

export function hasClosingIssueLink(body, issue, repository) {
  if (typeof body !== 'string' || !Number.isSafeInteger(issue) || issue < 1) return false;
  const prose = body
    .replace(/<!-- harness-evidence -->[\s\S]*?<!-- \/harness-evidence -->/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '');
  const links = prose.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([a-z\d_.-]+\/[a-z\d_.-]+))?#(\d+)\b/gi,
  );
  return [...links].some(
    (match) =>
      Number(match[2]) === issue &&
      (!match[1] || (repository && match[1].toLowerCase() === repository.toLowerCase())),
  );
}

export function isUiChange(files) {
  return files.some((file) => {
    if (isBaselineChange(file)) return true;
    if (/^(?:references|docs)\//.test(file)) return false;
    return (
      /^(?:src|app|pages|public|assets|styles|components)\//.test(file) ||
      /(^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|(?:playwright|vite)(?:\.[^./]+)*\.config\.[^/]+)$/.test(
        file,
      ) ||
      /(?:^|\/)(?:tests\/)?(?:browser|e2e|visual)\//.test(file) ||
      /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)$/i.test(file)
    );
  });
}

export function isSafeRelativePath(file) {
  return (
    hasText(file) &&
    file === file.trim() &&
    !file.includes('\\') &&
    !file.includes('\0') &&
    !path.posix.isAbsolute(file) &&
    !/^[a-z][a-z\d+.-]*:/i.test(file) &&
    !file.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}

function validateReview(review, name, author, errors) {
  if (!isObject(review)) {
    errors.push(`${name} must contain an independent reviewer, verdict, and summary.`);
    return;
  }
  if (!hasText(review.reviewer)) {
    errors.push(`${name}.reviewer must identify the independent reviewer.`);
  } else {
    const identity = normalizeIdentity(review.reviewer);
    if (
      ['self', 'author', 'implementer', 'me', 'n/a', 'none'].includes(identity) ||
      (hasText(author) && identity === normalizeIdentity(author))
    ) {
      errors.push(`${name}.reviewer must be different from the PR author/implementer.`);
    }
  }
  if (review.verdict !== 'pass') errors.push(`${name}.verdict must be pass.`);
  if (!hasText(review.summary))
    errors.push(`${name}.summary must describe what was independently reviewed.`);
}

function isImageFile(file, bytes) {
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) || bytes.length < 16) return false;
  if (ext === '.png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === '.jpg' || ext === '.jpeg')
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}

function validateArtifact(file, { rootDir, trackedFiles }, errors) {
  if (!isSafeRelativePath(file)) {
    errors.push(
      `Invalid screenshot artifact path: ${String(file)}. Use a repository-relative file path.`,
    );
    return;
  }
  if (!(trackedFiles instanceof Set) || !trackedFiles.has(file)) {
    errors.push(`Screenshot artifact is not tracked by git: ${file}.`);
    return;
  }
  const absolutePath = path.resolve(rootDir, file);
  if (!existsSync(absolutePath)) {
    errors.push(`Screenshot artifact does not exist: ${file}.`);
    return;
  }
  const relativeRealPath = path.relative(realpathSync(rootDir), realpathSync(absolutePath));
  if (
    relativeRealPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeRealPath) ||
    !statSync(absolutePath).isFile()
  ) {
    errors.push(`Screenshot artifact must be a file within the repository: ${file}.`);
    return;
  }
  if (!isImageFile(file, readFileSync(absolutePath))) {
    errors.push(`Screenshot artifact must be a PNG, JPEG, or WebP image: ${file}.`);
  }
}

export function validateEvidence(input, options = {}) {
  const errors = [];
  const { headSha, changedFiles, rootDir, author, trackedFiles, referenceIds, prBody, repository } =
    options;
  const hasRoot = hasText(rootDir) && existsSync(rootDir) && statSync(rootDir).isDirectory();
  if (!hasRoot) errors.push('A readable repository root directory is required.');
  if (!SHA_PATTERN.test(headSha ?? ''))
    errors.push('The current PR head SHA must be a full 40-character SHA.');
  if (!Array.isArray(changedFiles) || changedFiles.some((file) => !isSafeRelativePath(file))) {
    errors.push('Changed files must be an authoritative array of repository-relative paths.');
  }
  const files = Array.isArray(changedFiles)
    ? changedFiles.filter((file) => typeof file === 'string')
    : [];
  const requiresVisual = isUiChange(files);
  if (!isObject(input))
    return { valid: false, errors: [...errors, 'Evidence must be a JSON object.'], requiresVisual };
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!SHA_PATTERN.test(input.headSha ?? '') || input.headSha !== headSha)
    errors.push('Evidence headSha is missing or stale; it must match the current PR head SHA.');
  if (!Number.isSafeInteger(input.issue) || input.issue < 1)
    errors.push('Evidence must link a positive GitHub issue number.');
  if (!hasClosingIssueLink(prBody, input.issue, repository))
    errors.push('PR prose must close the evidence issue with Closes/Fixes/Resolves #<issue>.');
  validateReview(input.review, 'review', author, errors);
  if (
    !isObject(input.environment) ||
    ['platform', 'node', 'playwright'].some((key) => !hasText(input.environment[key]))
  )
    errors.push('environment must describe platform, node, and playwright versions.');
  if (
    !Array.isArray(input.checks) ||
    input.checks.length === 0 ||
    input.checks.some(
      (check) =>
        !isObject(check) ||
        !hasText(check.command) ||
        !hasText(check.details) ||
        !['pass', 'fail', 'not-run'].includes(check.result),
    )
  ) {
    errors.push('checks must record executed commands, results, and observed details.');
  }
  const requiredCommands = [
    'npm run check',
    ...(requiresVisual ? ['npm run test:e2e', 'npm run test:visual'] : []),
  ];
  for (const command of requiredCommands) {
    const results = Array.isArray(input.checks)
      ? input.checks.filter((check) => check?.command === command)
      : [];
    if (results.length === 0 || results.some((check) => check.result !== 'pass'))
      errors.push(`Required verification must pass: ${command}.`);
  }

  const visual = input.visual;
  if (!isObject(visual))
    return { valid: false, errors: [...errors, 'visual evidence is required.'], requiresVisual };
  if (!['pass', 'not-applicable'].includes(visual.status))
    errors.push('visual.status must be pass or not-applicable.');
  const baselineChanged = files.some(isBaselineChange);
  if (typeof visual.baselineChanged !== 'boolean' || visual.baselineChanged !== baselineChanged) {
    errors.push('visual.baselineChanged must agree with the changed baseline/snapshot paths.');
  }
  if (baselineChanged)
    validateReview(visual.baselineReview, 'visual.baselineReview', author, errors);
  if (visual.status === 'not-applicable') {
    if (requiresVisual)
      errors.push('UI or browser-test changes require visual.status pass and screenshot evidence.');
    if (!hasText(visual.reason))
      errors.push('visual.reason must explain why visual review is not applicable.');
  }
  if (visual.status === 'pass') {
    if (
      !Array.isArray(visual.scenes) ||
      visual.scenes.length === 0 ||
      visual.scenes.some((scene) => !hasText(scene))
    )
      errors.push('visual.scenes must describe the captured screen states and viewport sizes.');
    if (
      !Array.isArray(visual.references) ||
      visual.references.length === 0 ||
      visual.references.some((id) => !hasText(id))
    ) {
      errors.push('visual.references must contain reference manifest source IDs.');
    } else {
      let ids = referenceIds;
      if (!(ids instanceof Set)) {
        try {
          const manifest = JSON.parse(
            readFileSync(path.join(rootDir, 'references/manifest.json'), 'utf8'),
          );
          if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources))
            throw new Error('Invalid reference manifest.');
          ids = new Set(manifest.sources.map((source) => source.id));
        } catch (error) {
          errors.push(`Cannot validate reference IDs: ${error.message}`);
          ids = new Set();
        }
      }
      for (const id of visual.references)
        if (!ids.has(id)) errors.push(`Unknown reference source ID: ${id}.`);
    }
    if (!Array.isArray(visual.artifacts) || visual.artifacts.length === 0) {
      errors.push('visual.artifacts must contain at least one tracked screenshot file.');
    } else {
      if (hasRoot)
        for (const file of visual.artifacts)
          validateArtifact(file, { rootDir, trackedFiles }, errors);
    }
    if (!hasText(visual.comparison))
      errors.push(
        'visual.comparison must describe the actual screenshot comparison and any remaining differences.',
      );
  }
  return { valid: errors.length === 0, errors, requiresVisual };
}
