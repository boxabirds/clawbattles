import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@creature-synth', replacement: path.resolve(__dirname, 'crate/pkg') },
      // Force bare 'three' imports (including OrbitControls' peer dep)
      // through the WebGPU bundle to avoid duplicate Three.js instances.
      // Uses exact match so 'three/examples/...' subpaths still resolve normally.
      { find: /^three$/, replacement: path.resolve(__dirname, 'node_modules/three/build/three.webgpu.js') },
    ],
  },
  server: {
    port: 3006,
    host: true,
  },
});
