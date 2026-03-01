/**
 * SoundManager — maps SpacetimeDB match events to creature synth triggers.
 *
 * Lifecycle: init() on first user interaction (button click),
 * trigger methods called from matchEvent/matchCreature callbacks,
 * dispose() on cleanup.
 */

import { loadCreatureSynthWasm } from './wasm-loader.js';

// ── Sound type constants (must match Rust engine) ────────────────
const SOUND_FOOTSTEP = 0;
const SOUND_CLAW_STRIKE = 1;
const SOUND_PART_DETACH = 2;
// const SOUND_IDLE_BREATH = 3;
// const SOUND_VOCALIZE = 4;

// ── SAB layout (must match creature-synth-processor.ts) ──────────
const SAB_STATE_SLOTS = 4;

// ── Footstep timing ──────────────────────────────────────────────
/** Minimum seconds between footstep sounds per creature */
const FOOTSTEP_COOLDOWN_S = 0.3;
/** Minimum distance delta (squared) to consider a creature "moving" */
const FOOTSTEP_MOVE_THRESHOLD_SQ = 0.5;

export class SoundManager {
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sab: SharedArrayBuffer | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  /** Track last known positions for footstep detection */
  private lastPositions = new Map<number, { x: number; y: number; time: number }>();

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private setStatus(text: string, color = '#666'): void {
    const el = document.getElementById('sound-status');
    if (el) {
      el.textContent = `SND: ${text}`;
      el.style.color = color;
    }
  }

  private async _init(): Promise<void> {
    try {
      // 1. Load WASM module (can run before AudioContext)
      this.setStatus('WASM...', '#ff0');
      const wasmModule = await loadCreatureSynthWasm();

      // 2. Create AudioContext — must be called within user gesture call stack
      this.setStatus('AudioCtx...', '#ff0');
      this.audioCtx = new AudioContext({ sampleRate: 48000 });

      // Explicitly resume in case browser suspended it
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // 3. Register AudioWorklet processor using new URL() pattern
      //    (Vite resolves this correctly for both dev and production)
      this.setStatus('Worklet...', '#ff0');
      const processorUrl = new URL('./creature-synth-processor.ts', import.meta.url).href;
      await this.audioCtx.audioWorklet.addModule(processorUrl);

      // 4. Create SAB for telemetry (optional — requires COEP headers)
      if (typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated) {
        this.sab = new SharedArrayBuffer(SAB_STATE_SLOTS * 4);
      }

      // 5. Create worklet node
      this.setStatus('Node...', '#ff0');
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'creature-synth-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          wasmModule,
          sab: this.sab ?? undefined,
        },
      });

      this.workletNode.connect(this.audioCtx.destination);

      // Wait for ready message from worklet
      this.setStatus('Engine...', '#ff0');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worklet init timeout')), 5000);
        this.workletNode!.port.onmessage = (ev) => {
          if (ev.data.type === 'ready') {
            clearTimeout(timeout);
            resolve();
          } else if (ev.data.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(ev.data.message));
          }
        };
      });

      this.ready = true;
      this.setStatus('OK', '#4ade80');
      console.log('[sound] Creature synth ready');
    } catch (err) {
      this.setStatus(`ERR: ${err}`, '#f44');
      console.warn('[sound] Failed to initialize:', err);
      this.ready = false;
    }
  }

  /** Resume AudioContext if browser suspended it (autoplay policy) */
  private ensureResumed(): void {
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /** Set synth character params based on creature properties */
  setCreatureParams(bodySize: number, material: number, weight: number, aggression: number): void {
    if (!this.ready) return;
    this.workletNode!.port.postMessage({
      type: 'setParams',
      body_size: bodySize,
      material,
      weight,
      aggression,
    });
  }

  /** Trigger a specific sound type */
  private trigger(soundType: number): void {
    if (!this.ready) return;
    this.ensureResumed();
    this.workletNode!.port.postMessage({ type: 'trigger', soundType });
  }

  // ── Event hooks (called from main.ts SpacetimeDB callbacks) ────

  /** Called on contact_hit event — triggers claw strike sound */
  onContactHit(): void {
    this.trigger(SOUND_CLAW_STRIKE);
  }

  /** Called on part_lost event — triggers part detach sound */
  onPartLost(): void {
    this.trigger(SOUND_PART_DETACH);
  }

  /** Called on creature death — triggers part detach (heavier) */
  onCreatureDeath(): void {
    this.trigger(SOUND_PART_DETACH);
  }

  /**
   * Called on creature position update — triggers footsteps based on movement.
   * Throttled per creature to avoid spam.
   */
  onCreatureMove(creatureIdx: number, x: number, y: number): void {
    if (!this.ready) return;

    const now = performance.now() / 1000;
    const last = this.lastPositions.get(creatureIdx);

    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const distSq = dx * dx + dy * dy;
      const elapsed = now - last.time;

      if (distSq > FOOTSTEP_MOVE_THRESHOLD_SQ && elapsed > FOOTSTEP_COOLDOWN_S) {
        this.trigger(SOUND_FOOTSTEP);
        this.lastPositions.set(creatureIdx, { x, y, time: now });
      }
    } else {
      // First position — just record, no sound
      this.lastPositions.set(creatureIdx, { x, y, time: now });
    }
  }

  /** Called on attack_swing — triggers claw strike */
  onAttackSwing(): void {
    this.trigger(SOUND_CLAW_STRIKE);
  }

  /** Release all voices (match end cleanup) */
  releaseAll(): void {
    if (!this.ready) return;
    this.workletNode!.port.postMessage({ type: 'releaseAll' });
    this.lastPositions.clear();
  }

  /** Clear per-creature tracking state (match reset) */
  resetState(): void {
    this.lastPositions.clear();
  }

  dispose(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.ready = false;
    this.initPromise = null;
    this.lastPositions.clear();
  }
}
