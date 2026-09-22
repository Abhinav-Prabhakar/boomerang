#!/usr/bin/env bash
# Boomerang demo launcher — one command to rule the demo:
#   ./scripts/start-demo.sh        (or: make demo)
#
# Starts the app server AND a public Cloudflare quick-tunnel, then prints the
# https://*.trycloudflare.com URL judges can open. No Cloudflare account needed.
# Ctrl-C tears both down cleanly (state is persisted to data/ on shutdown).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
SERVER_LOG="${SERVER_LOG:-/tmp/boomerang-server.log}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/boomerang-tunnel.log}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install it:"
  echo "  brew install cloudflared"
  echo "  # or download the macos-arm64 binary from"
  echo "  # https://github.com/cloudflare/cloudflared/releases"
  exit 1
fi

[ -d node_modules ] || npm install
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env && echo "created .env from .env.example (edit to add ASSEMBLYAI_API_KEY)"; }

cleanup() {
  echo; echo "shutting down…"
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true
  [ -n "${TUN_PID:-}" ] && kill "$TUN_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "done."
}
trap cleanup INT TERM EXIT

echo "▶ starting boomerang server on :$PORT  (log: $SERVER_LOG)"
PORT="$PORT" node server/index.ts >"$SERVER_LOG" 2>&1 &
SRV_PID=$!

for i in $(seq 1 30); do
  curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 || { echo "server failed to start — see $SERVER_LOG"; exit 1; }

echo "▶ opening public tunnel (log: $TUNNEL_LOG)"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
TUN_PID=$!

URL=""
for i in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 0.5
done

if [ -n "$URL" ]; then
  echo
  echo "  ┌──────────────────────────────────────────────────────────────┐"
  printf "  │  🪃  LIVE: %-49s│\n" "$URL"
  echo "  └──────────────────────────────────────────────────────────────┘"
  echo
  echo "  Open it, dispatch a brief, and say \"ship it\" when it calls back."
  echo "  (Tunnel dies with this script — rerun ./scripts/start-demo.sh for a new URL.)"
else
  echo "tunnel URL not detected yet — check $TUNNEL_LOG"
fi

wait
