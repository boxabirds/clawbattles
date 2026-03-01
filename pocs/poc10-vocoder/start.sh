#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/docker"
WEB_DIR="$SCRIPT_DIR/web"
TTS_PORT=5100
WEB_PORT=3010
HEALTH_TIMEOUT=120
HEALTH_INTERVAL=3

cleanup() {
  echo ""
  echo "=== Tearing down POC 10 ==="

  # Stop web dev server
  lsof -ti:"$WEB_PORT" | xargs kill 2>/dev/null || true
  echo "  Web server stopped"

  # Stop Docker container
  cd "$DOCKER_DIR"
  docker compose down 2>/dev/null || true
  echo "  Docker container stopped"

  echo "=== POC 10 torn down ==="
}

trap cleanup EXIT INT TERM

# --- 1. Kill anything already on our ports ---
lsof -ti:"$WEB_PORT" | xargs kill -9 2>/dev/null || true
EXISTING=$(docker ps -q --filter "publish=$TTS_PORT" 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  docker stop $EXISTING 2>/dev/null || true
fi
lsof -ti:"$TTS_PORT" | xargs kill -9 2>/dev/null || true

# --- 2. Build and start TTS Docker service ---
echo "=== POC 10: Building KittenTTS Docker service ==="
cd "$DOCKER_DIR"
docker compose up --build -d

# --- 3. Wait for TTS service to be healthy ---
echo "Waiting for TTS service on http://localhost:$TTS_PORT ..."
elapsed=0
while true; do
  if curl -sf "http://localhost:$TTS_PORT/health" > /dev/null 2>&1; then
    echo "  TTS service ready (${elapsed}s)"
    break
  fi
  if [ "$elapsed" -ge "$HEALTH_TIMEOUT" ]; then
    echo "  ERROR: TTS service did not start within ${HEALTH_TIMEOUT}s"
    echo "  Check logs: docker compose -f $DOCKER_DIR/docker-compose.yml logs"
    exit 1
  fi
  sleep "$HEALTH_INTERVAL"
  elapsed=$((elapsed + HEALTH_INTERVAL))
done

# --- 4. Install web deps if needed ---
cd "$WEB_DIR"
if [ ! -d "node_modules" ]; then
  echo "=== Installing web dependencies ==="
  bun install
fi

# --- 5. Start web dev server (foreground — Ctrl+C triggers cleanup) ---
echo ""
echo "=== POC 10: All services running ==="
echo "    TTS service:  http://localhost:$TTS_PORT  (health: /health, docs: /docs)"
echo "    Web client:   http://localhost:$WEB_PORT"
echo ""
echo "    Press Ctrl+C to tear everything down."
echo ""
bun run dev -- --port "$WEB_PORT" --strictPort
