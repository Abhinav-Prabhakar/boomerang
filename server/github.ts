// GitHub actions — the ONLY two side effects in scope: open a PR, or reject.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function createPullRequest(opts: {
  repoDir: string;
  repo: string;
  branch: string;
  title: string;
  body: string;
}): Promise<string> {
  const { stdout } = await run('gh', [
    'pr', 'create',
    '--repo', opts.repo,
    '--head', opts.branch,
    '--title', opts.title,
    '--body', opts.body,
  ], { cwd: opts.repoDir });
  return stdout.trim();
}
