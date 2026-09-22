# Boomerang — 3-minute demo video script

> Timed to ~3:00. One continuous screen recording of the dashboard
> (Chrome, mic enabled) with a terminal + GitHub tab staged.
> Voiceover = V.O. On-screen actions in [brackets].

---

**0:00–0:15 — Cold open / hook**

*[Screen: dashboard, empty. Cursor blinks in the brief box.]*

V.O.: "Every coding agent today ends the same way — you, staring at a
terminal, waiting to see if it's done. We built the opposite. This is
Boomerang: the agent that calls *you* back."

**0:15–0:40 — The brief**

*[Type (or dictate) the brief, hit Dispatch.]*

V.O.: "I give it a task in plain voice — 'the payments retry worker is
double-charging; find the race, fix it, don't touch the API contract' —
and I walk away. A headless worker takes over on the real repo."

*[Cut to task card streaming: clone → reproduce flake → isolate race.]*

**0:40–1:20 — The worker runs**

*[Task card events tick: FAIL test, race confirmed, file_edit, PASS 6/6, push.]*

V.O.: "Watch it work: it clones the repo, reproduces the flaky test —
there, the double-charge race — isolates it to a check-then-act bug in
`dequeue()`, patches it, runs the suite ten times green, and pushes a
branch. Real git. Real tests. I did nothing."

**1:20–1:50 — THE MOMENT: incoming call**

*[Callback panel lights up, chime plays, TTS speaks the summary.]*

V.O.: "And here's the part nobody else built: when it finishes, *it calls
me.*" [let the chime + spoken summary play] "…a fifteen-second summary,
then it holds the line for my decision. Voice isn't a chat window here —
it's an interrupt channel."

**1:50–2:20 — Verbal consent → real PR**

*[Say "ship it" (mic) → PR link appears; click through to GitHub.]*

V.O.: "I say 'ship it' —" [say it] "— and the tool call fires, the PR
opens for real, and the consent receipt lands: the exact words I spoke,
a hash of the transcript, the timestamp. Every side effect traces to a
human voice. That's the audit trail agents have been missing."

**2:20–2:45 — Rejection + escalation paths**

*[Show receipt ledger; mention the failure callback.]*

V.O.: "Say 'don't ship' and it's logged as a rejection — branch kept, no
PR. And if the worker fails, it still calls — tells me what broke, and
offers retry or cancel. Escalation is the product."

**2:45–3:00 — Close**

*[Cover slide: 🪃 Boomerang — the agent that calls you back.]*

V.O.: "Built on the AssemblyAI Voice Agent API — two orchestrated
sessions, keyterms for repo jargon, tool calls as a consent gate.
Boomerang. Throw the task — it comes back with an answer."

---

### Recording checklist

- [ ] Server running (`make demo` or `npm run dev`), `VOICE_PROVIDER` as intended
- [ ] Chrome window: dashboard only, bookmarks bar off, 1440p-ish zoom 110%
- [ ] Mic permission granted; test one "ship it" first
- [ ] GitHub tab staged on the demo repo's PR list
- [ ] Fresh task state OR show persisted history — either is honest
- [ ] Capture system audio so the chime + TTS summary are audible
