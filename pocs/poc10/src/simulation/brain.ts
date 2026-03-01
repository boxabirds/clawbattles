import type { BrainSpec, BrainLayer, BrainOutput, CreatureState } from './types.js';
import type { VisibleEnemy } from './sensory.js';
import { BRAIN, ARENA, BUDGET, DRIVES } from './constants.js';

// ── Brain weight parsing ─────────────────────────────────────────

/**
 * Parse a flat BrainSpec (topology + flattened weights) into structured layers.
 * Each layer has a weight matrix (inSize x outSize) and bias vector (outSize).
 */
export function parseBrainWeights(spec: BrainSpec): BrainLayer[] {
  const { topology, weights } = spec;
  const layers: BrainLayer[] = [];
  let offset = 0;

  for (let l = 0; l < topology.length - 1; l++) {
    const inSize = topology[l];
    const outSize = topology[l + 1];
    const weightCount = inSize * outSize;

    layers.push({
      weights: weights.slice(offset, offset + weightCount),
      biases: weights.slice(offset + weightCount, offset + weightCount + outSize),
      outSize,
    });

    offset += weightCount + outSize;
  }

  return layers;
}

/**
 * Total parameter count for a given topology.
 * Each layer: inSize * outSize weights + outSize biases.
 */
export function totalWeightCount(topology: readonly number[]): number {
  let total = 0;
  for (let l = 0; l < topology.length - 1; l++) {
    const inSize = topology[l];
    const outSize = topology[l + 1];
    total += inSize * outSize + outSize;
  }
  return total;
}

// ── Forward pass ─────────────────────────────────────────────────

/**
 * Run a forward pass through the neural network.
 * Pure matrix math with tanh activation. No dependencies.
 */
export function forward(input: number[], layers: BrainLayer[]): number[] {
  let current = input;

  for (const layer of layers) {
    const next = new Array(layer.outSize).fill(0);
    for (let j = 0; j < layer.outSize; j++) {
      let sum = layer.biases[j];
      for (let i = 0; i < current.length; i++) {
        sum += current[i] * layer.weights[i * layer.outSize + j];
      }
      next[j] = Math.tanh(sum);
    }
    current = next;
  }

  return current;
}

// ── Input composition ────────────────────────────────────────────

/** Max total durability for a creature (used for health fraction normalization) */
function getMaxDurability(creature: CreatureState): number {
  let total = 0;
  function walk(part: CreatureState['rootPart']): void {
    total += part.definition.durability;
    for (const child of part.children) walk(child);
  }
  walk(creature.rootPart);
  return total;
}

/** Current total durability of attached parts */
function getCurrentDurability(creature: CreatureState): number {
  let total = 0;
  function walk(part: CreatureState['rootPart']): void {
    if (!part.attached) return;
    total += Math.max(0, part.currentDurability);
    for (const child of part.children) walk(child);
  }
  walk(creature.rootPart);
  return total;
}

/**
 * Compose the brain input vector from creature state + visible enemies.
 *
 * Respects information economy: only sensor-detected enemies appear.
 * A creature with no sensors gets all zeros for enemy features.
 *
 * All values normalized to roughly [-1, 1] for tanh compatibility.
 *
 * Layout (24 floats):
 *   [0..3]   drives: aggression, fear, pain, exploration
 *   [4..11]  own state: health_frac, speed_norm, facing_norm, posX_norm,
 *            posY_norm, weapon_count_norm, armor_frac, energy_surplus_frac
 *   [12..23] visible enemies (up to 3, zero-padded):
 *            per enemy: [relative_angle_norm, distance_norm, approx_size_norm, is_approaching]
 */
export function composeBrainInput(
  creature: CreatureState,
  visibleEnemies: VisibleEnemy[],
): number[] {
  const input = new Array(BRAIN.INPUT_SIZE).fill(0);

  // ── Drives (0..3) — already in [0, 1], map to [-1, 1] ─────────
  input[0] = creature.drives.aggression * 2 - 1;
  input[1] = creature.drives.fear * 2 - 1;
  input[2] = creature.drives.pain * 2 - 1;
  input[3] = creature.drives.exploration * 2 - 1;

  // ── Own state (4..11) ──────────────────────────────────────────
  const maxDur = getMaxDurability(creature);
  const healthFrac = maxDur > 0 ? getCurrentDurability(creature) / maxDur : 0;
  input[4] = healthFrac * 2 - 1;             // [0,1] -> [-1,1]
  input[5] = creature.speed / 3 - 1;         // speed ~0-3, normalize
  input[6] = creature.facing / Math.PI;      // [-PI, PI] -> [-1, 1]
  input[7] = creature.position.x / ARENA.RADIUS;  // [-R, R] -> [-1, 1]
  input[8] = creature.position.y / ARENA.RADIUS;
  const MAX_WEAPON_COUNT = 4;
  input[9] = creature.weapons.length / MAX_WEAPON_COUNT * 2 - 1;
  const MAX_ARMOR = BUDGET.MAX_WEIGHT;       // rough upper bound
  input[10] = creature.totalArmor / MAX_ARMOR * 2 - 1;
  const energySurplus = BUDGET.ENERGY_PER_TICK - creature.totalEnergyDrain;
  input[11] = energySurplus / BUDGET.ENERGY_PER_TICK;  // >0 = surplus, <0 = deficit

  // ── Visible enemies (12..23) ───────────────────────────────────
  // Only what sensors detect. Zero-padded if fewer than MAX_VISIBLE_ENEMIES.
  const enemyCount = Math.min(visibleEnemies.length, BRAIN.MAX_VISIBLE_ENEMIES);
  for (let e = 0; e < enemyCount; e++) {
    const enemy = visibleEnemies[e];
    const base = 12 + e * BRAIN.FEATURES_PER_ENEMY;

    // Relative angle: difference between enemy bearing and creature facing, normalized
    const relAngle = enemy.angle - creature.facing;
    input[base + 0] = Math.sin(relAngle);  // [-1, 1] naturally

    // Distance normalized by arena diameter
    const ARENA_DIAMETER = ARENA.RADIUS * 2;
    input[base + 1] = 1 - (enemy.distance / ARENA_DIAMETER) * 2;  // close=+1, far=-1

    // Approximate size (part count proxy — not exact stats, just visual bulk)
    const MAX_PARTS = BUDGET.MAX_PARTS;
    const enemySize = estimateVisualSize(enemy.creature);
    input[base + 2] = enemySize / MAX_PARTS * 2 - 1;

    // Is approaching (dot product of enemy velocity toward us)
    const dx = creature.position.x - enemy.creature.position.x;
    const dy = creature.position.y - enemy.creature.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      const towardX = dx / dist;
      const towardY = dy / dist;
      const enemyFacingX = Math.cos(enemy.creature.facing);
      const enemyFacingY = Math.sin(enemy.creature.facing);
      input[base + 3] = towardX * enemyFacingX + towardY * enemyFacingY;  // [-1, 1]
    }
  }

  return input;
}

/**
 * Estimate visual size of a creature — what sensors reveal.
 * This is approximate part count, NOT exact stats. Respects information economy.
 */
function estimateVisualSize(creature: CreatureState): number {
  let count = 0;
  function walk(part: CreatureState['rootPart']): void {
    if (!part.attached) return;
    count++;
    for (const child of part.children) walk(child);
  }
  walk(creature.rootPart);
  return count;
}

// ── Output decoding ──────────────────────────────────────────────

/**
 * Decode raw tanh outputs [-1, 1] into game actions.
 */
export function decodeBrainOutput(
  rawOutput: number[],
  visibleEnemyCount: number,
): BrainOutput {
  // Movement angle: scale tanh [-1,1] to full circle [-PI, PI]
  const movementAngle = rawOutput[0] * Math.PI;

  // Movement speed: map [-1,1] to [0,1]
  const movementSpeed = (rawOutput[1] + 1) / 2;

  // Target index: map [-1,1] to [0, visibleEnemyCount-1], or -1 if no enemies
  let targetIndex = -1;
  if (visibleEnemyCount > 0) {
    const normalized = (rawOutput[2] + 1) / 2;  // [0, 1]
    targetIndex = Math.min(
      Math.floor(normalized * visibleEnemyCount),
      visibleEnemyCount - 1,
    );
  }

  // Stance: raw tanh output, [-1, 1]. Negative = defensive, positive = aggressive.
  const stance = rawOutput[3];

  return { movementAngle, movementSpeed, targetIndex, stance };
}
