import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 3020,
    host: true,
    headers: {
      // Required for SharedArrayBuffer (AudioWorklet + WASM telemetry)
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  resolve: {
    alias: {
      '@creature-synth': path.resolve(__dirname, 'crate/pkg'),
    },
  },
});
