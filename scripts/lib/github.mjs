const API_ROOT = 'https://api.github.com';

export async function githubJson(repository, resource, token = process.env.GITHUB_TOKEN) {
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository))
    throw new Error('Invalid GitHub repository name.');
  if (!/^\/(?:pulls|issues)\/\d+(?:\/files\?per_page=100&page=\d+)?$/.test(resource)) {
    throw new Error('Unsupported GitHub API resource.');
  }
  const response = await fetch(`${API_ROOT}/repos/${repository}${resource}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`GitHub API returned ${response.status} for ${resource.split('?')[0]}.`);
  return response.json();
}

export async function getPullRequestContext(repository, number, token) {
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error('A pull request number is required.');
  const pr = await githubJson(repository, `/pulls/${number}`, token);
  if (!Number.isSafeInteger(pr.changed_files) || pr.changed_files > 3_000) {
    throw new Error('Cannot obtain a complete changed-file list for this pull request.');
  }
  const changedFiles = [];
  let count = 0;
  for (let page = 1; count < pr.changed_files; page += 1) {
    const files = await githubJson(
      repository,
      `/pulls/${number}/files?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(files) || files.length === 0)
      throw new Error('GitHub returned an incomplete changed-file list.');
    count += files.length;
    for (const file of files) {
      changedFiles.push(file.filename);
      if (file.previous_filename) changedFiles.push(file.previous_filename);
    }
  }
  if (count !== pr.changed_files)
    throw new Error('GitHub returned an inconsistent changed-file list.');
  const currentPr = await githubJson(repository, `/pulls/${number}`, token);
  if (currentPr.head?.sha !== pr.head?.sha || currentPr.changed_files !== pr.changed_files) {
    throw new Error('PR changed during evidence validation; retry with the latest head.');
  }
  return {
    prBody: currentPr.body ?? '',
    headSha: currentPr.head?.sha,
    author: currentPr.user?.login,
    changedFiles: [...new Set(changedFiles)],
  };
}
