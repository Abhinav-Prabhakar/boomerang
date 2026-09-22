# lablab.ai submission copy — Boomerang

> Paste-ready text for the submission form. Registration itself is manual
> (email validation blocked for bots — Abhinav does it).

## Title

**Boomerang — the agent that calls you back**

## Tagline

A voice pager for async coding agents: brief it by voice, walk away, and it
*calls you* when the work's done — then holds for your verbal go/no-go before
any side effect runs.

## Description (long form)

Coding agents now run 10–60 minutes unattended, but supervision is still the
bottleneck: a terminal you babysit defeats the point, and a chat window you
poll is worse. Every "autonomous" run ends the same way — you checking
whether it's done.

Boomerang inverts the flow. It's a two-way voice bridge built on the
AssemblyAI Voice Agent API:

1. **Brief a coding task by voice**, then walk away.
2. A headless worker does the fix on the target repo — real clone, real edit,
   real test run, real push.
3. When it finishes — *or hits a wall* — the agent initiates a voice
   **callback**: a chime and a 15-second spoken summary.
4. It holds for your verbal **go/no-go**, logged as a **consent receipt**
   (spoken utterance + transcript hash + timestamp) before any side effect
   runs. "Ship it" opens a real PR.

Two orchestrated voice sessions (brief + agent-initiated callback), keyterms
for repo jargon, JSON-schema `tool.call` as the consent gate, and turn
detection tuned for one-word approvals. Failure is a first-class path: the
callback tells you what broke and offers retry or cancel.

Voice becomes an interrupt channel, not a chat window — the same insight that
made pagers beat dashboards for ops, applied to agent supervision. And every
action traces to the exact spoken words that authorized it: an audit trail
for agent-driven side effects from day one.

## Tags

`voice-ai` `assemblyai` `voice-agent` `coding-agents` `developer-tools`
`agent-orchestration` `typescript` `nodejs` `consent` `audit-trail`

## Links

- Repo: https://github.com/Abhinav-Prabhakar/boomerang (MIT)
- Demo target repo (real PRs): https://github.com/Abhinav-Prabhakar/boomerang-demo-target
- Live demo: see README / docs/DEMO.md (ephemeral cloudflared URL)
- Video: *(record from docs/video-script.md — 3 min)*
- Deck: docs/deck.md · Cover: docs/cover.svg

## Built with

AssemblyAI Voice Agent API · Node 26 + TypeScript · `ws` · GitHub CLI ·
zero-build static dashboard
