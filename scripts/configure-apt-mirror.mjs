import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sourcePaths = ['apt-mirrors.txt', 'sources.list.d/ubuntu.sources', 'sources.list'];
const azureUri = /(^|[\t ])https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?(?=[\t \r\n]|$)/g;

export function replaceAzureMirror(source) {
  return source
    .split(/(?<=\n)/)
    .map((line) =>
      /^\s*#/.test(line) ? line : line.replace(azureUri, '$1https://archive.ubuntu.com/ubuntu/'),
    )
    .join('');
}

export function configureAptMirror(aptDirectory = '/etc/apt', log = console.log) {
  const sources = sourcePaths
    .map((name) => join(aptDirectory, name))
    .filter((path) => existsSync(path))
    .map((path) => {
      const before = readFileSync(path, 'utf8');
      return { path, before, after: replaceAzureMirror(before) };
    });
  if (sources.length === 0) throw new Error('Expected Ubuntu APT source files are missing.');

  for (const source of sources) {
    log(`APT source before: ${source.path}\n${source.before}`);
  }
  const activeSources = sources.map(({ after }) => after.replace(/^\s*#.*$/gm, '')).join('\n');
  if (/https?:\/\/azure\.archive\.ubuntu\.com(?=[/:\s]|$)/.test(activeSources)) {
    throw new Error('Unrecognized Azure APT URI; refusing a partial mirror change.');
  }
  if (!/https:\/\/archive\.ubuntu\.com\/ubuntu\/?(?=\s|$)/.test(activeSources)) {
    throw new Error('Official Ubuntu archive URI was not found in the APT source files.');
  }

  for (const { path, before, after } of sources) {
    if (after !== before) writeFileSync(path, after);
    log(`APT source effective: ${path}\n${after}`);
  }
}

if (import.meta.main) {
  const osRelease = readFileSync('/etc/os-release', 'utf8');
  if (!/^ID=ubuntu$/m.test(osRelease) || !/^VERSION_ID="24\.04"$/m.test(osRelease)) {
    throw new Error('This mirror configuration supports the Ubuntu 24.04 runner only.');
  }
  console.log(`APT mirror setup: ${new Date().toISOString()}`);
  configureAptMirror();
}
