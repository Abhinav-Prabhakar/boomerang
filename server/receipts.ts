// Consent receipts — the audit layer. Every side effect traces to spoken words.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { emit } from './state.ts';

export interface ConsentReceipt {
  id: string;
  taskId: string;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  action: string;               // e.g. "github.create_pr"
  actionResult?: string;        // e.g. PR URL
  utterance: string;            // what the user literally said
  transcriptHash: string;       // sha256 over the callback transcript
  summaryHeard: string;         // what the agent told the user before deciding
  sessionId?: string;
}

const receiptsFile = () => {
  mkdirSync(config.dataDir, { recursive: true });
  return path.join(config.dataDir, 'receipts.jsonl');
};

export function writeReceipt(r: Omit<ConsentReceipt, 'id'>) {
  const receipt: ConsentReceipt = { id: `rcpt-${Date.now().toString(36)}`, ...r };
  appendFileSync(receiptsFile(), JSON.stringify(receipt) + '\n');
  emit('receipt', receipt);
  return receipt;
}

export function hashTranscript(entries: { role: string; text: string; ts: string }[]) {
  const canon = entries.map((e) => `${e.ts}|${e.role}|${e.text}`).join('\n');
  return 'sha256:' + createHash('sha256').update(canon).digest('hex');
}
