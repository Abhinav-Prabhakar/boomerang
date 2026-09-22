# Architecture

```
Browser (mic + speaker + dashboard)
   │  voice session #1 — "the brief"          voice session #2 — "the callback"
   │  SpeechRecognition / AAI Voice Agent      AAI Voice Agent API (agent INITIATES)
   ▼                                                        ▲
┌───────────────────────────┐                                │
│  POST /api/tasks          │                                │
│  Task dispatcher          │  worker done/blocked           │
│  ─────────────────        │ ───────────────────────────►   │
│  spawns headless worker   │   callback orchestrator        │
│  (git worktree on         │   (chime → spoken 15s summary  │
│   seeded demo repo)       │    → holds for verbal go/no-go)│
└───────────┬───────────────┘                                │
            │ tool.call: approve_ship / reject_ship          │
            ▼                                                │
   Consent receipt (JSONL): spoken utterance +               │
   transcript-hash + decision + timestamp                    │
            │ approved only                                  │
            ▼                                                │
     `gh pr create` on the target repo ──────────────────────┘
```

## Two orchestrated voice sessions (AssemblyAI Voice Agent API)

- **Brief session** (`wss://agents.assemblyai.com/v1/ws`): user speaks the task.
  `keyterms` carry repo jargon (file names, branch names) so identifiers
  transcribe correctly. Ends immediately — this is a pager, not a chat.
- **Callback session**: opened BY THE SERVER when the worker finishes or gets
  blocked. The agent speaks first (a real interrupt: chime + notification +
  spoken summary), then holds for a verbal decision. `tool.call` carries the
  side effect; every tool call is gated by a consent receipt.

## Why "agent-initiated" matters

Every other voice agent waits to be spoken to. Boomerang treats voice as an
**interrupt channel**: the agent calls *you* when supervision is needed —
which is the actual bottleneck in async coding-agent workflows.

## Mock mode (`VOICE_PROVIDER=mock`)

Dev/demo path with no API key: browser SpeechRecognition in, SpeechSynthesis
out, server-side rule engine emits the same `transcript.*`/`tool.call` events.
The orchestrator, receipts, and worker are identical — the real session is a
drop-in swap (`createVoiceSession` in `server/voice.ts`).
