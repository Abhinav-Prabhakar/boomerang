import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency)
const envPath = path.resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    // real environment wins over .env (PORT=8899 node … must not be clobbered)
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export const config = {
  port: Number(process.env.PORT || 8787),
  assemblyAiKey: process.env.ASSEMBLYAI_API_KEY || '',
  voiceProvider: process.env.VOICE_PROVIDER || (process.env.ASSEMBLYAI_API_KEY ? 'assemblyai' : 'mock'),
  aaiVoiceAgentWss: process.env.AAI_VOICE_AGENT_WSS || 'wss://agents.assemblyai.com/v1/ws',
  aaiVoice: process.env.AAI_VOICE || 'alba',
  demoRepo: process.env.DEMO_REPO || 'Abhinav-Prabhakar/boomerang-demo-target',
  workDir: path.resolve(process.cwd(), process.env.WORK_DIR || './work'),
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR || './data'),

  // ── AssemblyAI Voice Agent tuning (drop-in knobs, see docs/assemblyai-dropin.md) ──
  // Turn detection: one-word approvals ("ship it") need a short min_silence so
  // the agent doesn't sit on the line waiting for more speech.
  aaiMinSilenceMs: Number(process.env.AAI_MIN_SILENCE_MS || 400),
  aaiMaxSilenceMs: Number(process.env.AAI_MAX_SILENCE_MS || 1200),
  aaiInterruptResponse: (process.env.AAI_INTERRUPT_RESPONSE || 'true') === 'true',
  // Extra keyterms (comma-separated) merged into every session's keyterms list —
  // repo jargon like "retry.ts" that generic STT mangles.
  aaiExtraKeyterms: (process.env.AAI_EXTRA_KEYTERMS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // Browser mic capture format for the real session (PCM16 mono).
  aaiSampleRate: Number(process.env.AAI_SAMPLE_RATE || 24000),
};
