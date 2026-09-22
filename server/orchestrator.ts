// The Boomerang orchestrator: brief → work → CALLBACK → consent → action.
import { createTask, updateTask, addTranscript, getTask, emit, type Task } from './state.ts';
import { runWorker } from './worker.ts';
import { createVoiceSession, type VoiceSession } from './voice.ts';
import { writeReceipt, hashTranscript } from './receipts.ts';
import { createPullRequest } from './github.ts';
import { config } from './config.ts';

const CONSENT_TOOLS = [
  {
    name: 'approve_ship',
    description: 'User verbally approved shipping the fix — open the pull request.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'reject_ship',
    description: 'User verbally rejected shipping — do NOT open the PR.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: [] },
  },
  {
    name: 'get_details',
    description: 'User asked for more detail about the fix before deciding.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

const sessions = new Map<string, VoiceSession>();

// ── Session 1: intake brief ────────────────────────────────────────────────
export function dispatch(brief: string): Task {
  const task = createTask(brief, config.demoRepo);
  addTranscript(task.id, 'user', brief, 'brief');
  addTranscript(task.id, 'agent',
    `On it. Working ${task.repo} on branch ${task.branch}. I'll call you back when it's done.`,
    'brief');

  runWorker(task)
    .then((result) => {
      updateTask(task.id, {
        state: 'awaiting_consent',
        summary: result.summary,
        diffStat: result.diffStat,
      });
      startCallback(task.id);
    })
    .catch((e) => {
      updateTask(task.id, { state: 'failed', error: (e as Error).message });
      startCallback(task.id); // call back on failure too — escalation is the product
    });
  return task;
}

// ── Session 2: the callback — agent INITIATES contact ──────────────────────
export function startCallback(taskId: string) {
  const task = getTask(taskId);
  if (!task) return;
  emit('callback.started', { taskId });

  const failed = task.state === 'failed';
  const session = createVoiceSession({
    systemPrompt: failed
      ? `You are Boomerang, a voice pager for coding agents. The worker FAILED on task ${task.id}. ` +
        `Tell the user what went wrong in one breath and offer to retry or cancel. Be brief — this is a pager, not a chat.`
      : `You are Boomerang, a voice pager for coding agents. The worker finished task ${task.id}. ` +
        `Deliver the summary in under 15 seconds, then hold for a verbal decision. ` +
        `"Ship it" or clear approval → approve_ship. Any rejection → reject_ship. ` +
        `Questions → get_details. Never act without an explicit verbal decision.`,
    voice: 'alloy',
    tools: CONSENT_TOOLS,
    keyterms: ['retry.ts', task.repo.split('/')[1], 'pull request', task.branch],
    context: failed ? `Worker error: ${task.error}` : task.summary,
    greeting: failed
      ? `Boomerang callback. The run on ${task.repo} hit a wall.`
      : `Boomerang callback.`,
  });
  sessions.set(taskId, session);

  session.on('transcript.user', (t: string) => addTranscript(taskId, 'user', t, 'callback'));
  session.on('transcript.agent', (t: string) => {
    addTranscript(taskId, 'agent', t, 'callback');
    emit('callback.speech', { taskId, text: t });
  });
  session.on('reply.audio', (buf: Buffer) => emit('callback.audio', { taskId, audio: buf.toString('base64') }));
  session.on('tool.call', (call: { name: string; arguments?: { reason?: string } }) => {
    if (call.name === 'approve_ship') decide(taskId, 'approved', lastUserUtterance(taskId) || 'ship it');
    else if (call.name === 'reject_ship') decide(taskId, 'rejected', lastUserUtterance(taskId) || call.arguments?.reason || "don't ship");
    else if (call.name === 'get_details') {
      emit('callback.speech', { taskId, text: detailText(taskId) });
      addTranscript(taskId, 'agent', detailText(taskId), 'callback');
    }
  });
}

function lastUserUtterance(taskId: string) {
  const t = getTask(taskId);
  return [...(t?.transcript || [])].reverse().find((e) => e.role === 'user')?.text;
}

function detailText(taskId: string) {
  const t = getTask(taskId);
  return t ? `Details on ${t.id}: brief was "${t.brief.slice(0, 120)}". ${t.diffStat || ''}. Ready when you are — 'ship it' or 'don't ship'.` : '';
}

// ── Consent decision — shared by voice tool.call AND UI buttons ────────────
export async function decide(taskId: string, decision: 'approved' | 'rejected', utterance: string) {
  const task = getTask(taskId);
  if (!task || task.state === 'shipped' || task.state === 'rejected') return;

  const callbackTranscript = task.transcript.filter((e) => e.session === 'callback');
  if (decision === 'approved') {
    updateTask(taskId, { state: 'approved' });
    try {
      const repoDir = (await import('node:path')).join((await import('./config.ts')).config.workDir, taskId);
      const prUrl = await createPullRequest({
        repoDir,
        repo: task.repo,
        branch: task.branch,
        title: `fix: ${task.brief.slice(0, 60)}`,
        body: `Opened by Boomerang on verbal consent.\n\nTask: ${task.brief}\nReceipt: see boomerang consent ledger.`,
      });
      updateTask(taskId, { state: 'shipped', prUrl });
      writeReceipt({
        taskId, decision, decidedAt: new Date().toISOString(),
        action: 'github.create_pr', actionResult: prUrl,
        utterance, transcriptHash: hashTranscript(callbackTranscript),
        summaryHeard: task.summary || task.error || '',
      });
      emit('callback.speech', { taskId, text: `PR is open: ${prUrl}` });
    } catch (e) {
      updateTask(taskId, { state: 'failed', error: `PR failed: ${(e as Error).message}` });
    }
  } else {
    updateTask(taskId, { state: 'rejected' });
    writeReceipt({
      taskId, decision, decidedAt: new Date().toISOString(),
      action: 'github.reject_pr', actionResult: 'no PR opened',
      utterance, transcriptHash: hashTranscript(callbackTranscript),
      summaryHeard: task.summary || task.error || '',
    });
    emit('callback.speech', { taskId, text: 'Rejection logged. Branch kept for review.' });
  }
}

export function feedUtterance(taskId: string, text: string) {
  sessions.get(taskId)?.sendText(text);
}

export function feedAudio(taskId: string, frame: Buffer) {
  sessions.get(taskId)?.sendAudio(frame);
}
