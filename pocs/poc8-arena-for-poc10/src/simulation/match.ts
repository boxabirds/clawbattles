import type {
  MatchConfig,
  MatchResult,
  CreatureState,
  RuntimePart,
  PartInstance,
  SensoryEvent,
  PlacementResult,
  Vec2,
  BrainLayer,
} from './types.js';
import { getPartDef } from './catalog.js';
import { ARENA, DRIVES } from './constants.js';
import { SeededRNG } from './prng.js';
import { parseBrainWeights } from './brain.js';
import {
  recalculateStats,
  energyPhase,
  driveUpdatePhase,
  sensePhase,
  movementPhase,
  attackPhase,
  damagePhase,
  deathCheckPhase,
} from './combat.js';

// ── Creature initialization ───────────────────────────────────────

/** Build a RuntimePart tree from a PartInstance blueprint */
function buildRuntimePart(blueprint: PartInstance, parent: RuntimePart | null): RuntimePart {
  const def = getPartDef(blueprint.partId);
  const part: RuntimePart = {
    instanceId: blueprint.instanceId,
    partId: blueprint.partId,
    definition: def,
    currentDurability: def.durability,
    accumulatedDamage: 0,
    attached: true,
    children: [],
    parent,
  };

  for (const childBlueprint of blueprint.children) {
    part.children.push(buildRuntimePart(childBlueprint, part));
  }

  return part;
}

/** Create initial creature state from blueprint, placed at spawn position */
function initCreature(
  id: string,
  blueprint: MatchConfig['creatures'][0],
  spawnPosition: Vec2,
  facingAngle: number
): CreatureState {
  const rootPart = buildRuntimePart(blueprint.body, null);

  // Parse brain weights into layer structure if brain is present
  let brainLayers: BrainLayer[] | null = null;
  if (blueprint.brain) {
    brainLayers = parseBrainWeights(blueprint.brain);
  }

  const creature: CreatureState = {
    id,
    name: blueprint.name,
    blueprint,
    rootPart,
    position: { ...spawnPosition },
    facing: facingAngle,
    alive: true,
    deathCause: null,
    tickOfDeath: null,
    brain: brainLayers,
    drives: {
      aggression: DRIVES.AGGRESSION_BASELINE,
      fear: DRIVES.FEAR_BASELINE,
      pain: DRIVES.PAIN_BASELINE,
      exploration: DRIVES.EXPLORATION_BASELINE,
    },
    speed: 0,
    totalWeight: 0,
    totalEnergyDrain: 0,
    sensorRanges: [],
    weapons: [],
    contactDamage: 0,
    totalArmor: 0,
    damageDealt: 0,
    damageTaken: 0,
    partsLost: 0,
    partsDestroyed: 0,
    tickDamageDealt: 0,
    tickDamageTaken: 0,
    tickPartsLost: 0,
    hadVisibleEnemies: false,
    brainStance: 0,
  };

  recalculateStats(creature);
  return creature;
}

/** Generate spawn positions evenly around the arena edge */
function getSpawnPositions(count: number): Array<{ position: Vec2; facing: number }> {
  const spawnRadius = ARENA.RADIUS * ARENA.SPAWN_RADIUS_FRACTION;
  const spawns: Array<{ position: Vec2; facing: number }> = [];

  for (let i = 0; i < count; i++) {
    const angle = (i * 2 * Math.PI) / count;
    const position: Vec2 = {
      x: Math.cos(angle) * spawnRadius,
      y: Math.sin(angle) * spawnRadius,
    };
    // Face toward center
    const facing = angle + Math.PI;
    spawns.push({ position, facing });
  }

  return spawns;
}

// ── Match runner ──────────────────────────────────────────────────

/**
 * Run a complete match. Returns results.
 * Deterministic: same seed + same creatures = same outcome.
 */
export function runMatch(config: MatchConfig): MatchResult {
  const rng = new SeededRNG(config.seed);
  const spawns = getSpawnPositions(config.creatures.length);

  // Initialize creatures
  const creatures: CreatureState[] = config.creatures.map((blueprint, i) => {
    const spawn = spawns[i];
    return initCreature(`creature_${i}`, blueprint, spawn.position, spawn.facing);
  });

  const events: SensoryEvent[] = [];
  const deathOrder: string[] = [];

  let tick = 0;
  for (tick = 1; tick <= config.maxTicks; tick++) {
    // Count alive creatures
    const aliveCreatures = creatures.filter((c) => c.alive);
    if (aliveCreatures.length <= 1) break;

    // Reset per-tick deltas
    for (const c of creatures) {
      c.tickDamageDealt = 0;
      c.tickDamageTaken = 0;
      c.tickPartsLost = 0;
      c.brainStance = 0;
    }

    // Phase 1: Energy
    energyPhase(creatures);

    // Phase 2: Drive update (uses previous tick's events to shift drives)
    driveUpdatePhase(creatures);

    // Phase 3: Sense
    const visibility = sensePhase(creatures);

    // Track visibility for drive system
    for (const c of creatures) {
      c.hadVisibleEnemies = (visibility.get(c.id)?.length ?? 0) > 0;
    }

    // Phase 4: Movement (brain-driven or hardcoded AI)
    movementPhase(creatures, visibility, rng);

    // Phase 5: Attack
    const hits = attackPhase(creatures, rng);

    // Phase 6: Damage
    damagePhase(hits, creatures, rng, events, tick);

    // Phase 7: Death check
    const aliveBefore = creatures.filter((c) => c.alive).map((c) => c.id);
    deathCheckPhase(creatures, events, tick);
    const aliveAfter = new Set(creatures.filter((c) => c.alive).map((c) => c.id));

    // Track death order
    for (const id of aliveBefore) {
      if (!aliveAfter.has(id)) {
        deathOrder.push(id);
      }
    }
  }

  // Determine placements
  const placements = determinePlacements(creatures, deathOrder, tick);

  return {
    seed: config.seed,
    tickCount: tick,
    placements,
  };
}

/** Determine final placements: survivors ranked by damage dealt, then dead by death order (reversed) */
function determinePlacements(
  creatures: CreatureState[],
  deathOrder: string[],
  finalTick: number
): PlacementResult[] {
  const survivors = creatures.filter((c) => c.alive);
  const dead = creatures.filter((c) => !c.alive);

  // Survivors ranked by damage dealt (most = 1st)
  survivors.sort((a, b) => b.damageDealt - a.damageDealt);

  // Dead ranked by death order (last to die = higher placement)
  const deadRanked = [...dead].sort((a, b) => {
    const aIdx = deathOrder.indexOf(a.id);
    const bIdx = deathOrder.indexOf(b.id);
    return bIdx - aIdx; // later death = higher rank
  });

  const allRanked = [...survivors, ...deadRanked];

  return allRanked.map((c, i) => ({
    creatureId: c.id,
    creatureName: c.name,
    placement: i + 1,
    damageDealt: Math.round(c.damageDealt * 100) / 100,
    damageTaken: Math.round(c.damageTaken * 100) / 100,
    partsLost: c.partsLost,
    partsDestroyed: c.partsDestroyed,
    ticksSurvived: c.alive ? finalTick : (c.tickOfDeath ?? finalTick),
    deathCause: c.alive ? 'survived' : c.deathCause,
  }));
}
