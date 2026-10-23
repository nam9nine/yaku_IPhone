import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureAptMirror, replaceAzureMirror } from '../../scripts/configure-apt-mirror.mjs';

const fixtures = [];

function fixture(files) {
  const directory = mkdtempSync(join(tmpdir(), 'yaku-apt-'));
  fixtures.push(directory);
  mkdirSync(join(directory, 'sources.list.d'));
  for (const [path, contents] of Object.entries(files))
    writeFileSync(join(directory, path), contents);
  return directory;
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true });
});

describe('Ubuntu APT 미러 구성', () => {
  it('runner mirror 목록의 정확한 Azure 주소만 바꾸고 Deb822 설정을 보존한다', () => {
    const mirrors =
      'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n' +
      'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
      'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
    const deb822 =
      'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\n' +
      'Suites: noble noble-updates noble-backports noble-security\n' +
      'Components: main restricted universe multiverse\n' +
      'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
    const directory = fixture({
      'apt-mirrors.txt': mirrors,
      'sources.list.d/ubuntu.sources': deb822,
    });
    configureAptMirror(directory, () => {});
    expect(readFileSync(join(directory, 'apt-mirrors.txt'), 'utf8')).toBe(
      mirrors.replace('http://azure.archive.ubuntu.com', 'https://archive.ubuntu.com'),
    );
    expect(readFileSync(join(directory, 'sources.list.d/ubuntu.sources'), 'utf8')).toBe(deb822);
  });

  it('직접 URI가 있는 Deb822와 legacy 소스의 suite·component·키·다른 저장소는 유지한다', () => {
    const source =
      'URIs: https://azure.archive.ubuntu.com/ubuntu\nSuites: noble-updates\n' +
      'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' +
      'deb [arch=amd64 signed-by=/example.gpg] http://azure.archive.ubuntu.com/ubuntu/ noble main\n' +
      'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n';
    expect(replaceAzureMirror(source)).toBe(
      source
        .replace(
          'https://azure.archive.ubuntu.com/ubuntu\n',
          'https://archive.ubuntu.com/ubuntu/\n',
        )
        .replace('http://azure.archive.ubuntu.com', 'https://archive.ubuntu.com'),
    );
  });

  it('비슷한 호스트·경로·주석을 잘못 바꾸지 않는다', () => {
    const untouched =
      '# http://azure.archive.ubuntu.com/ubuntu/\n' +
      'https://azureXarchiveXubuntuXcom/ubuntu/\n' +
      'https://azure.archive.ubuntu.com.evil/ubuntu/\n' +
      'https://azure.archive.ubuntu.com/ubuntu-other/\n';
    expect(replaceAzureMirror(untouched)).toBe(untouched);
  });

  it('반복 실행은 이미 설정된 공식 미러를 바꾸지 않는다', () => {
    const directory = fixture({
      'apt-mirrors.txt': 'https://archive.ubuntu.com/ubuntu/\tpriority:1\n',
      'sources.list.d/ubuntu.sources':
        'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\nComponents: main\n',
    });
    configureAptMirror(directory, () => {});
    const configured = readFileSync(join(directory, 'apt-mirrors.txt'), 'utf8');
    configureAptMirror(directory, () => {});
    expect(readFileSync(join(directory, 'apt-mirrors.txt'), 'utf8')).toBe(configured);
  });

  it('지원하지 않는 Azure URI를 발견하면 어떤 파일도 일부만 수정하지 않는다', () => {
    const mirrors = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n';
    const source = 'URIs: http://azure.archive.ubuntu.com/unsupported/\n';
    const directory = fixture({
      'apt-mirrors.txt': mirrors,
      'sources.list.d/ubuntu.sources': source,
    });
    expect(() => configureAptMirror(directory, () => {})).toThrow('Unrecognized Azure APT URI');
    expect(readFileSync(join(directory, 'apt-mirrors.txt'), 'utf8')).toBe(mirrors);
    expect(readFileSync(join(directory, 'sources.list.d/ubuntu.sources'), 'utf8')).toBe(source);
  });

  it('소스가 없거나 예상 미러가 없는 환경은 성공으로 처리하지 않는다', () => {
    expect(() => configureAptMirror(fixture({}), () => {})).toThrow('source files are missing');
    const directory = fixture({ 'sources.list': 'deb https://example.com/ubuntu/ noble main\n' });
    expect(() => configureAptMirror(directory, () => {})).toThrow('No active Ubuntu APT source');
  });

  it('미러 목록만 있거나 실제 소스가 다른 미러 파일을 참조하면 실패한다', () => {
    const mirrors = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n';
    const orphan = fixture({ 'apt-mirrors.txt': mirrors });
    expect(() => configureAptMirror(orphan, () => {})).toThrow('No active Ubuntu APT source');
    expect(readFileSync(join(orphan, 'apt-mirrors.txt'), 'utf8')).toBe(mirrors);
    for (const [path, source] of [
      [
        'sources.list.d/ubuntu.sources',
        'Types: deb\nURIs: mirror+file:/etc/apt/different-mirrors.txt\nSuites: noble\n',
      ],
      ['sources.list', 'deb mirror+file:/etc/apt/different-mirrors.txt noble main\n'],
    ]) {
      const directory = fixture({ 'apt-mirrors.txt': mirrors, [path]: source });
      expect(() => configureAptMirror(directory, () => {})).toThrow('Unexpected active APT mirror');
      expect(readFileSync(join(directory, 'apt-mirrors.txt'), 'utf8')).toBe(mirrors);
      expect(readFileSync(join(directory, path), 'utf8')).toBe(source);
    }
  });

  it('주석·비활성 stanza·소스 패키지 항목을 활성 binary 저장소 연결로 오인하지 않는다', () => {
    const directory = fixture({
      'apt-mirrors.txt': 'https://archive.ubuntu.com/ubuntu/\tpriority:1\n',
      'sources.list.d/ubuntu.sources':
        '# Types: deb\n# URIs: mirror+file:/etc/apt/apt-mirrors.txt\n\n' +
        'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu/\nEnabled: no\n\n' +
        'Types: deb-src\nURIs: https://archive.ubuntu.com/ubuntu/\n',
      'sources.list': '# deb https://archive.ubuntu.com/ubuntu/ noble main\n',
    });
    expect(() => configureAptMirror(directory, () => {})).toThrow('No active Ubuntu APT source');
  });

  it('Deb822 직접 주소와 legacy 직접 주소 연결은 다른 저장소를 그대로 두고 처리한다', () => {
    for (const [path, source] of [
      [
        'sources.list.d/ubuntu.sources',
        'Types: deb deb-src\nURIs:\n https://azure.archive.ubuntu.com/ubuntu/\nSuites: noble\n\nTypes: deb\nURIs: https://packages.microsoft.com/ubuntu/24.04/prod\nSuites: noble\n',
      ],
      [
        'sources.list',
        'deb [arch=amd64 signed-by=/example.gpg] http://azure.archive.ubuntu.com/ubuntu/ noble main\ndeb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n',
      ],
    ]) {
      const directory = fixture({ [path]: source });
      configureAptMirror(directory, () => {});
      expect(readFileSync(join(directory, path), 'utf8')).toBe(replaceAzureMirror(source));
    }
  });

  it('정확한 미러 파일을 참조하더라도 그 목록이 없으면 실패한다', () => {
    const directory = fixture({
      'sources.list': 'deb mirror+file:/etc/apt/apt-mirrors.txt noble main\n',
    });
    expect(() => configureAptMirror(directory, () => {})).toThrow('active APT mirror list');
  });
});
