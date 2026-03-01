/**
 * Maps combat simulation events to creature synth triggers.
 *
 * Sound types from the Rust engine:
 *   0: Footstep       (movement)
 *   1: ClawStrike      (attacks)
 *   2: PartDetach      (limb/part lost)
 *   3: IdleBreath      (ambient)
 *   4: Vocalize        (victory / pain cries)
 */

import type { SensoryEvent, CreatureState, CreatureBlueprint } from '../simulation/types.js';
import { loadCreatureSynthWasm } from './wasm-loader.js';
import { collectParts } from '../editor/editor-state.js';
import { getPartDef } from '../simulation/catalog.js';

// ── Sound type IDs (match Rust engine enum) ────────────────────
const SOUND_FOOTSTEP = 0;
const SOUND_CLAW_STRIKE = 1;
const SOUND_PART_DETACH = 2;
const SOUND_IDLE_BREATH = 3;
const SOUND_VOCALIZE = 4;

// ── Telemetry SAB layout ───────────────────────────────────────
const SAB_BYTE_SIZE = 16; // 4 × Int32/Float32 slots
const SAB_ACTIVE_VOICES = 0;

// ── Timing constants ───────────────────────────────────────────
const FOOTSTEP_INTERVAL_MS = 400;
const IDLE_BREATH_INTERVAL_MS = 3000;
const MIN_EVENT_INTERVAL_MS = 50; // debounce rapid-fire events

// ── Creature → synth param mapping constants ───────────────────
const BODY_SIZE_SMALL = 0.3;
const BODY_SIZE_LARGE = 0.7;
const WEIGHT_NORMALIZE = 25; // max typical weight
const AGGRESSION_NORMALIZE = 5; // max typical weapon count

export class SoundManager {
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sab: SharedArrayBuffer | null = null;
  private sabInt32: Int32Array | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  // Footstep timing per creature
  private lastFootstep: Map<string, number> = new Map();
  private lastBreath: Map<string, number> = new Map();
  private lastEventTime = 0;

  /**
   * Initialize audio engine. Must be called from a user gesture.
   * Safe to call multiple times — returns cached promise.
   */
  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    try {
      // 1. Compile WASM module
      const wasmModule = await loadCreatureSynthWasm();

      // 2. Create AudioContext
      this.audioCtx = new AudioContext({ sampleRate: 44100 });

      // 3. Create SAB for telemetry
      this.sab = new SharedArrayBuffer(SAB_BYTE_SIZE);
      this.sabInt32 = new Int32Array(this.sab, 0, 4);

      // 4. Register AudioWorklet processor
      // The processor file needs to be loaded as a URL for the worklet
      const processorUrl = new URL('./creature-synth-processor.ts', import.meta.url).href;
      await this.audioCtx.audioWorklet.addModule(processorUrl);

      // 5. Create AudioWorkletNode
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'creature-synth-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          wasmModule,
          sab: this.sab,
        },
      });

      // Connect to destination
      this.workletNode.connect(this.audioCtx.destination);

      // Wait for engine ready message
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Synth init timeout')), 5000);
        this.workletNode!.port.onmessage = (ev: MessageEvent) => {
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
      console.log('[SoundManager] Audio engine initialized');
    } catch (err) {
      console.warn('[SoundManager] Failed to initialize audio:', err);
      this.ready = false;
    }
  }

  /** Derive synth params from a creature blueprint */
  setCreatureParams(blueprint: CreatureBlueprint): void {
    if (!this.ready || !this.workletNode) return;

    const parts = collectParts(blueprint.body);
    const isLargeBody = blueprint.body.partId === 'body_large';

    let weaponCount = 0;
    let armorCount = 0;
    let totalWeight = 0;

    for (const part of parts) {
      const def = getPartDef(part.partId);
      totalWeight += def.weight;

      if (def.role === 'weapon') weaponCount++;
      if (def.role === 'armor' || def.role === 'passive_armor') armorCount++;
    }

    const body_size = isLargeBody ? BODY_SIZE_LARGE : BODY_SIZE_SMALL;
    const material = Math.min(1, armorCount / 3); // more armor = harder material
    const weight = Math.min(1, totalWeight / WEIGHT_NORMALIZE);
    const aggression = Math.min(1, weaponCount / AGGRESSION_NORMALIZE);

    this.workletNode.port.postMessage({
      type: 'setParams',
      body_size,
      material,
      weight,
      aggression,
    });
  }

  /** Process combat events from simulation tick */
  processEvents(events: SensoryEvent[], creatures: CreatureState[]): void {
    if (!this.ready) return;

    const now = performance.now();

    for (const ev of events) {
      // Debounce rapid events
      if (now - this.lastEventTime < MIN_EVENT_INTERVAL_MS) continue;

      switch (ev.type) {
        case 'contact_hit':
          this.trigger(SOUND_CLAW_STRIKE);
          this.lastEventTime = now;
          break;

        case 'part_lost':
          this.trigger(SOUND_PART_DETACH);
          this.lastEventTime = now;
          break;

        case 'enemy_killed':
          this.trigger(SOUND_VOCALIZE);
          this.lastEventTime = now;
          break;
      }
    }

    // Footsteps for moving creatures
    for (const creature of creatures) {
      if (!creature.alive) continue;

      const lastStep = this.lastFootstep.get(creature.id) ?? 0;
      const stepInterval = FOOTSTEP_INTERVAL_MS / Math.max(0.5, creature.speed / 4);

      if (now - lastStep > stepInterval) {
        this.trigger(SOUND_FOOTSTEP);
        this.lastFootstep.set(creature.id, now);
      }
    }

    // Ambient breathing (less frequent)
    if (creatures.length > 0) {
      const anyAlive = creatures.find((c) => c.alive);
      if (anyAlive) {
        const lastBreath = this.lastBreath.get('global') ?? 0;
        if (now - lastBreath > IDLE_BREATH_INTERVAL_MS) {
          this.trigger(SOUND_IDLE_BREATH);
          this.lastBreath.set('global', now);
        }
      }
    }
  }

  /** Trigger a sound on the synth engine */
  private trigger(soundType: number): void {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: 'trigger', soundType });
  }

  /** Get active voice count from telemetry SAB */
  getActiveVoices(): number {
    if (!this.sabInt32) return 0;
    return Atomics.load(this.sabInt32, SAB_ACTIVE_VOICES);
  }

  /** Clean up audio resources */
  dispose(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'releaseAll' });
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.ready = false;
    this.initPromise = null;
    this.lastFootstep.clear();
    this.lastBreath.clear();
  }
}
