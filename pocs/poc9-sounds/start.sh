#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"
PORT=3009

# Kill any existing process on our port
lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true

# Build WASM first
"$SCRIPT_DIR/build.sh"

# Install web deps if needed
cd "$WEB_DIR"
if [ ! -d "node_modules" ]; then
  echo "=== Installing web dependencies ==="
  bun install
fi

echo ""
echo "=== Starting dev server on http://localhost:$PORT ==="
echo ""
bun run dev -- --port "$PORT" --strictPort
