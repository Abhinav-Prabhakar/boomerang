import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency)
const envPath = path.resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export const config = {
  port: Number(process.env.PORT || 8787),
  assemblyAiKey: process.env.ASSEMBLYAI_API_KEY || '',
  voiceProvider: process.env.VOICE_PROVIDER || (process.env.ASSEMBLYAI_API_KEY ? 'assemblyai' : 'mock'),
  aaiVoiceAgentWss: process.env.AAI_VOICE_AGENT_WSS || 'wss://agents.assemblyai.com/v1/ws',
  demoRepo: process.env.DEMO_REPO || 'Abhinav-Prabhakar/boomerang-demo-target',
  workDir: path.resolve(process.cwd(), process.env.WORK_DIR || './work'),
  dataDir: path.resolve(process.cwd(), 'data'),
};
