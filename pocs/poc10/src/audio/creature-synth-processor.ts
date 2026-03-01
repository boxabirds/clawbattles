/**
 * AudioWorkletProcessor for creature sound synthesis.
 *
 * Architecture (following rusty-waves-dsp patterns):
 * - WASM engine runs entirely inside the worklet
 * - Commands arrive via port.postMessage()
 * - Telemetry published to SharedArrayBuffer (lock-free atomics)
 */

import init, {
  init_engine,
  render_block,
  trigger_sound,
  set_creature_params,
  get_active_voice_count,
  get_peak_level,
  get_total_renders,
  release_all_voices,
} from '@creature-synth/creature_synth.js';

// SAB telemetry layout (Int32 view)
const SAB_ACTIVE_VOICES = 0;
const SAB_TOTAL_RENDERS = 1;
// SAB telemetry layout (Float32 view, offset by 2 int slots = 8 bytes)
const SAB_PEAK_LEVEL = 2;
const SAB_RENDER_US = 3;
const SAB_STATE_SLOTS = 4;

const BLOCK_FRAMES = 128;
const CHANNELS = 2;

type Command =
  | { type: 'trigger'; soundType: number }
  | { type: 'setParams'; body_size: number; material: number; weight: number; aggression: number }
  | { type: 'releaseAll' }
  | { type: 'stressTest'; count: number; soundType: number };

class CreatureSynthProcessor extends AudioWorkletProcessor {
  private engineReady = false;
  private pendingCommands: Command[] = [];
  private blockBuffer: Float32Array;
  private sabInt32: Int32Array | null = null;
  private sabFloat32: Float32Array | null = null;

  constructor(options: AudioWorkletProcessorOptions) {
    super();

    const { wasmModule, sab } = options.processorOptions as {
      wasmModule: WebAssembly.Module;
      sab: SharedArrayBuffer;
    };

    this.blockBuffer = new Float32Array(BLOCK_FRAMES * CHANNELS);

    // Set up SAB telemetry views
    if (sab) {
      this.sabInt32 = new Int32Array(sab, 0, SAB_STATE_SLOTS);
      this.sabFloat32 = new Float32Array(sab, 0, SAB_STATE_SLOTS);
    }

    // Initialize WASM engine
    this.initEngine(wasmModule);

    this.port.onmessage = (event: MessageEvent) => {
      const cmd = event.data as Command;
      if (!this.engineReady) {
        this.pendingCommands.push(cmd);
        return;
      }
      this.handleCommand(cmd);
    };
  }

  private async initEngine(wasmModule: WebAssembly.Module): Promise<void> {
    try {
      await init({ module_or_path: wasmModule });
      init_engine(sampleRate);
      this.engineReady = true;

      // Flush pending commands
      for (const cmd of this.pendingCommands) {
        this.handleCommand(cmd);
      }
      this.pendingCommands = [];

      this.port.postMessage({ type: 'ready', sampleRate, blockFrames: BLOCK_FRAMES });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  private handleCommand(cmd: Command): void {
    switch (cmd.type) {
      case 'trigger':
        trigger_sound(cmd.soundType);
        break;
      case 'setParams':
        set_creature_params(cmd.body_size, cmd.material, cmd.weight, cmd.aggression);
        break;
      case 'releaseAll':
        release_all_voices();
        break;
      case 'stressTest':
        for (let i = 0; i < cmd.count; i++) {
          trigger_sound(cmd.soundType);
        }
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    if (!this.engineReady) {
      // Fill silence
      const out = outputs[0];
      if (out) {
        for (const ch of out) ch.fill(0);
      }
      return true;
    }

    // Measure render time (performance may not exist in AudioWorklet scope)
    const hasPerfNow = typeof performance !== 'undefined' && performance.now;
    const t0 = hasPerfNow ? performance.now() : 0;

    // Render into interleaved buffer
    render_block(this.blockBuffer);

    const renderUs = hasPerfNow ? (performance.now() - t0) * 1000 : 0;

    // Deinterleave to output channels
    const out = outputs[0];
    if (out && out.length >= CHANNELS) {
      const left = out[0];
      const right = out[1];
      for (let i = 0; i < BLOCK_FRAMES; i++) {
        left[i] = this.blockBuffer[i * CHANNELS];
        right[i] = this.blockBuffer[i * CHANNELS + 1];
      }
    }

    // Write telemetry to SAB (lock-free atomics)
    if (this.sabInt32 && this.sabFloat32) {
      Atomics.store(this.sabInt32, SAB_ACTIVE_VOICES, get_active_voice_count());
      Atomics.store(this.sabInt32, SAB_TOTAL_RENDERS, get_total_renders());
      // Float32 writes via DataView for atomicity
      this.sabFloat32[SAB_PEAK_LEVEL] = get_peak_level();
      this.sabFloat32[SAB_RENDER_US] = renderUs;
    }

    return true;
  }
}

registerProcessor('creature-synth-processor', CreatureSynthProcessor);
