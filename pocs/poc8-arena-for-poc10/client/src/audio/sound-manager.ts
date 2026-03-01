/**
 * SoundManager — maps SpacetimeDB match events to creature synth triggers.
 *
 * Each creature gets a derived synth profile (body_size, material, weight,
 * aggression) computed from its part tree. Before each trigger, the synth
 * params are swapped to the acting creature's profile so every creature
 * sounds distinct.
 *
 * Lifecycle: init() on first user interaction (button click),
 * registerCreature() when parts arrive, trigger methods from callbacks,
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

// ── Timing / throttle constants ──────────────────────────────────

/** Minimum seconds between footstep sounds per creature */
const FOOTSTEP_COOLDOWN_S = 0.5;
/** Minimum distance delta (squared) to consider a creature "moving" */
const FOOTSTEP_MOVE_THRESHOLD_SQ = 0.5;
/** Suppress footstep if creature had a combat sound within this window (seconds) */
const FOOTSTEP_COMBAT_SUPPRESS_S = 0.4;
/** Per-creature cooldown for combat sounds (seconds) — prevents burst stacking */
const COMBAT_COOLDOWN_PER_CREATURE_S = 0.15;
/** Global max triggers per tick window to prevent wall-of-noise from server batches */
const GLOBAL_TRIGGER_WINDOW_MS = 50;
const GLOBAL_MAX_TRIGGERS_PER_WINDOW = 4;

// ── Synth profile derivation from part composition ───────────────

/** Per-creature synth character derived from its part tree */
export interface CreatureSynthProfile {
  bodySize: number;   // 0 (small) → 1 (large)
  material: number;   // 0 (organic) → 1 (armored/metallic)
  weight: number;     // 0 (light) → 1 (heavy)
  aggression: number; // 0 (passive) → 1 (aggressive)
}

/** Body size values by body part ID */
const BODY_SIZE: Record<string, number> = {
  body_small: 0.3,
  body_large: 0.8,
  body_centipede: 0.6,
};
const BODY_SIZE_DEFAULT = 0.5;

/** Parts that contribute to aggression score */
const WEAPON_PARTS = new Set([
  'claw_small', 'claw_large', 'spike', 'stinger', 'mandible',
]);

/** Parts that contribute to material/armor score */
const ARMOR_PARTS = new Set([
  'armor_plate', 'shell_dorsal',
]);

/** Parts that contribute to weight (legs = mobility, reduce effective weight) */
const LEG_PARTS = new Set([
  'leg_short', 'leg_long', 'wing',
]);

/**
 * Derive synth profile from a list of partId strings.
 * All values clamped to [0, 1].
 */
export function deriveSynthProfile(partIds: string[]): CreatureSynthProfile {
  if (partIds.length === 0) {
    return { bodySize: BODY_SIZE_DEFAULT, material: 0, weight: 0.5, aggression: 0.3 };
  }

  // Body size: from the body part
  const bodyPart = partIds.find((id) => id.startsWith('body_'));
  const bodySize = bodyPart ? (BODY_SIZE[bodyPart] ?? BODY_SIZE_DEFAULT) : BODY_SIZE_DEFAULT;

  // Count categories
  const totalParts = partIds.length;
  let weaponCount = 0;
  let armorCount = 0;
  let legCount = 0;

  for (const id of partIds) {
    if (WEAPON_PARTS.has(id)) weaponCount++;
    if (ARMOR_PARTS.has(id)) armorCount++;
    if (LEG_PARTS.has(id)) legCount++;
  }

  // Material: armor ratio (0 = pure organic, 1 = heavily armored)
  const material = Math.min(1, armorCount / 2);

  // Weight: body size + part count, reduced by legs (legs = mobility)
  const rawWeight = bodySize * 0.5 + (totalParts - legCount) * 0.08;
  const weight = Math.min(1, Math.max(0, rawWeight));

  // Aggression: weapon ratio relative to total parts
  const aggression = Math.min(1, weaponCount / Math.max(1, totalParts - 1) * 2);

  return { bodySize, material, weight, aggression };
}

export class SoundManager {
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sab: SharedArrayBuffer | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  /** Per-creature synth profiles, keyed by creatureIdx */
  private profiles = new Map<number, CreatureSynthProfile>();
  /** Track which creature's params are currently loaded in the synth */
  private activeCreatureIdx = -1;

  /** Track last known positions for footstep detection */
  private lastPositions = new Map<number, { x: number; y: number; time: number }>();
  /** Track last combat sound time per creature (for footstep suppression) */
  private lastCombatTime = new Map<number, number>();
  /** Track last combat trigger time per creature (per-creature cooldown) */
  private lastCombatTrigger = new Map<number, number>();
  /** Global trigger rate limiter: timestamps of recent triggers */
  private recentTriggerTime = 0;
  private recentTriggerCount = 0;

  /**
   * Must be called from a user gesture (button click).
   * AudioContext is created synchronously in the gesture call stack,
   * then everything else is handed off to the AudioWorklet thread.
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    // Synchronous in the click handler — browser requires user gesture
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ sampleRate: 48000 });
    }

    this.initPromise = this._init();
    return this.initPromise;
  }

  private setStatus(text: string, color = '#666'): void {
    const el = document.getElementById('btn-sound');
    if (el) {
      el.textContent = `SND: ${text}`;
      el.style.color = color;
    }
  }

  private async _init(): Promise<void> {
    try {
      // 1. Load WASM module
      this.setStatus('WASM...', '#ff0');
      const wasmModule = await loadCreatureSynthWasm();

      // 2. Resume AudioContext (already created synchronously in init())
      this.setStatus('AudioCtx...', '#ff0');
      if (this.audioCtx!.state === 'suspended') {
        await this.audioCtx!.resume();
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

  /**
   * Register a creature's synth profile from its part IDs.
   * Call this when a creature's parts are fully loaded.
   */
  registerCreature(creatureIdx: number, partIds: string[]): void {
    const profile = deriveSynthProfile(partIds);
    this.profiles.set(creatureIdx, profile);
  }

  /**
   * Swap synth params to the given creature before triggering.
   * Skips the postMessage if this creature is already active.
   */
  private applyCreatureParams(creatureIdx: number): void {
    if (creatureIdx === this.activeCreatureIdx) return;

    const profile = this.profiles.get(creatureIdx);
    if (!profile) return;

    this.activeCreatureIdx = creatureIdx;
    this.workletNode!.port.postMessage({
      type: 'setParams',
      body_size: profile.bodySize,
      material: profile.material,
      weight: profile.weight,
      aggression: profile.aggression,
    });
  }

  /**
   * Global rate limiter — prevents wall-of-noise when server dumps
   * a batch of events from one tick all at once.
   * Returns true if the trigger is allowed.
   */
  private globalThrottleAllows(): boolean {
    const now = performance.now();
    if (now - this.recentTriggerTime > GLOBAL_TRIGGER_WINDOW_MS) {
      // New window
      this.recentTriggerTime = now;
      this.recentTriggerCount = 1;
      return true;
    }
    this.recentTriggerCount++;
    return this.recentTriggerCount <= GLOBAL_MAX_TRIGGERS_PER_WINDOW;
  }

  /** Trigger a specific sound type for a specific creature */
  private triggerFor(creatureIdx: number, soundType: number): void {
    if (!this.ready) return;
    if (!this.globalThrottleAllows()) return;
    this.ensureResumed();
    this.applyCreatureParams(creatureIdx);
    this.workletNode!.port.postMessage({ type: 'trigger', soundType });
  }

  // ── Event hooks (called from main.ts SpacetimeDB callbacks) ────

  /**
   * Try to trigger a combat sound for a creature.
   * Applies per-creature cooldown and marks combat time (to suppress footsteps).
   */
  private triggerCombat(creatureIdx: number, soundType: number): void {
    const now = performance.now() / 1000;
    const lastTrigger = this.lastCombatTrigger.get(creatureIdx) ?? 0;
    if (now - lastTrigger < COMBAT_COOLDOWN_PER_CREATURE_S) return;

    this.lastCombatTrigger.set(creatureIdx, now);
    this.lastCombatTime.set(creatureIdx, now);
    this.triggerFor(creatureIdx, soundType);
  }

  /** Called on contact_hit event — triggers claw strike sound */
  onContactHit(creatureIdx: number): void {
    this.triggerCombat(creatureIdx, SOUND_CLAW_STRIKE);
  }

  /** Called on part_lost event — triggers part detach sound */
  onPartLost(creatureIdx: number): void {
    this.triggerCombat(creatureIdx, SOUND_PART_DETACH);
  }

  /** Called on creature death — triggers part detach (heavier, bypasses cooldown) */
  onCreatureDeath(creatureIdx: number): void {
    this.lastCombatTime.set(creatureIdx, performance.now() / 1000);
    this.triggerFor(creatureIdx, SOUND_PART_DETACH);
  }

  /**
   * Called on creature position update — triggers footsteps based on movement.
   * Suppressed if the creature recently made a combat sound (they overlap badly).
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
        // Suppress footstep if creature just did a combat sound
        const lastCombat = this.lastCombatTime.get(creatureIdx) ?? 0;
        if (now - lastCombat > FOOTSTEP_COMBAT_SUPPRESS_S) {
          this.triggerFor(creatureIdx, SOUND_FOOTSTEP);
        }
        this.lastPositions.set(creatureIdx, { x, y, time: now });
      }
    } else {
      // First position — just record, no sound
      this.lastPositions.set(creatureIdx, { x, y, time: now });
    }
  }

  /** Called on attack_swing — triggers claw strike */
  onAttackSwing(creatureIdx: number): void {
    this.triggerCombat(creatureIdx, SOUND_CLAW_STRIKE);
  }

  /** Release all voices (match end cleanup) */
  releaseAll(): void {
    if (!this.ready) return;
    this.workletNode!.port.postMessage({ type: 'releaseAll' });
    this.clearTrackingState();
  }

  /** Clear per-creature tracking state (match reset) */
  resetState(): void {
    this.clearTrackingState();
    this.profiles.clear();
  }

  private clearTrackingState(): void {
    this.lastPositions.clear();
    this.lastCombatTime.clear();
    this.lastCombatTrigger.clear();
    this.activeCreatureIdx = -1;
    this.recentTriggerCount = 0;
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
    this.clearTrackingState();
    this.profiles.clear();
  }
}
