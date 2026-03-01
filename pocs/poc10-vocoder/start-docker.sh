#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/docker"
PORT=5100

echo "=== POC 10: Starting KittenTTS Docker service ==="

# Kill any existing container on our port
echo "Checking for existing processes on port $PORT..."
EXISTING=$(docker ps -q --filter "publish=$PORT" 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  echo "Stopping existing container(s) on port $PORT..."
  docker stop $EXISTING 2>/dev/null || true
fi

# Also kill any non-Docker process on the port
lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true

cd "$DOCKER_DIR"
echo "Building and starting container..."
docker compose up --build -d

echo ""
echo "=== KittenTTS service starting on http://localhost:$PORT ==="
echo "    Health check: curl http://localhost:$PORT/health"
echo "    API docs:     http://localhost:$PORT/docs"
echo ""
echo "Tailing logs (Ctrl+C to detach, container keeps running)..."
docker compose logs -f
