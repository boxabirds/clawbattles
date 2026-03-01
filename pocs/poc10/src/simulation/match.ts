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
    const facing = angle + Math.PI;
    spawns.push({ position, facing });
  }

  return spawns;
}

// ── Live match (step-by-step for arena display) ───────────────────

/** Mutable match state for step-by-step playback */
export interface LiveMatch {
  creatures: CreatureState[];
  rng: SeededRNG;
  events: SensoryEvent[];
  deathOrder: string[];
  tick: number;
  maxTicks: number;
  finished: boolean;
}

/** Initialize a live match for step-by-step tick playback */
export function initLiveMatch(config: MatchConfig): LiveMatch {
  const rng = new SeededRNG(config.seed);
  const spawns = getSpawnPositions(config.creatures.length);

  const creatures: CreatureState[] = config.creatures.map((blueprint, i) => {
    const spawn = spawns[i];
    return initCreature(`creature_${i}`, blueprint, spawn.position, spawn.facing);
  });

  return {
    creatures,
    rng,
    events: [],
    deathOrder: [],
    tick: 0,
    maxTicks: config.maxTicks,
    finished: false,
  };
}

/** Advance one tick. Returns new events from this tick. */
export function stepTick(match: LiveMatch): SensoryEvent[] {
  if (match.finished) return [];

  match.tick++;
  const tickEvents: SensoryEvent[] = [];

  // Count alive creatures
  const aliveCreatures = match.creatures.filter((c) => c.alive);
  if (aliveCreatures.length <= 1) {
    match.finished = true;
    return [];
  }

  // Reset per-tick deltas
  for (const c of match.creatures) {
    c.tickDamageDealt = 0;
    c.tickDamageTaken = 0;
    c.tickPartsLost = 0;
    c.brainStance = 0;
  }

  // Phase 1: Energy
  energyPhase(match.creatures);

  // Phase 2: Drive update
  driveUpdatePhase(match.creatures);

  // Phase 3: Sense
  const visibility = sensePhase(match.creatures);
  for (const c of match.creatures) {
    c.hadVisibleEnemies = (visibility.get(c.id)?.length ?? 0) > 0;
  }

  // Phase 4: Movement
  movementPhase(match.creatures, visibility, match.rng);

  // Phase 5: Attack
  const hits = attackPhase(match.creatures, match.rng);

  // Phase 6: Damage
  damagePhase(hits, match.creatures, match.rng, tickEvents, match.tick);

  // Phase 7: Death check
  const aliveBefore = match.creatures.filter((c) => c.alive).map((c) => c.id);
  deathCheckPhase(match.creatures, tickEvents, match.tick);
  const aliveAfter = new Set(match.creatures.filter((c) => c.alive).map((c) => c.id));

  for (const id of aliveBefore) {
    if (!aliveAfter.has(id)) {
      match.deathOrder.push(id);
    }
  }

  // Check if match ended
  if (match.tick >= match.maxTicks || match.creatures.filter((c) => c.alive).length <= 1) {
    match.finished = true;
  }

  match.events.push(...tickEvents);
  return tickEvents;
}

/** Get final placements from a finished live match */
export function getMatchResult(match: LiveMatch): MatchResult {
  const placements = determinePlacements(match.creatures, match.deathOrder, match.tick);
  return {
    seed: 0, // seed not tracked in live match
    tickCount: match.tick,
    placements,
  };
}

// ── Batch match runner (for testing) ──────────────────────────────

export function runMatch(config: MatchConfig): MatchResult {
  const match = initLiveMatch(config);
  while (!match.finished) {
    stepTick(match);
  }
  return getMatchResult(match);
}

// ── Placement determination ───────────────────────────────────────

function determinePlacements(
  creatures: CreatureState[],
  deathOrder: string[],
  finalTick: number
): PlacementResult[] {
  const survivors = creatures.filter((c) => c.alive);
  const dead = creatures.filter((c) => !c.alive);

  survivors.sort((a, b) => b.damageDealt - a.damageDealt);

  const deadRanked = [...dead].sort((a, b) => {
    const aIdx = deathOrder.indexOf(a.id);
    const bIdx = deathOrder.indexOf(b.id);
    return bIdx - aIdx;
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
