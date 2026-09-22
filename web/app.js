// Boomerang dashboard client.
// Voice in mock mode: browser SpeechRecognition (input) + SpeechSynthesis (output)
// — the server only sees utterance text, so the real AssemblyAI session drops in
// without UI changes (audio then flows over /ws/voice instead).
const $ = (s) => document.querySelector(s);
const tasks = new Map();
let currentCallTask = null;
let voiceOn = true;

// ── chime + TTS ──
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

function speak(text) {
  if (!voiceOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// ── speech recognition → utterance ──
function listen(onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('SpeechRecognition unsupported in this browser — use Chrome.'); return; }
  const rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = true;
  rec.onresult = (e) => {
    const t = [...e.results].map((r) => r[0].transcript).join('');
    $('#heard').textContent = 'heard: “' + t + '”';
    if (e.results[e.results.length - 1].isFinal) onText(t);
  };
  rec.start();
  setTimeout(() => rec.stop(), 8000);
}

// ── API ──
async function api(p, method = 'GET', body) {
  const r = await fetch(p, { method, body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {} });
  return r.json();
}

// ── rendering ──
const STATE_LABEL = { briefed: 'briefed', working: 'working', blocked: 'blocked',
  awaiting_consent: 'CALLING YOU', approved: 'approved', rejected: 'rejected',
  shipped: 'shipped ✓', failed: 'failed' };

// Tunnel-safe: all fetches/SSE use relative URLs, and any future WebSocket
// derives ws:// vs wss:// from the page scheme — so the dashboard works
// identically on localhost and over a https://*.trycloudflare.com tunnel.
function wsUrl(path) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}

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

async function refreshReceipts() {
  const list = await api('/api/receipts');
  $('#receipts').innerHTML = list.slice().reverse().map((r) => `
    <div class="rcpt">
      <div><b class="${r.decision}">${r.decision.toUpperCase()}</b> · ${r.action}
        ${r.actionResult && r.actionResult.startsWith('http') ? `· <a href="${r.actionResult}">${r.actionResult}</a>` : `· ${r.actionResult || ''}`}</div>
      <div>said: “${r.utterance}”</div>
      <div>heard: ${(r.summaryHeard || '').slice(0, 120)}</div>
      <div class="hash">${r.transcriptHash} · ${r.decidedAt}</div>
    </div>`).join('') || '<div class="ev">No receipts yet — every action will trace to spoken words.</div>';
}

// ── wire up ──
$('#brief-send').onclick = async () => {
  const brief = $('#brief-input').value.trim();
  if (!brief) return;
  $('#brief-input').value = '';
  await api('/api/tasks', 'POST', { brief });
};
$('#brief-mic').onclick = () => listen((t) => { $('#brief-input').value = t; });
$('#brief-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#brief-send').click(); });

$('#btn-ship').onclick = () => currentCallTask && api(`/api/tasks/${currentCallTask}/decision`, 'POST', { decision: 'approved', utterance: 'ship it (button)' });
$('#btn-reject').onclick = () => currentCallTask && api(`/api/tasks/${currentCallTask}/decision`, 'POST', { decision: 'rejected', utterance: "don't ship (button)" });
$('#btn-details').onclick = () => currentCallTask && api(`/api/tasks/${currentCallTask}/utterance`, 'POST', { text: 'details' });
$('#btn-speak').onclick = () => listen((t) => {
  if (currentCallTask) api(`/api/tasks/${currentCallTask}/utterance`, 'POST', { text: t });
});

// ── SSE ──
const es = new EventSource('/api/events');
es.onmessage = (m) => {
  const { type, data } = JSON.parse(m.data);
  if (type === 'init') { data.forEach(renderTask); refreshReceipts(); }
  else if (type === 'task.created' || type === 'task.updated') renderTask(data);
  else if (type === 'task.event') {
    const known = tasks.get(data.taskId);
    if (known) renderTask(known);
    else api('/api/tasks/' + data.taskId).then(renderTask); // e.g. SSE reconnect
  }
  else if (type === 'transcript') addTranscript(data.taskId, data.entry);
  else if (type === 'callback.speech') speak(data.text);
  else if (type === 'callback.started') chime();
  else if (type === 'receipt') refreshReceipts();
};

fetch('/api/health').then((r) => r.json()).then((h) => {
  $('#provider').textContent = `voice: ${h.voiceProvider} · repo: ${h.repo}`;
});
