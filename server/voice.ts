// Voice session abstraction. Two implementations share one interface so the
// orchestrator doesn't care whether audio is real (AssemblyAI Voice Agent API)
// or simulated (mock, for dev without an API key).
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { config } from './config.ts';

export interface VoiceTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceSessionConfig {
  systemPrompt: string;
  greeting?: string;
  voice?: string;
  tools?: VoiceTool[];
  keyterms?: string[];
  context?: string; // injected facts, e.g. callback summary payload
}

export abstract class VoiceSession extends EventEmitter {
  abstract sendAudio(frame: Buffer): void;
  abstract sendText(text: string): void; // simulate/feed user utterance
  // Ask the agent to speak without a user turn (the callback's summary).
  requestReply(_instructions: string): void { /* optional */ }
  abstract close(): void;
}

// ── AssemblyAI Voice Agent API ────────────────────────────────────────────
// wss://agents.assemblyai.com/v1/ws · auth: Authorization: Bearer <key>
// handshake: connect → session.update → session.ready → input.audio (PCM16)
// Schema per docs/voice-agents/voice-agent-api: config nests under
// input./output., tools carry type:"function", tool.calls are answered with
// tool.result after reply.done, and teardown is session.end (else a 30s
// grace window keeps billing).
export class AssemblyAIVoiceSession extends VoiceSession {
  private ws: WebSocket;
  private ready = false;
  private queue: string[] = [];
  private pendingCalls: Array<{ call_id: string; name: string; arguments?: unknown }> = [];
  private replyInFlight = false;
  private firstReplyDone = false;
  private pendingTurns: string[] = [];

  constructor(cfg: VoiceSessionConfig) {
    super();
    this.ws = new WebSocket(config.aaiVoiceAgentWss, {
      headers: { Authorization: `Bearer ${config.assemblyAiKey}` },
    });
    this.ws.on('open', () => {
      this.sendRaw({
        type: 'session.update',
        session: {
          // no `context` field on the wire — fold it into the prompt
          system_prompt: cfg.context
            ? `${cfg.systemPrompt}\n\nContext for this call: ${cfg.context}`
            : cfg.systemPrompt,
          greeting: cfg.greeting,
          tools: (cfg.tools || []).map((t) => ({ type: 'function', ...t })),
          input: {
            // input.audio frames: base64 PCM16 mono @ aaiSampleRate.
            // Browser side: AudioContext/AudioWorklet → Float32 → Int16.
            format: { encoding: 'audio/pcm', sample_rate: config.aaiSampleRate },
            keyterms: [...new Set([...(cfg.keyterms || []), ...config.aaiExtraKeyterms])],
            turn_detection: {
              interrupt_response: config.aaiInterruptResponse,
              min_silence: config.aaiMinSilenceMs,
              max_silence: config.aaiMaxSilenceMs,
            },
          },
          output: {
            voice: cfg.voice || config.aaiVoice,
            format: { encoding: 'audio/pcm', sample_rate: config.aaiSampleRate },
          },
        },
      });
    });
    this.ws.on('message', (data: Buffer) => {
      try { this.route(JSON.parse(data.toString())); } catch { /* malformed frame */ }
    });
    this.ws.on('error', (e) => this.emit('error', e));
    this.ws.on('close', () => this.emit('session.ended'));
  }

  private sendRaw(obj: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  // Everything except session.update must wait for session.ready — frames
  // sent early are rejected. Queue covers the dispatch→callback race where
  // an utterance can arrive while the socket is still connecting.
  private send(obj: unknown) {
    const s = JSON.stringify(obj);
    if (this.ready && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  private route(msg: { type?: string; [k: string]: unknown }) {
    switch (msg.type) {
      case 'session.ready':
        this.ready = true;
        for (const m of this.queue.splice(0)) this.ws.send(m);
        this.emit('session.ready', msg);
        break;
      case 'session.error':
        this.emit('error', new Error(`${msg.code}: ${msg.message}`));
        break;
      case 'transcript.user': this.emit('transcript.user', msg.transcript ?? msg.text); break;
      case 'transcript.agent': this.emit('transcript.agent', msg.transcript ?? msg.text); break;
      case 'tool.call':
        this.pendingCalls.push(msg as { call_id: string; name: string });
        this.emit('tool.call', msg);
        break;
      case 'reply.started':
        this.replyInFlight = true;
        this.emit('reply.started', msg);
        break;
      case 'reply.done':
        this.replyInFlight = false;
        this.firstReplyDone = true;
        // Tool results are due once the tool-call reply completes.
        for (const call of this.pendingCalls.splice(0)) {
          this.send({ type: 'tool.result', call_id: call.call_id,
            result: JSON.stringify({ status: 'ok' }), is_error: false });
        }
        // Injected turns wait until the agent's proactive message has
        // finished — a decision only makes sense after the summary lands,
        // same as a spoken turn under turn detection (minus the barge-in).
        for (const t of this.pendingTurns.splice(0)) this.injectTurn(t);
        this.emit('reply.done', msg);
        break;
      case 'reply.audio': this.emit('reply.audio', Buffer.from(msg.data as string, 'base64')); break;
      case 'session.ended': this.emit('session.ended'); break;
      default: this.emit('event', msg);
    }
  }

  sendAudio(frame: Buffer) {
    this.send({ type: 'input.audio', audio: frame.toString('base64') });
  }

  // There is no text-input event on the wire protocol: inject the utterance
  // as a conversation message, then ask the agent to respond to it. The
  // agent's tool.call path — and therefore consent gating — is identical to
  // a spoken turn; only the STT leg is skipped.
  sendText(text: string) {
    this.emit('transcript.user', text);
    if (this.ready && this.firstReplyDone && !this.replyInFlight) this.injectTurn(text);
    else this.pendingTurns.push(text);
  }

  private injectTurn(text: string) {
    this.send({ type: 'conversation.message', role: 'user', content: text });
    this.send({ type: 'reply.create',
      instructions: `The user just said aloud: "${text}". Respond to that utterance — if it means approval, call approve_ship; if rejection, call reject_ship; if a question, answer or call get_details.` });
  }

  requestReply(instructions: string) {
    this.send({ type: 'reply.create', instructions });
  }

  close() {
    try {
      if (this.ws.readyState === WebSocket.OPEN && this.ready) {
        this.send({ type: 'session.end' });
        setTimeout(() => { try { this.ws.close(); } catch { /* noop */ } }, 800);
      } else {
        this.ws.close();
      }
    } catch { /* noop */ }
  }
}

// ── Mock voice session ────────────────────────────────────────────────────
// Simulates the agent side: on sendText (user utterance), emits transcript.user,
// runs a tiny rule engine, emits tool.call for known intents and a scripted
// transcript.agent reply. The browser provides actual mic/STT/TTS.
export class MockVoiceSession extends VoiceSession {
  private cfg: VoiceSessionConfig;

  constructor(cfg: VoiceSessionConfig) {
    super();
    this.cfg = cfg;
    queueMicrotask(() => {
      this.emit('session.ready');
      if (cfg.greeting) this.emit('transcript.agent', cfg.greeting);
      if (cfg.context) this.emit('transcript.agent', cfg.context);
    });
  }

  sendAudio() { /* mock: browser does its own STT, calls sendText */ }

  sendText(text: string) {
    const t = text.toLowerCase();
    this.emit('transcript.user', text);
    setTimeout(() => {
      // NEGATIVE intents first — "don't ship" contains "ship"
      if (/\b(don't ship|do not ship|dont ship|reject|no\b|stop|cancel|hold|don't|wait)\b/.test(t)) {
        this.emit('tool.call', { call_id: `mock-${Date.now()}`, name: 'reject_ship', arguments: {} });
        this.emit('transcript.agent', 'Understood — not shipping. Rejection logged.');
      } else if (/\b(ship it|ship|approve|yes|go ahead|deploy|merge)\b/.test(t)) {
        this.emit('tool.call', { call_id: `mock-${Date.now()}`, name: 'approve_ship', arguments: {} });
        this.emit('transcript.agent', 'Shipping it — opening the PR now.');
      } else if (/\b(detail|more|what changed|diff|summary|repeat)\b/.test(t)) {
        this.emit('tool.call', { call_id: `mock-${Date.now()}`, name: 'get_details', arguments: {} });
      } else {
        this.emit('transcript.agent',
          "I didn't catch a decision. Say 'ship it' to open the PR, 'details' for more, or 'don't ship' to reject.");
      }
    }, 600);
  }

  close() { this.emit('session.ended'); }
}

export function createVoiceSession(cfg: VoiceSessionConfig): VoiceSession {
  if (config.voiceProvider === 'assemblyai' && config.assemblyAiKey) {
    return new AssemblyAIVoiceSession(cfg);
  }
  return new MockVoiceSession(cfg);
}
