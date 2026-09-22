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
  abstract close(): void;
}

// ── AssemblyAI Voice Agent API ────────────────────────────────────────────
// wss://agents.assemblyai.com/v1/ws · auth: Authorization: Bearer <key>
// handshake: connect → session.update → session.ready → input.audio (PCM16)
export class AssemblyAIVoiceSession extends VoiceSession {
  private ws: WebSocket;

  constructor(cfg: VoiceSessionConfig) {
    super();
    this.ws = new WebSocket(config.aaiVoiceAgentWss, {
      headers: { Authorization: `Bearer ${config.assemblyAiKey}` },
    });
    this.ws.on('open', () => {
      this.ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          system_prompt: cfg.systemPrompt,
          greeting: cfg.greeting,
          voice: cfg.voice || config.aaiVoice,
          tools: cfg.tools || [],
          // env-provided keyterms merge with per-session ones (deduped)
          keyterms: [...new Set([...(cfg.keyterms || []), ...config.aaiExtraKeyterms])],
          context: cfg.context,
          // Audio format for input.audio frames: base64 PCM16 mono @ aaiSampleRate.
          // Browser side: AudioContext/AudioWorklet → Float32 → Int16 before send.
          sample_rate: config.aaiSampleRate,
          turn_detection: {
            interrupt_response: config.aaiInterruptResponse,
            min_silence: config.aaiMinSilenceMs,
            max_silence: config.aaiMaxSilenceMs,
          },
        },
      }));
    });
    this.ws.on('message', (data: Buffer) => this.route(JSON.parse(data.toString())));
    this.ws.on('error', (e) => this.emit('error', e));
    this.ws.on('close', () => this.emit('session.ended'));
  }

  private route(msg: { type?: string; [k: string]: unknown }) {
    switch (msg.type) {
      case 'session.ready': this.emit('session.ready'); break;
      case 'transcript.user': this.emit('transcript.user', msg.transcript ?? msg.text); break;
      case 'transcript.agent': this.emit('transcript.agent', msg.transcript ?? msg.text); break;
      case 'tool.call': this.emit('tool.call', msg); break;
      case 'reply.audio': this.emit('reply.audio', Buffer.from(msg.audio as string, 'base64')); break;
      case 'session.ended': this.emit('session.ended'); break;
      default: this.emit('event', msg);
    }
  }

  sendAudio(frame: Buffer) {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'input.audio', audio: frame.toString('base64') }));
  }

  sendText(text: string) {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'input.text', text }));
  }

  close() { try { this.ws.close(); } catch { /* noop */ } }
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
