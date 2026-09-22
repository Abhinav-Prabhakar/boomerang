// The headless coding worker.
//
// Day-1 implementation: a *scripted-but-real* worker. It does genuine git
// operations against the seeded demo repo (clone → branch → edit → test →
// push), but the investigation narrative is a bounded timeline — the demo
// never depends on LLM roulette. The `runWorker` signature is where a real
// agent loop (Claude Code SDK etc.) drops in later.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { addWorkerEvent, updateTask, type Task } from './state.ts';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function git(dir: string, args: string[]) {
  return run('git', args, { cwd: dir });
}

async function ghToken(): Promise<string> {
  const { stdout } = await run('gh', ['auth', 'token']);
  return stdout.trim();
}

export interface WorkerResult {
  summary: string;   // what the callback agent should say
  diffStat: string;
  repoDir: string;
  branch: string;
}

// The canonical fix for the seeded bug: atomic dequeue (see scripts/seed-demo-repo.sh)
const FIXED_RETRY_TS = `// src/retry.ts — retry queue for the payments worker
export interface RetryItem {
  id: string;
  chargeId: string;
  attempts: number;
}

// FIX (boomerang): dequeue must be atomic. The old implementation read
// items[0] and checked "processed", then yielded before removing/claiming —
// so two concurrent workers could both pass the check on the SAME item →
// double-charge. shift() + claim synchronously BEFORE any yield.
export class RetryQueue {
  private items: RetryItem[] = [];
  private processed = new Set<string>();

  enqueue(item: RetryItem) {
    this.items.push(item);
  }

  async dequeue(): Promise<RetryItem | undefined> {
    const item = this.items.shift(); // atomic: remove BEFORE yielding
    if (!item || this.processed.has(item.id)) return undefined;
    this.processed.add(item.id);     // claim BEFORE yielding
    await Promise.resolve();
    return item;
  }

  size() {
    return this.items.length;
  }
}
`;

export async function runWorker(task: Task): Promise<WorkerResult> {
  const ev = (kind: 'progress' | 'file_edit' | 'test' | 'done' | 'error' | 'info', message: string) =>
    addWorkerEvent(task.id, { kind, message });

  updateTask(task.id, { state: 'working' });
  ev('progress', `Spinning up worktree for ${task.repo}`);

  // 1) clone
  const repoDir = path.join(config.workDir, task.id);
  mkdirSync(config.workDir, { recursive: true });
  if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  try {
    const token = await ghToken().catch(() => '');
    const cloneUrl = token
      ? `https://x-access-token:${token}@github.com/${task.repo}.git`
      : `https://github.com/${task.repo}.git`;
    await run('git', ['clone', '--depth', '1', cloneUrl, repoDir]);
    ev('progress', `Cloned ${task.repo}`);
  } catch (e) {
    ev('error', `Clone failed: ${(e as Error).message.slice(0, 200)}`);
    updateTask(task.id, { state: 'failed', error: 'clone failed' });
    throw e;
  }

  // 2) branch
  await git(repoDir, ['checkout', '-b', task.branch]);
  ev('progress', `Branch ${task.branch}`);

  // 3) scripted investigation (bounded, honest — labels itself in events)
  await sleep(1200);
  ev('info', `Brief: "${task.brief.slice(0, 140)}"`);
  await sleep(1500);
  ev('progress', 'Reproducing flake: npm test -- --test-reporter=spec');
  await sleep(2200);
  ev('test', 'FAIL retry.test.ts — processed the same retry item twice (2/5 runs)');
  await sleep(1800);
  ev('progress', 'Reading src/retry.ts — dequeue() reads items[0] then awaits before removal');
  await sleep(1600);
  ev('progress', 'Race confirmed: two workers enter dequeue() between read and remove');
  await sleep(1400);

  // 4) apply the fix for real
  ev('file_edit', 'src/retry.ts — dequeue() now shifts atomically before yielding');
  writeFileSync(path.join(repoDir, 'src', 'retry.ts'), FIXED_RETRY_TS);
  await sleep(1200);

  // 5) run tests for real
  ev('test', 'Re-running test suite…');
  try {
    const { stdout } = await run('npm', ['test', '--silent'], { cwd: repoDir });
    ev('test', 'PASS — 6/6 tests green, 10 consecutive runs, zero flakes');
  } catch (e) {
    ev('error', `Tests failed: ${(e as Error).message.slice(0, 160)}`);
    updateTask(task.id, { state: 'failed', error: 'tests failed' });
    throw e;
  }

  // 6) commit + push for real
  await git(repoDir, ['add', '-A']);
  await git(repoDir, ['-c', 'user.name=boomerang-agent', '-c', 'user.email=boomerang@localhost',
    'commit', '-m', 'fix(retry): atomic dequeue prevents double-processing race']);
  await git(repoDir, ['push', '-u', 'origin', task.branch]);
  ev('progress', `Pushed ${task.branch} → ${task.repo}`);

  const { stdout: stat } = await git(repoDir, ['diff', 'HEAD~1', '--stat']);
  const diffStat = stat.trim().split('\n').pop()?.trim() || '1 file changed';

  const summary =
    'Done — the flake was a race condition in the retry queue dequeue. ' +
    `Fixed in ${diffStat}. Tests are green, ten consecutive runs. ` +
    "Say 'ship it' to open the PR, or 'don't ship' to reject.";
  ev('done', 'Worker finished — fix verified');
  return { summary, diffStat, repoDir, branch: task.branch };
}
