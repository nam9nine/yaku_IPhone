import { appendFileSync, readFileSync } from 'node:fs';
import { getPullRequestContext } from './lib/github.mjs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const context = await getPullRequestContext(
  process.env.GITHUB_REPOSITORY,
  event.pull_request.number,
);
const docsOnly =
  context.changedFiles.length > 0 &&
  context.changedFiles.every(
    (file) =>
      /^(?:docs\/|references\/|harness\/plans\/|\.agents\/skills\/)/.test(file) ||
      /^(?:README|AGENTS)\.md$/.test(file),
  );
appendFileSync(process.env.GITHUB_OUTPUT, `required=${!docsOnly}\n`);
const reason = docsOnly
  ? 'Browser execution omitted: all changed paths are documentation, plans, skills, or reference metadata.'
  : 'Browser execution required: application, test, tooling, or workflow paths changed.';
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `${reason}\n\nChecked PR head: ${context.headSha}\n`,
);
console.log(reason);
