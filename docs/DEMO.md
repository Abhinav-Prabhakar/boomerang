# Live Demo

**Current public URL:** https://crops-could-myth-sent.trycloudflare.com

> Quick tunnels are ephemeral — this URL lives only as long as the
> `cloudflared` process on Abhinav's machine. If it's down, relaunch in one
> command (below) and replace the URL here and in the README.

## Relaunch (one command)

```bash
make demo            # or: ./scripts/start-demo.sh
```

That script:

1. `npm install`s if needed and creates `.env` from `.env.example`
2. starts the app server on `PORT` (default 8787)
3. opens `cloudflared tunnel --url http://localhost:$PORT`
4. prints the `https://*.trycloudflare.com` URL

Ctrl-C shuts both down cleanly; task state + consent receipts persist in
`data/` and reload on the next launch.

No Cloudflare account is needed — quick tunnels are zero-config. If
`cloudflared` is missing: `brew install cloudflared`, or grab the
`cloudflared-macos-arm64.tgz` binary from
<https://github.com/cloudflare/cloudflared/releases>.

## The demo in 60 seconds

1. Open the URL — dashboard loads (works over `https://` / `wss://`; all
   client URLs are relative/scheme-aware).
2. Type or dictate a brief: *"The payments retry worker is double-charging —
   find the race, fix it, don't touch the API contract."* → **Dispatch**.
3. Watch the worker card stream live events: clone → reproduce flake →
   isolate the race → edit → tests green → push.
4. **Incoming call** panel lights up with a chime — the agent calls *you*
   and speaks a ~15s summary.
5. Say **"ship it"** (or click the button) → a real PR opens on
   `boomerang-demo-target` and a **consent receipt** lands in the ledger.
   Say **"don't ship"** to exercise the rejection path instead.
6. Kill the worker's network mid-run to see the escalation path: it calls
   back with what went wrong; "retry" re-dispatches, "cancel" logs a receipt.

## Judge notes

- `VOICE_PROVIDER=mock` (default): browser SpeechRecognition in,
  SpeechSynthesis out — zero API key needed. The AssemblyAI session is a
  drop-in swap (`ASSEMBLYAI_API_KEY` + `VOICE_PROVIDER=assemblyai`).
- Mic capture needs Chrome and a secure context — `https://*.trycloudflare.com`
  qualifies; `http://localhost` also counts as secure.
- Every receipt in `data/receipts.jsonl` traces a real side effect to the
  exact spoken words that authorized it.
