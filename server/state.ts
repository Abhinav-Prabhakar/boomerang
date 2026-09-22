// Task store + event bus, persisted to data/tasks.json so a restart never
// loses task state or consent context. Everything the UI renders flows through
// here; the file is a write-through cache (debounced) of the in-memory map.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export type TaskState =
  | 'briefed'
  | 'working'
  | 'blocked'
  | 'awaiting_consent'
  | 'approved'
  | 'rejected'
  | 'retried'           // failed run, user asked for a retry on the callback
  | 'shipped'
  | 'failed';

export interface WorkerEvent {
  ts: string;
  kind: 'progress' | 'file_edit' | 'test' | 'done' | 'error' | 'info';
  message: string;
}

export interface Task {
  id: string;
  brief: string;          // raw user brief (transcript or typed)
  repo: string;           // owner/name
  branch: string;         // worker branch
  state: TaskState;
  summary?: string;       // spoken callback summary
  diffStat?: string;
  prUrl?: string;
  error?: string;
  createdAt: string;
  events: WorkerEvent[];
  transcript: { role: 'user' | 'agent'; text: string; ts: string; session: 'brief' | 'callback' }[];
}

type Listener = (event: { type: string; data: unknown }) => void;

const tasks = new Map<string, Task>();
const listeners = new Set<Listener>();
let seq = 0;

// ── persistence ─────────────────────────────────────────────────────────────
const storeFile = () => {
  mkdirSync(config.dataDir, { recursive: true });
  return path.join(config.dataDir, 'tasks.json');
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 150);
}

export function saveNow() {
  try {
    const f = storeFile();
    const tmp = f + '.tmp';
    writeFileSync(tmp, JSON.stringify({ seq, tasks: [...tasks.values()] }, null, 2));
    renameSync(tmp, f); // atomic-ish: never a half-written store
  } catch (e) {
    console.error('[state] persist failed:', (e as Error).message);
  }
}

function load() {
  const f = storeFile();
  if (!existsSync(f)) return;
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    seq = data.seq || 0;
    for (const t of data.tasks || []) {
      // A restarted server can't resume an in-flight worker. Mark interrupted
      // tasks failed so the callback still fires on next dispatch and the UI
      // shows an honest state instead of a spinner forever.
      if (t.state === 'briefed' || t.state === 'working' || t.state === 'blocked') {
        t.state = 'failed';
        t.error = t.error || 'interrupted by server restart — re-dispatch to retry';
        t.events.push({
          ts: new Date().toISOString(), kind: 'error',
          message: 'Server restarted mid-run; worker did not resume.',
        });
      }
      tasks.set(t.id, t);
    }
    if (tasks.size) console.log(`[state] restored ${tasks.size} task(s) from ${f}`);
  } catch (e) {
    console.error('[state] could not load task store, starting fresh:', (e as Error).message);
  }
}
load();

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(type: string, data: unknown) {
  for (const fn of listeners) {
    try { fn({ type, data }); } catch { /* listener errors are non-fatal */ }
  }
}

export function createTask(brief: string, repo: string): Task {
  const t: Task = {
    id: `task-${Date.now().toString(36)}-${(++seq).toString().padStart(2, '0')}`,
    brief,
    repo,
    branch: `boomerang/${Date.now().toString(36)}`,
    state: 'briefed',
    createdAt: new Date().toISOString(),
    events: [],
    transcript: [],
  };
  tasks.set(t.id, t);
  scheduleSave();
  emit('task.created', t);
  return t;
}

export function getTask(id: string) { return tasks.get(id); }
export function listTasks() { return [...tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

export function updateTask(id: string, patch: Partial<Task>) {
  const t = tasks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  scheduleSave();
  emit('task.updated', t);
}

export function addWorkerEvent(id: string, ev: Omit<WorkerEvent, 'ts'>) {
  const t = tasks.get(id);
  if (!t) return;
  t.events.push({ ...ev, ts: new Date().toISOString() });
  scheduleSave();
  emit('task.event', { taskId: id, event: t.events[t.events.length - 1] });
}

export function addTranscript(id: string, role: 'user' | 'agent', text: string, session: 'brief' | 'callback') {
  const t = tasks.get(id);
  if (!t) return;
  const entry = { role, text, ts: new Date().toISOString(), session };
  t.transcript.push(entry);
  scheduleSave();
  emit('transcript', { taskId: id, entry });
}
