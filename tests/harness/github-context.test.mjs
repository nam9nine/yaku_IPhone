import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPullRequestContext, githubJson } from '../../scripts/lib/github.mjs';

const sha = 'a'.repeat(40);
const pr = (overrides = {}) => ({
  head: { sha },
  user: { login: 'pr-author' },
  body: 'Closes #1',
  changed_files: 1,
  ...overrides,
});
const response = (body) => ({ ok: true, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('authoritative GitHub PR context', () => {
  it('fetches the latest body and includes both sides of a renamed baseline', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(pr()))
      .mockResolvedValueOnce(
        response([
          {
            filename: 'harness/evidence/home.png',
            previous_filename: 'harness/baselines/home.png',
          },
        ]),
      )
      .mockResolvedValueOnce(response(pr({ body: 'Closes #1\nUpdated evidence.' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getPullRequestContext('owner/repo', 2, 'test-token')).resolves.toEqual({
      prBody: 'Closes #1\nUpdated evidence.',
      headSha: sha,
      author: 'pr-author',
      changedFiles: ['harness/evidence/home.png', 'harness/baselines/home.png'],
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo/pulls/2');
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  });

  it('rejects a head change during validation instead of validating evidence against a mixed diff', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(pr()))
        .mockResolvedValueOnce(response([{ filename: 'src/App.tsx' }]))
        .mockResolvedValueOnce(response(pr({ head: { sha: 'b'.repeat(40) } }))),
    );
    await expect(getPullRequestContext('owner/repo', 2)).rejects.toThrow(
      'PR changed during evidence validation',
    );
  });

  it('rejects truncated and oversized diffs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(response(pr())).mockResolvedValueOnce(response([])),
    );
    await expect(getPullRequestContext('owner/repo', 2)).rejects.toThrow(
      'incomplete changed-file list',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(pr({ changed_files: 3001 }))));
    await expect(getPullRequestContext('owner/repo', 2)).rejects.toThrow(
      'complete changed-file list',
    );
  });

  it('never fetches arbitrary URLs or hides API failure as success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(githubJson('https://outside.test', '/pulls/2')).rejects.toThrow(
      'Invalid GitHub repository',
    );
    await expect(githubJson('owner/repo', '/../../secrets')).rejects.toThrow(
      'Unsupported GitHub API',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(githubJson('owner/repo', '/pulls/2')).rejects.toThrow('GitHub API returned 403');
  });
});
