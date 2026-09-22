# AssemblyAI drop-in — what's already wired, what flips on with a key

Everything below is stubbed/configured so that when `ASSEMBLYAI_API_KEY`
lands, going live is one env flip:

```bash
# .env
ASSEMBLYAI_API_KEY=<key>
VOICE_PROVIDER=assemblyai
```

No code changes required. `createVoiceSession()` in `server/voice.ts`
already branches on provider+key.

## Session topology (already implemented)

Two orchestrated sessions over `wss://agents.assemblyai.com/v1/ws`
(auth: `Authorization: Bearer <key>`):

| Session    | Direction        | Purpose                                              |
|------------|------------------|------------------------------------------------------|
| brief      | user → agent     | speak the task; `keyterms` carry repo jargon         |
| callback   | agent → user     | agent initiates on worker done/fail; `tool.call` carries consent-gated side effects |

Handshake implemented in `AssemblyAIVoiceSession` and verified live:
`session.update` (system_prompt, greeting, `input.{format,keyterms,
turn_detection}`, `output.{voice,format}`, tools with `type:"function"`)
→ `session.ready` → `input.audio` frames (base64 PCM16 @ 24kHz).
Inbound routed: `transcript.user[.delta]`, `transcript.agent[.delta]`,
`tool.call`, `reply.audio` (payload field: `data`), `reply.done`,
`session.ended`. `tool.result` is drained per pending call on `reply.done`;
`close()` sends `session.end` so the 30-second grace window doesn't bill.

No text-input event exists on the wire: `sendText` injects
`conversation.message` (role user) + `reply.create`, sequenced after the
first `reply.done` so a decision never lands before the summary. The
proactive summary itself is `reply.create` fired on `session.ready` — the
agent speaks first. Real agent speech is also persisted to
`data/audio-<taskId>.pcm` (concatenated `reply.audio` chunks).

## Mic PCM pipeline (browser → server → AAI)

Server side is done: `/ws/voice` accepts binary frames and calls
`feedAudio(taskId)` → `session.sendAudio(frame)` → `{type:'input.audio',
audio: base64}`.

Browser side TODO (the only remaining code): in `web/app.js`, when
`VOICE_PROVIDER=assemblyai` (read from `/api/health`):

```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const ctx = new AudioContext({ sampleRate: 24000 });   // AAI_SAMPLE_RATE
const src = ctx.createMediaStreamSource(stream);
// AudioWorklet: Float32 mono → Int16 PCM → ws.send(int16.buffer)
const ws = new WebSocket(wsUrl('/ws/voice?task=' + taskId));
```

Playback: `reply.audio` arrives base64 PCM16 @ 24kHz on the SSE
`callback.audio` event → decode → AudioContext queue.
The mock path stays for no-key demos; browser STT/TTS handles audio there.

## Config knobs (all env-driven, defaults tuned for one-word approvals)

| Env                    | Default | Why                                          |
|------------------------|---------|----------------------------------------------|
| `AAI_MIN_SILENCE_MS`   | 400     | "ship it" is one breath — don't wait around  |
| `AAI_MAX_SILENCE_MS`   | 1200    | end-of-turn bound on the callback            |
| `AAI_INTERRUPT_RESPONSE` | true  | barge-in: user can cut off the summary       |
| `AAI_EXTRA_KEYTERMS`   | —       | jargon beyond the per-session set            |
| `AAI_SAMPLE_RATE`      | 24000   | PCM16 mono rate for `input.audio`/`reply.audio` |
| `AAI_VOICE`            | alba    | callback voice (valid: alba, michael, anna…) |

Per-session keyterms already sent: `retry.ts`, repo name, `pull request`,
task branch — merged (deduped) with `AAI_EXTRA_KEYTERMS` in `session.update`.

## Tools sent on the callback session

`approve_ship`, `reject_ship`, `get_details` — every `tool.call` is gated by
a consent receipt before any side effect (`gh pr create`) runs. On a failed
run, `approve_ship` maps to *retry* (fresh dispatch + `task.retry` receipt),
`reject_ship` to *cancel*.

## Verified 2026-09-22 (live, key present)

1. `.env`: key + `VOICE_PROVIDER=assemblyai` — health reports
   `voiceProvider: assemblyai`
2. `npm run smoke` — **PASS**: dispatch → worker → real `session.ready` →
   agent speaks summary (real `reply.audio`) → injected "ship it" →
   `tool.call approve_ship` → `tool.result` → PR #5 opened on
   boomerang-demo-target → consent receipt written.
3. Session ends with `session.end` → `session.ended` → clean close (1000).
