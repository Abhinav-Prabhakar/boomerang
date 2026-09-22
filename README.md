# 🪃 Boomerang

**A voice pager for async coding agents — it calls *you* back.**

Everyone built a voice agent you talk *to*. Ours talks *back* — when the work's done.

Coding agents now run 10–60 minutes unattended, but supervision is still the
bottleneck: a terminal you babysit defeats the point. Boomerang is a two-way
voice bridge:

1. **Brief a coding task by voice**, then walk away.
2. A headless worker does the fix on the target repo.
3. When it finishes (or hits a decision point), **the agent initiates a voice
   callback**: a chime, a 15-second spoken summary —
   *"Done — race condition in `retry.ts`, 42-line diff, tests green.
   Say 'ship it' to open the PR."*
4. It holds for your verbal **go/no-go**, logged as a **consent receipt**
   (spoken utterance + transcript hash + timestamp) before any side effect runs.

Voice becomes an **interrupt channel**, not a chat window.

## Demo (happy path)

```bash
npm install
cp .env.example .env        # add ASSEMBLYAI_API_KEY (or run with VOICE_PROVIDER=mock)
npm run seed                # creates the seeded demo repo with a real flaky-test bug
npm run dev                 # http://localhost:8787
npm run smoke               # end-to-end: brief → worker → callback → "ship it" → PR → receipt
```

Open the dashboard, dispatch the default brief, and watch the worker live-edit
the seeded repo. When it calls back, say **"ship it"** — a real PR opens on the
demo repo, and a consent receipt lands in the ledger. Say **"don't ship"** to
exercise the rejection path.

## Stack

- **AssemblyAI Voice Agent API** (`wss://agents.assemblyai.com/v1/ws`) — two
  orchestrated sessions (brief + callback), `keyterms` for repo jargon,
  JSON-schema `tool.call` carrying the consent-gated side effects, neural turn
  detection tuned for one-word approvals.
- **Node 26 + TypeScript** (native type-stripping, zero build step) — one `ws`
  dependency. Orchestrator, worker, and consent ledger in `server/`; dashboard
  in `web/`.
- **Consent receipts** — append-only JSONL (`data/receipts.jsonl`): every action
  traces to the exact spoken words that authorized it.
- **Seeded demo repo** — a payments retry worker with a genuine check-then-act
  race in `dequeue()` and a flaky exactly-once test (`npm run seed`).

## What's real vs. scripted

- Real: both voice sessions, mic/audio path, git ops (clone → branch → fix →
  test → push → `gh pr create`), consent receipts, dashboard.
- Scripted today: the worker's *investigation narrative* is a bounded timeline
  (the fix it applies is real and verified by the repo's own test suite). A real
  agent loop drops into `runWorker` in `server/worker.ts`.
- `VOICE_PROVIDER=mock` runs the whole loop with browser STT/TTS — no API key
  needed; swap in `assemblyai` + key for the real sessions.

## Roadmap

- Real headless coding agent (Claude Code SDK / Aider) behind `runWorker`
- Phone/Slack egress for the callback (it's a pager — it should page anywhere)
- Multi-agent queue: one callback session triaging several workers
- Escalation policies: callback on blocked/failed, not just done

## License

MIT — built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon).
