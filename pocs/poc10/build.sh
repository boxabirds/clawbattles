#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRATE_DIR="$SCRIPT_DIR/crate"
PKG_DIR="$CRATE_DIR/pkg"

echo "=== Building creature-synth WASM ==="

# Check wasm-pack
if ! command -v wasm-pack &> /dev/null; then
  echo "Installing wasm-pack..."
  cargo install wasm-pack
fi

# Build WASM (web target for AudioWorklet usage)
cd "$CRATE_DIR"
wasm-pack build --release --target web --out-dir pkg

echo "=== WASM build complete ==="
echo "Output: $PKG_DIR"
ls -lh "$PKG_DIR"/*.wasm "$PKG_DIR"/*.js 2>/dev/null || true
