// End-to-end smoke: brief → worker → callback → consent → receipt.
// Runs against a live server on PORT (default 8787).
const BASE = `http://localhost:${process.env.PORT || 8787}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, method = 'GET', body) {
  const r = await fetch(BASE + p, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
  return r.json();
}

const health = await api('/api/health');
console.log('health:', JSON.stringify(health));

const task = await api('/api/tasks', 'POST', {
  brief: 'The payments retry worker is double-charging — find the race, fix it, keep the API contract.',
});
console.log('dispatched', task.id, task.state);

let t = task;
for (let i = 0; i < 60 && !['awaiting_consent', 'failed'].includes(t.state); i++) {
  await sleep(1000);
  t = await api('/api/tasks/' + task.id);
}
console.log('worker done →', t.state, '|', t.diffStat || t.error);
if (t.state !== 'awaiting_consent') { console.log('SMOKE:FAIL'); process.exit(1); }
console.log('callback summary:', t.summary);

// verbal approval via the voice path (mock session routes to tool.call → decide)
await api(`/api/tasks/${task.id}/utterance`, 'POST', { text: 'ship it' });
for (let i = 0; i < 30 && t.state !== 'shipped'; i++) {
  await sleep(1000);
  t = await api('/api/tasks/' + task.id);
}
console.log('decision →', t.state, '|', t.prUrl || t.error);

const receipts = await api('/api/receipts');
const mine = receipts.find((r) => r.taskId === task.id);
console.log('receipt:', mine ? `${mine.decision} · ${mine.action} · ${mine.transcriptHash.slice(0, 24)}…` : 'MISSING');

if (t.state === 'shipped' && mine) console.log('SMOKE:PASS');
else { console.log('SMOKE:FAIL'); process.exit(1); }
