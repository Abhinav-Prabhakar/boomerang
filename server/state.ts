// In-memory task store + event bus. Everything the UI renders flows through here.

export type TaskState =
  | 'briefed'
  | 'working'
  | 'blocked'
  | 'awaiting_consent'
  | 'approved'
  | 'rejected'
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
  emit('task.created', t);
  return t;
}

export function getTask(id: string) { return tasks.get(id); }
export function listTasks() { return [...tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

export function updateTask(id: string, patch: Partial<Task>) {
  const t = tasks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  emit('task.updated', t);
}

export function addWorkerEvent(id: string, ev: Omit<WorkerEvent, 'ts'>) {
  const t = tasks.get(id);
  if (!t) return;
  t.events.push({ ...ev, ts: new Date().toISOString() });
  emit('task.event', { taskId: id, event: t.events[t.events.length - 1] });
}

export function addTranscript(id: string, role: 'user' | 'agent', text: string, session: 'brief' | 'callback') {
  const t = tasks.get(id);
  if (!t) return;
  const entry = { role, text, ts: new Date().toISOString(), session };
  t.transcript.push(entry);
  emit('transcript', { taskId: id, entry });
}
