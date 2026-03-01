import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@creature-synth': path.resolve(__dirname, '../crate/pkg'),
    },
  },
  server: {
    port: 3009,
    headers: {
      // Required for SharedArrayBuffer
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
