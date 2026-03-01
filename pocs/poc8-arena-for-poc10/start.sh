#!/usr/bin/env bash
#
# start.sh — Start the full poc8-arena-for-poc10 stack:
#   1. SpacetimeDB server (port 3000)
#   2. Publish the server module (always wipes data to prevent tick budget degradation)
#   3. Seed 16 creatures + start a match
#   4. Vite client dev server (port 3006)
#
# Usage: ./start.sh [--keep-data]
#   --keep-data  Preserve existing SpacetimeDB data (default: wipe for clean tick performance)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPACETIME="${SPACETIME_BIN:-spacetime}"
STDB_PORT=3000
CLIENT_PORT=3006
DB_NAME="poc8arena"
STDB_LOG="$SCRIPT_DIR/.spacetime.log"
CLIENT_LOG="$SCRIPT_DIR/.vite.log"

# Default: wipe data. Accumulated match data degrades tick performance severely.
WIPE_DATA=true
if [[ "${1:-}" == "--keep-data" ]]; then
  WIPE_DATA=false
fi

# ── Helpers ───────────────────────────────────────────────────────

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m==>\033[0m $*"; }
err()  { echo -e "\033[1;31m==>\033[0m $*" >&2; }

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    warn "Killing existing process(es) on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

wait_for_port() {
  local port=$1
  local timeout=${2:-30}
  local elapsed=0
  while ! lsof -i:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $timeout ]]; then
      err "Timed out waiting for port $port after ${timeout}s"
      return 1
    fi
  done
}

# ── 1. Kill existing services on reserved ports ───────────────────

log "Cleaning up ports $STDB_PORT and $CLIENT_PORT..."
kill_port $STDB_PORT
kill_port $CLIENT_PORT

# ── 2. Start SpacetimeDB server ──────────────────────────────────

log "Starting SpacetimeDB server on port $STDB_PORT..."
"$SPACETIME" start --listen-addr "0.0.0.0:$STDB_PORT" > "$STDB_LOG" 2>&1 &
STDB_PID=$!

log "Waiting for SpacetimeDB to be ready..."
if ! wait_for_port $STDB_PORT 15; then
  err "SpacetimeDB failed to start. Check $STDB_LOG"
  cat "$STDB_LOG"
  exit 1
fi
log "SpacetimeDB running (PID $STDB_PID)"

# ── 3. Build & publish server module ─────────────────────────────

log "Building SpacetimeDB module..."
cd "$SCRIPT_DIR/server/spacetimedb"
npm run build --silent 2>&1

if $WIPE_DATA; then
  log "Publishing module to $DB_NAME (wiping old data)..."
  "$SPACETIME" publish -c=always -y -s local "$DB_NAME" 2>&1
else
  log "Publishing module to $DB_NAME (keeping data)..."
  "$SPACETIME" publish -s local "$DB_NAME" 2>&1 || {
    warn "Publish failed — trying with --delete-data on-conflict..."
    "$SPACETIME" publish -c=on-conflict -y -s local "$DB_NAME" 2>&1
  }
fi

# ── 4. Seed 16 creatures & start a match ─────────────────────────

log "Seeding 16 creatures and starting match..."
cd "$SCRIPT_DIR/server"
bun run "$SCRIPT_DIR/server/seed-and-start.ts" 2>&1 &
SEED_PID=$!

# ── 5. Start Vite client dev server ──────────────────────────────

log "Installing client dependencies..."
cd "$SCRIPT_DIR/client"
bun install --silent 2>&1

log "Starting Vite dev server on port $CLIENT_PORT..."
npx vite --host > "$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!

if ! wait_for_port $CLIENT_PORT 15; then
  err "Vite failed to start. Check $CLIENT_LOG"
  cat "$CLIENT_LOG"
  exit 1
fi

# Wait for seed script to finish
wait $SEED_PID 2>/dev/null || warn "Seed script exited with errors (match may not have started)"

# ── 6. Summary ───────────────────────────────────────────────────

echo ""
log "All services running:"
echo "  SpacetimeDB:  http://localhost:$STDB_PORT  (PID $STDB_PID, log: $STDB_LOG)"
echo "  Vite client:  http://localhost:$CLIENT_PORT  (PID $CLIENT_PID, log: $CLIENT_LOG)"
echo ""
echo "  Press Ctrl+C to stop all services."
echo ""

# ── Cleanup on exit ──────────────────────────────────────────────

cleanup() {
  echo ""
  log "Shutting down..."
  kill $STDB_PID 2>/dev/null || true
  kill $CLIENT_PID 2>/dev/null || true
  wait 2>/dev/null
  log "Done."
}
trap cleanup EXIT INT TERM

# Keep script alive (foreground) — wait for any child to exit
wait
