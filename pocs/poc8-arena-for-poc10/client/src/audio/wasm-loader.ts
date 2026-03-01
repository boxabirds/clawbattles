/**
 * Loads the creature-synth WASM module for use in AudioWorklet.
 * Returns a compiled WebAssembly.Module (not an instance) so it can
 * be transferred to the worklet via processorOptions.
 */

import wasmUrl from '@creature-synth/creature_synth_bg.wasm?url';

let modulePromise: Promise<WebAssembly.Module> | null = null;

export function loadCreatureSynthWasm(): Promise<WebAssembly.Module> {
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    try {
      // Streaming compilation (fastest path)
      const response = fetch(wasmUrl);
      return await WebAssembly.compileStreaming(response);
    } catch {
      // Fallback: fetch bytes then compile
      const response = await fetch(wasmUrl);
      const bytes = await response.arrayBuffer();
      return WebAssembly.compile(bytes);
    }
  })();

  return modulePromise;
}
