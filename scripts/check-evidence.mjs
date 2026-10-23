#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractEvidence, validateEvidence } from './lib/evidence.mjs';
import { getPullRequestContext, githubJson } from './lib/github.mjs';

function option(name) {
  const position = process.argv.indexOf(name);
  if (position === -1) return undefined;
  const value = process.argv[position + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

try {
  const rootDir = path.resolve(option('--root') ?? process.cwd());
  const evidenceFile = option('--evidence');
  let evidence;
  let context;
  let repository;
  if (evidenceFile) {
    const changedFile = option('--changed-files');
    const headSha = option('--head-sha');
    const prBodyFile = option('--pr-body');
    if (!changedFile || !headSha || !prBodyFile)
      throw new Error(
        'Local validation requires --evidence, --head-sha, --changed-files, and --pr-body.',
      );
    evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
    context = {
      headSha,
      changedFiles: JSON.parse(readFileSync(changedFile, 'utf8')),
      author: option('--author'),
      prBody: readFileSync(prBodyFile, 'utf8'),
    };
  } else {
    if (!process.env.GITHUB_EVENT_PATH)
      throw new Error('Use a pull_request GitHub event or explicit local evidence arguments.');
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    repository = process.env.GITHUB_REPOSITORY ?? event.repository?.full_name;
    context = await getPullRequestContext(
      repository,
      event.pull_request?.number ?? event.number,
      process.env.GITHUB_TOKEN,
    );
    const checkedOutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();
    if (checkedOutSha !== context.headSha)
      throw new Error(
        'Checkout must be the current PR head, not the merge commit or an earlier head.',
      );
    evidence = extractEvidence(context.prBody);
  }
  const trackedFiles = new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  );
  const result = validateEvidence(evidence, { ...context, rootDir, trackedFiles, repository });
  if (!result.valid) throw new Error(result.errors.join('\n'));
  if (repository) {
    const issue = await githubJson(
      repository,
      `/issues/${evidence.issue}`,
      process.env.GITHUB_TOKEN,
    );
    if (issue.pull_request)
      throw new Error(`Issue #${evidence.issue} is a pull request, not an issue.`);
  }
  console.log(
    `Evidence passed for ${context.headSha}; issue #${evidence.issue}; visual review ${result.requiresVisual ? 'required' : 'classified'}.`,
  );
} catch (error) {
  console.error(`Evidence validation failed: ${error.message}`);
  process.exitCode = 1;
}
