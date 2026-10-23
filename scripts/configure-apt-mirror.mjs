import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sourcePaths = ['apt-mirrors.txt', 'sources.list.d/ubuntu.sources', 'sources.list'];
const azureUri = /(^|[\t ])https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?(?=[\t \r\n]|$)/g;
const expectedMirror = 'mirror+file:/etc/apt/apt-mirrors.txt';
const officialArchive = /^https?:\/\/archive\.ubuntu\.com\/ubuntu\/?$/;

function activeSourceUris(name, source) {
  const uncommented = source.replace(/\r\n/g, '\n').replace(/^[\t ]*#.*(?:\n|$)/gm, '');
  if (name === 'sources.list') {
    return [...uncommented.matchAll(/^[\t ]*deb[\t ]+(?:\[[^\]\r\n]*\][\t ]+)?(\S+)/gm)].map(
      (match) => match[1],
    );
  }
  return uncommented.split(/\r?\n[\t ]*\r?\n/).flatMap((stanza) => {
    const unfolded = stanza.replace(/\r?\n[\t ]+/g, ' ');
    if (/^Enabled:[\t ]*no[\t ]*$/im.test(unfolded)) return [];
    const types = /^Types:[\t ]*(.*)$/im.exec(unfolded)?.[1].trim().split(/\s+/) ?? [];
    if (!types.includes('deb')) return [];
    return /^URIs:[\t ]*(.*)$/im.exec(unfolded)?.[1].trim().split(/\s+/) ?? [];
  });
}

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
    .map((name) => ({ name, path: join(aptDirectory, name) }))
    .filter(({ path }) => existsSync(path))
    .map(({ name, path }) => {
      const before = readFileSync(path, 'utf8');
      return { name, path, before, after: replaceAzureMirror(before) };
    });
  if (sources.length === 0) throw new Error('Expected Ubuntu APT source files are missing.');

  for (const source of sources) {
    log(`APT source before: ${source.path}\n${source.before}`);
  }
  const activeSources = sources.map(({ after }) => after.replace(/^\s*#.*$/gm, '')).join('\n');
  if (/https?:\/\/azure\.archive\.ubuntu\.com(?=[/:\s]|$)/.test(activeSources)) {
    throw new Error('Unrecognized Azure APT URI; refusing a partial mirror change.');
  }
  const activeUris = sources
    .filter(({ name }) => name !== 'apt-mirrors.txt')
    .flatMap(({ name, after }) => activeSourceUris(name, after));
  if (activeUris.some((uri) => uri.startsWith('mirror+file:') && uri !== expectedMirror)) {
    throw new Error('Unexpected active APT mirror file reference; refusing a partial change.');
  }
  const mirrorList = sources.find(({ name }) => name === 'apt-mirrors.txt')?.after ?? '';
  const mirrorHasArchive = mirrorList
    .split(/\r?\n/)
    .some((line) => officialArchive.test(line.trim().split(/\s+/)[0]));
  if (activeUris.includes(expectedMirror) && !mirrorHasArchive) {
    throw new Error('The active APT mirror list does not contain the official Ubuntu archive.');
  }
  if (
    !activeUris.some((uri) => officialArchive.test(uri)) &&
    !activeUris.includes(expectedMirror)
  ) {
    throw new Error('No active Ubuntu APT source is connected to the official archive.');
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
