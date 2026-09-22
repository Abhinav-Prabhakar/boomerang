// Boomerang server — static UI + JSON API + SSE event stream + voice WS proxy.
import http from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { config } from './config.ts';
import { listTasks, getTask, onEvent, updateTask } from './state.ts';
import { dispatch, decide, feedUtterance, feedAudio, startCallback } from './orchestrator.ts';

const WEB = path.resolve(process.cwd(), 'web');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const send = (code: number, body: unknown, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }

  // ── API ──
  if (url.pathname === '/api/health') {
    return send(200, { ok: true, voiceProvider: config.voiceProvider, repo: config.demoRepo });
  }
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    return send(200, listTasks());
  }
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const body = await readBody(req);
    const { brief } = JSON.parse(body || '{}');
    if (!brief) return send(400, { error: 'brief required' });
    const task = dispatch(String(brief));
    return send(201, task);
  }
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([\w-]+)(\/\w+)?$/);
  if (taskMatch) {
    const task = getTask(taskMatch[1]);
    if (!task) return send(404, { error: 'not found' });
    if (!taskMatch[2]) return send(200, task);
    if (taskMatch[2] === '/decision' && req.method === 'POST') {
      const { decision, utterance } = JSON.parse((await readBody(req)) || '{}');
      await decide(task.id, decision, utterance || `(ui) ${decision}`);
      return send(200, getTask(task.id));
    }
    if (taskMatch[2] === '/utterance' && req.method === 'POST') {
      const { text } = JSON.parse((await readBody(req)) || '{}');
      feedUtterance(task.id, String(text || ''));
      return send(200, { ok: true });
    }
    if (taskMatch[2] === '/callback' && req.method === 'POST') {
      startCallback(task.id);
      return send(200, { ok: true });
    }
    if (taskMatch[2] === '/reset' && req.method === 'POST') {
      updateTask(task.id, { state: 'awaiting_consent' });
      return send(200, getTask(task.id));
    }
  }
  if (url.pathname === '/api/receipts' && req.method === 'GET') {
    const f = path.join(config.dataDir, 'receipts.jsonl');
    const lines = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return send(200, lines);
  }

  // ── SSE ──
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'init', data: listTasks() })}\n\n`);
    const off = onEvent((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    req.on('close', off);
    return;
  }

  // ── static ──
  let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const fp = path.join(WEB, file);
  if (fp.startsWith(WEB) && existsSync(fp)) {
    return send(200, readFileSync(fp), MIME[path.extname(fp)] || 'application/octet-stream');
  }
  send(404, { error: 'not found' });
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b));
  });
}

// ── voice audio WS proxy: browser mic → server → voice session ──
const wss = new WebSocketServer({ server, path: '/ws/voice' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', 'http://x');
  const taskId = url.searchParams.get('task') || '';
  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) feedAudio(taskId, data);
    else {
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'utterance') feedUtterance(taskId, m.text);
      } catch { /* ignore */ }
    }
  });
});

server.listen(config.port, () => {
  console.log(`boomerang listening on http://localhost:${config.port}`);
  console.log(`voice provider: ${config.voiceProvider} · demo repo: ${config.demoRepo}`);
});
