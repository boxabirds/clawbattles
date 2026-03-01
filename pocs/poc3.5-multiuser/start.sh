#!/usr/bin/env bash
set -euo pipefail

DB_NAME="poc35"
STDB_PORT=3000
VITE_PORT=3002

cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# 1. Ensure SpacetimeDB is running
# ---------------------------------------------------------------------------
if curl -sf "http://127.0.0.1:${STDB_PORT}/database/ping" >/dev/null 2>&1 \
   || lsof -i ":${STDB_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✓ SpacetimeDB already running on port ${STDB_PORT}"
else
  echo "→ Starting SpacetimeDB on port ${STDB_PORT}..."
  spacetime start --listen-addr "0.0.0.0:${STDB_PORT}" &
  STDB_PID=$!

  # Wait for it to accept connections
  for i in $(seq 1 30); do
    if lsof -i ":${STDB_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "✓ SpacetimeDB ready (pid ${STDB_PID})"
      break
    fi
    sleep 0.5
  done

  if ! lsof -i ":${STDB_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ SpacetimeDB failed to start" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 2. Build & publish the server module
# ---------------------------------------------------------------------------
echo "→ Publishing module to ${DB_NAME}..."
spacetime publish "$DB_NAME" --module-path server/spacetimedb

# ---------------------------------------------------------------------------
# 3. Regenerate client bindings
# ---------------------------------------------------------------------------
echo "→ Generating client bindings..."
spacetime generate --lang typescript --out-dir src/module_bindings --module-path server/spacetimedb

# ---------------------------------------------------------------------------
# 4. Install deps if needed
# ---------------------------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "→ Installing dependencies..."
  bun install
fi

# ---------------------------------------------------------------------------
# 5. Start Vite dev server
# ---------------------------------------------------------------------------
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  POC 3.5: Multi-User Creatures with IK Locomotion"
echo ""
echo "  Local:   http://localhost:${VITE_PORT}"
echo "  Network: http://${LOCAL_IP}:${VITE_PORT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec bun run dev
