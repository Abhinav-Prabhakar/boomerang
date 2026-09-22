// Boomerang dashboard — STATIC REPLAY client.
// Same rendering layer as web/app.js, but the network layer (SSE + REST) is
// replaced by a Replayer that walks run.json — a timeline captured from a real
// run of task-muceuw8d-10. The agent's voice is agent.wav, the real AssemblyAI
// session audio, played at the moments it was originally spoken.
const $ = (s) => document.querySelector(s);
const tasks = new Map();
const receipts = [];
let currentCallTask = null;
const activeAudio = new Set();

// ── chime (identical to live app) ──
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1174.7].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.2);
    });
  } catch { /* audio unavailable */ }
}

// speak() from the live app is replaced by real recorded audio — see
// playSegment(). callback.speech entries in run.json carry an `audio` field
// pointing into agent.wav; anything without one stays silent (the transcript
// line still renders, as it did live).
function speak() { /* replay: agent voice comes from agent.wav, not TTS */ }

function playSegment(file, from, to) {
  const a = new Audio(file);
  activeAudio.add(a);
  const stop = () => { a.pause(); activeAudio.delete(a); };
  a.addEventListener('loadedmetadata', () => { a.currentTime = from || 0; });
  if (a.readyState >= 1) a.currentTime = from || 0;
  a.addEventListener('timeupdate', () => { if (to && a.currentTime >= to) stop(); });
  a.addEventListener('ended', stop);
  a.play().catch(() => stop()); // autoplay policy — play() is user-gated anyway
}

// ── rendering (identical to live app) ──
const STATE_LABEL = { briefed: 'briefed', working: 'working', blocked: 'blocked',
  awaiting_consent: 'CALLING YOU', approved: 'approved', rejected: 'rejected',
  shipped: 'shipped ✓', failed: 'failed' };

function renderTask(t) {
  if (!t || !t.id || !t.brief) return;
  tasks.set(t.id, t);
  let el = document.getElementById('card-' + t.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'card'; el.id = 'card-' + t.id;
    $('#tasks').prepend(el);
  }
  const events = (t.events || []).slice(-6).map((e) =>
    `<div class="ev ${e.kind}">${e.kind} · ${e.message}</div>`).join('');
  el.innerHTML = `
    <div class="brief">${t.brief.slice(0, 110)}</div>
    <div class="meta"><span class="badge ${t.state}">${STATE_LABEL[t.state] || t.state}</span>
      ${t.repo} · ${t.branch}</div>
    ${t.diffStat ? `<div class="meta">${t.diffStat}</div>` : ''}
    ${t.prUrl ? `<div class="meta"><a href="${t.prUrl}" target="_blank">${t.prUrl}</a></div>` : ''}
    ${t.error ? `<div class="ev error">${t.error}</div>` : ''}
    ${events}`;
  if (t.state === 'awaiting_consent' || t.state === 'failed') showCallback(t);
}

function showCallback(t) {
  if (currentCallTask === t.id && !$('#callback-panel').classList.contains('hidden')) return;
  currentCallTask = t.id;
  $('#callback-panel').classList.remove('hidden');
  $('#call-status').textContent = '📞 ' + t.id;
  $('#call-summary').textContent = t.state === 'failed'
    ? `The run on ${t.repo} failed: ${t.error || 'unknown'}. Retry or cancel?`
    : (t.summary || 'Worker finished. Awaiting your decision.');
  chime();
  if (t.summary || t.error) speak($('#call-summary').textContent);
  if (navigator.vibrate) navigator.vibrate(200);
}

function addTranscript(taskId, e) {
  const div = document.createElement('div');
  div.className = 'line ' + e.role;
  div.innerHTML = `<span class="who">${e.ts.slice(11, 19)} · ${e.session} · ${e.role}</span><div class="text">${e.role === 'agent' ? '🤖 ' : '🗣 '}${e.text}</div>`;
  $('#transcript').appendChild(div);
  $('#transcript').scrollTop = $('#transcript').scrollHeight;
}

// Live app fetches /api/receipts; the replay renders from run.json's
// in-memory receipt list instead — same markup.
function renderReceipts() {
  $('#receipts').innerHTML = receipts.slice().reverse().map((r) => `
    <div class="rcpt">
      <div><b class="${r.decision}">${r.decision.toUpperCase()}</b> · ${r.action}
        ${r.actionResult && r.actionResult.startsWith('http') ? `· <a href="${r.actionResult}">${r.actionResult}</a>` : `· ${r.actionResult || ''}`}</div>
      <div>said: “${r.utterance}”</div>
      <div>heard: ${(r.summaryHeard || '').slice(0, 120)}</div>
      <div class="hash">${r.transcriptHash} · ${r.decidedAt}</div>
    </div>`).join('') || '<div class="ev">No receipts yet — every action will trace to spoken words.</div>';
}

// ── event dispatch — mirrors app.js's SSE handler ──
function handle(type, data) {
  if (type === 'init') { data.forEach(renderTask); renderReceipts(); }
  else if (type === 'task.created' || type === 'task.updated') renderTask(data);
  else if (type === 'task.event') {
    const known = tasks.get(data.taskId);
    if (known) { known.events.push(data.event); renderTask(known); }
  }
  else if (type === 'transcript') addTranscript(data.taskId, data.entry);
  else if (type === 'callback.speech') {
    if (data.audio) playSegment(data.audio.file, data.audio.from, data.audio.to);
    else if (window.speechSynthesis) { // fallback for speech with no recording
      const u = new SpeechSynthesisUtterance(data.text); u.rate = 1.05;
      speechSynthesis.speak(u);
    }
  }
  else if (type === 'callback.started') chime();
  else if (type === 'receipt') { receipts.push(data); renderReceipts(); }
}

// ── replayer ──
class Replayer {
  constructor(timeline) {
    this.timeline = timeline;
    this.total = timeline.length ? timeline[timeline.length - 1].t : 0;
    this.cursor = 0;
    this.elapsed = 0;        // ms of timeline already dispatched
    this.startedAt = null;   // wall clock when current play segment began
    this.timer = null;
    this.playing = false;
  }
  play() {
    if (this.playing) return;
    if (this.cursor >= this.timeline.length) this.restart(); // ended → replay from top
    this.playing = true;
    this.startedAt = performance.now();
    for (const a of activeAudio) a.play().catch(() => {});
    this.schedule();
    this.tick();
    $('#rp-play').textContent = '⏸ Pause';
  }
  pause() {
    if (!this.playing) return;
    this.elapsed += performance.now() - this.startedAt;
    this.playing = false;
    clearTimeout(this.timer);
    for (const a of activeAudio) a.pause();
    $('#rp-play').textContent = '▶ Play';
  }
  restart() {
    this.pause();
    this.cursor = 0;
    this.elapsed = 0;
    resetUI();
    updateBar(0, this.total);
  }
  schedule() {
    const item = this.timeline[this.cursor];
    if (!item) { this.finish(); return; }
    const delay = Math.max(0, item.t - this.now());
    this.timer = setTimeout(() => {
      handle(item.type, item.data);
      this.cursor += 1;
      this.schedule();
    }, delay);
  }
  now() { return this.elapsed + (this.playing ? performance.now() - this.startedAt : 0); }
  finish() {
    this.playing = false;
    updateBar(this.total, this.total);
    $('#rp-play').textContent = '▶ Play';
  }
  tick() {
    updateBar(this.now(), this.total);
    if (this.playing) requestAnimationFrame(() => this.tick());
  }
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function updateBar(pos, total) {
  $('#rp-fill').style.width = total ? Math.min(100, (pos / total) * 100) + '%' : '0%';
  $('#rp-time').textContent = `${fmt(pos)} / ${fmt(total)}`;
}

function resetUI() {
  tasks.clear();
  receipts.length = 0;
  currentCallTask = null;
  for (const a of [...activeAudio]) a.pause();
  activeAudio.clear();
  if (window.speechSynthesis) speechSynthesis.cancel();
  $('#tasks').innerHTML = '';
  $('#transcript').innerHTML = '';
  $('#callback-panel').classList.add('hidden');
  $('#call-status').textContent = '';
  renderReceipts();
}

// Live controls are inert in a replay — the run already happened.
for (const id of ['brief-input', 'brief-mic', 'brief-send', 'btn-ship', 'btn-reject', 'btn-details', 'btn-speak']) {
  const el = document.getElementById(id);
  if (el) { el.disabled = true; el.title = 'Disabled — this is a replay of a recorded run'; }
}

// ── boot ──
fetch('run.json')
  .then((r) => r.json())
  .then((run) => {
    const rp = new Replayer(run.timeline);
    $('#provider').textContent =
      `replay of ${run.meta.taskId} · real AssemblyAI session`;
    updateBar(0, rp.total);
    renderReceipts();
    $('#rp-play').onclick = () => (rp.playing ? rp.pause() : rp.play());
    $('#rp-restart').onclick = () => rp.restart();
  })
  .catch((e) => {
    $('#provider').textContent = 'replay failed to load: ' + e.message;
  });
