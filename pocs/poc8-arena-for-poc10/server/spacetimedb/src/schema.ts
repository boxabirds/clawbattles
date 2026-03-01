/**
 * POC 8: ClawWorld Battle Arena — Schema
 *
 * All table definitions, constants, and part catalog live here.
 * Reducers live in index.ts to avoid circular type inference.
 */

import { schema, table, t } from 'spacetimedb/server';
import type { ReducerExport } from 'spacetimedb/server';

// ── Constants ─────────────────────────────────────────────────────
// Copied from src/simulation/constants.ts — single source of truth for server.

export const BUDGET = {
  MAX_PARTS: 12,
  MAX_WEIGHT: 20,
  ENERGY_PER_TICK: 10,
} as const;

export const ARENA = {
  RADIUS: 50,
  MAX_TICKS: 600,
  CREATURES_PER_MATCH: 16,
  TEAMS_PER_MATCH: 4,
  CREATURES_PER_TEAM: 4,
  SPAWN_RADIUS_FRACTION: 0.35,
  /** Radius within which team members cluster at spawn */
  TEAM_CLUSTER_SPREAD: 5,
} as const;

export const SPEED = {
  BASE: 1.5,
  MIN_WEIGHT_FACTOR: 0.1,
  LEG_DIMINISHING_RETURNS_THRESHOLD: 4,
  LEG_DIMINISHING_FACTOR: 0.3,
  SHORT_LEG_SPEED: 0.8,
  LONG_LEG_SPEED: 1.2,
  /** Wings: faster than long legs but fragile + expensive */
  WING_SPEED: 1.5,
  BASELINE_LEG_DIVISOR: 2.0,
  /** Nerfed from 0.9 → 0.25 to prevent blowout kills (max ~2× instead of 5-8×) */
  SPEED_DAMAGE_BONUS_FACTOR: 0.25,
} as const;

export const COMBAT = {
  ENERGY_DEFICIT_DAMAGE_RATE: 0.5,
  JOINT_DAMAGE_PROPAGATION: 0.15,
  CONTACT_RANGE: 3.5,
  MIN_ATTACK_RANGE: 1.5,
  ARMOR_REDUCTION_PER_POINT: 0.05,
  MAX_ARMOR_REDUCTION: 0.50,
  /** Buffed from 2 → 3 to give tanky builds more staying power */
  SHELL_FLAT_REDUCTION: 3,
  EVASION_PER_SPEED_SQ: 0.60,
  MAX_EVASION: 0.45,
  HIT_WEIGHT_PASSIVE_ARMOR: 3.0,
  HIT_WEIGHT_ARMOR: 2.5,
  HIT_WEIGHT_CORE: 0.5,
  HIT_WEIGHT_DEFAULT: 1.0,
  /** Damage per unit weight when bodies collide (prevents weaponless stalemates) */
  BUMP_DAMAGE_PER_WEIGHT: 0.05,
} as const;

/** Stamina / fatigue system — forces match resolution within 60s */
export const STAMINA = {
  /** Ticks of full-strength combat before fatigue kicks in (20s) */
  GRACE_PERIOD_TICKS: 200,
  /** Per-tick durability decay rate as fraction of part's max durability */
  DECAY_RATE_PER_TICK: 0.003,
  /** Decay accelerates linearly by this per tick after grace period */
  ACCELERATION: 0.000005,
} as const;

export const DRIVES = {
  AGGRESSION_BASELINE: 0.5,
  FEAR_BASELINE: 0.0,
  PAIN_BASELINE: 0.0,
  EXPLORATION_BASELINE: 0.0,
  DECAY_RATE: 0.05,
  PAIN_SPIKE_PER_DAMAGE: 0.1,
  FEAR_SPIKE_PER_PART_LOST: 0.3,
  FEAR_SPIKE_PER_DAMAGE: 0.02,
  AGGRESSION_SPIKE_PER_DAMAGE: 0.05,
  EXPLORATION_INCREASE_RATE: 0.02,
  DEFENSIVE_STANCE_THRESHOLD: -0.3,
} as const;

export const BRAIN = {
  INPUT_SIZE: 24,
  HIDDEN_1: 16,
  HIDDEN_2: 8,
  OUTPUT_SIZE: 4,
  TOPOLOGY: [24, 16, 8, 4] as readonly number[],
  TOTAL_WEIGHTS: 572,
  MAX_VISIBLE_ENEMIES: 3,
  FEATURES_PER_ENEMY: 4,
} as const;

export const SEPARATION = {
  /** Minimum distance between creature centers before repulsion kicks in */
  RADIUS: 2.5,
  /** Fraction of overlap to resolve per tick (< 1.0 for smooth, not jerky) */
  STRENGTH: 0.8,
  /** Below this distance, treat creatures as coincident and push apart along arbitrary axis */
  COINCIDENT_THRESHOLD: 0.001,
} as const;

export const HILL = {
  /** Hill radius per round — shrinks each round to force tighter fights */
  RADII: [12, 10, 7] as readonly number[],
  /** Minimum hill radius (used when round exceeds RADII array) */
  MIN_RADIUS: 7,
  /** How strongly creatures are pulled toward the hill center (0-1, blended with chase) */
  AI_HILL_PULL: 0.6,
  /** Distance from center beyond which hill pull kicks in at full strength */
  AI_HILL_PULL_DISTANCE: 10,
  /** Tick after which AI starts caring about the hill */
  AI_HILL_AWARENESS_TICK: 30,
} as const;

/** Game tick interval: 100ms in microseconds (10 ticks/sec) */
export const TICK_INTERVAL_MICROS = 100_000n;

// ── Part catalog ──────────────────────────────────────────────────

export type PartId =
  | 'body_small' | 'body_large' | 'body_centipede'
  | 'leg_short' | 'leg_long'
  | 'wing'
  | 'armor_plate'
  | 'claw_small' | 'claw_large' | 'spike' | 'stinger' | 'mandible'
  | 'sensor_eye' | 'sensor_antenna'
  | 'shell_dorsal';

export type PartRole = 'core' | 'locomotion' | 'weapon' | 'armor' | 'sensor' | 'passive_armor';

export type PortType = 'body' | 'limb' | 'sensor' | 'armor' | 'dorsal';

export interface PartDefinition {
  id: PartId;
  name: string;
  ports: number;
  weight: number;
  energyPerTick: number;
  role: PartRole;
  durability: number;
  armorValue: number;
  attachesTo: PortType[];
  providesPortTypes: PortType[];
  damage?: number;
  reach?: number;
  sensorRange?: number;
  sensorArc?: number;
  speedContribution?: number;
  contactDamage?: number;
}

const DURABILITY = {
  BODY_SMALL: 30, BODY_LARGE: 40, BODY_CENTIPEDE: 35,
  LEG_SHORT: 8, LEG_LONG: 8,
  WING: 6,
  /** Buffed from 30 → 35 */
  ARMOR_PLATE: 35,
  CLAW_SMALL: 8, CLAW_LARGE: 12,
  SPIKE: 5,
  STINGER: 6, MANDIBLE: 10,
  SENSOR_EYE: 4, SENSOR_ANTENNA: 4,
  /** Buffed from 35 → 40 */
  SHELL_DORSAL: 40,
} as const;

const WEAPON_STATS = {
  CLAW_SMALL_DAMAGE: 5, CLAW_SMALL_REACH: 2.5,
  CLAW_LARGE_DAMAGE: 7, CLAW_LARGE_REACH: 2.5,
  SPIKE_CONTACT_DAMAGE: 3,
  /** Glass cannon weapon: high damage, low durability */
  STINGER_DAMAGE: 12, STINGER_REACH: 2.0,
  /** Sustained cheap DPS: low damage, high durability, cheap energy */
  MANDIBLE_DAMAGE: 4, MANDIBLE_REACH: 1.5,
} as const;

const SENSOR_STATS = {
  EYE_RANGE: 50, EYE_ARC_DEGREES: 150,
  ANTENNA_RANGE: 25, ANTENNA_ARC_DEGREES: 360,
} as const;

const CATALOG_ENTRIES: PartDefinition[] = [
  // ── Cores ──
  { id: 'body_small', name: 'Body (small)', ports: 4, weight: 3, energyPerTick: 1, role: 'core', durability: DURABILITY.BODY_SMALL, armorValue: 0, attachesTo: [], providesPortTypes: ['limb', 'limb', 'sensor', 'armor'] },
  { id: 'body_large', name: 'Body (large)', ports: 8, weight: 6, energyPerTick: 2, role: 'core', durability: DURABILITY.BODY_LARGE, armorValue: 0, attachesTo: [], providesPortTypes: ['limb', 'limb', 'limb', 'limb', 'sensor', 'sensor', 'armor', 'armor'] },
  { id: 'body_centipede', name: 'Body (centipede)', ports: 10, weight: 5, energyPerTick: 2, role: 'core', durability: DURABILITY.BODY_CENTIPEDE, armorValue: 0, attachesTo: [], providesPortTypes: ['limb', 'limb', 'limb', 'limb', 'limb', 'limb', 'sensor', 'sensor', 'armor', 'armor'] },

  // ── Locomotion ──
  { id: 'leg_short', name: 'Leg (short)', ports: 1, weight: 1, energyPerTick: 1, role: 'locomotion', durability: DURABILITY.LEG_SHORT, armorValue: 0, attachesTo: ['limb'], providesPortTypes: ['limb'], speedContribution: SPEED.SHORT_LEG_SPEED },
  { id: 'leg_long', name: 'Leg (long)', ports: 1, weight: 2, energyPerTick: 2, role: 'locomotion', durability: DURABILITY.LEG_LONG, armorValue: 0, attachesTo: ['limb'], providesPortTypes: ['limb'], speedContribution: SPEED.LONG_LEG_SPEED },
  { id: 'wing', name: 'Wing', ports: 0, weight: 1, energyPerTick: 2, role: 'locomotion', durability: DURABILITY.WING, armorValue: 0, attachesTo: ['limb'], providesPortTypes: [], speedContribution: SPEED.WING_SPEED },

  // ── Armor ──
  { id: 'armor_plate', name: 'Armor plate', ports: 1, weight: 4, energyPerTick: 0, role: 'armor', durability: DURABILITY.ARMOR_PLATE, armorValue: 5, attachesTo: ['armor', 'limb'], providesPortTypes: [] },

  // ── Weapons ──
  { id: 'claw_small', name: 'Claw (small)', ports: 1, weight: 1, energyPerTick: 1, role: 'weapon', durability: DURABILITY.CLAW_SMALL, armorValue: 0, attachesTo: ['limb'], providesPortTypes: [], damage: WEAPON_STATS.CLAW_SMALL_DAMAGE, reach: WEAPON_STATS.CLAW_SMALL_REACH },
  { id: 'claw_large', name: 'Claw (large)', ports: 1, weight: 3, energyPerTick: 3, role: 'weapon', durability: DURABILITY.CLAW_LARGE, armorValue: 0, attachesTo: ['limb'], providesPortTypes: [], damage: WEAPON_STATS.CLAW_LARGE_DAMAGE, reach: WEAPON_STATS.CLAW_LARGE_REACH },
  { id: 'spike', name: 'Spike', ports: 1, weight: 1, energyPerTick: 0, role: 'weapon', durability: DURABILITY.SPIKE, armorValue: 0, attachesTo: ['limb', 'armor'], providesPortTypes: [], contactDamage: WEAPON_STATS.SPIKE_CONTACT_DAMAGE },
  { id: 'stinger', name: 'Stinger', ports: 0, weight: 2, energyPerTick: 2, role: 'weapon', durability: DURABILITY.STINGER, armorValue: 0, attachesTo: ['limb'], providesPortTypes: [], damage: WEAPON_STATS.STINGER_DAMAGE, reach: WEAPON_STATS.STINGER_REACH },
  { id: 'mandible', name: 'Mandible', ports: 0, weight: 2, energyPerTick: 1, role: 'weapon', durability: DURABILITY.MANDIBLE, armorValue: 0, attachesTo: ['limb'], providesPortTypes: [], damage: WEAPON_STATS.MANDIBLE_DAMAGE, reach: WEAPON_STATS.MANDIBLE_REACH },

  // ── Sensors ──
  { id: 'sensor_eye', name: 'Sensor (eye)', ports: 1, weight: 0.5, energyPerTick: 1, role: 'sensor', durability: DURABILITY.SENSOR_EYE, armorValue: 0, attachesTo: ['sensor', 'limb'], providesPortTypes: [], sensorRange: SENSOR_STATS.EYE_RANGE, sensorArc: SENSOR_STATS.EYE_ARC_DEGREES },
  { id: 'sensor_antenna', name: 'Sensor (antenna)', ports: 1, weight: 0.5, energyPerTick: 1, role: 'sensor', durability: DURABILITY.SENSOR_ANTENNA, armorValue: 0, attachesTo: ['sensor', 'limb'], providesPortTypes: [], sensorRange: SENSOR_STATS.ANTENNA_RANGE, sensorArc: SENSOR_STATS.ANTENNA_ARC_DEGREES },

  // ── Passive armor ──
  { id: 'shell_dorsal', name: 'Shell (dorsal)', ports: 0, weight: 5, energyPerTick: 0, role: 'passive_armor', durability: DURABILITY.SHELL_DORSAL, armorValue: 8, attachesTo: ['dorsal'], providesPortTypes: [] },
];

export const PART_CATALOG: ReadonlyMap<string, PartDefinition> = new Map(
  CATALOG_ENTRIES.map((p) => [p.id, p])
);

export function getPartDef(id: string): PartDefinition {
  const def = PART_CATALOG.get(id);
  if (!def) throw new Error(`Unknown part ID: ${id}`);
  return def;
}

// ── Late-binding holder for scheduled reducer ─────────────────────

export const scheduledReducerHolder: { ref: ReducerExport<any, any> | null } = {
  ref: null,
};

// ── Tables ────────────────────────────────────────────────────────

export const Match = table(
  { name: 'match', public: true },
  {
    matchId: t.u64().primaryKey().autoInc(),
    /** 'waiting' | 'running' | 'finished' */
    state: t.string(),
    seed: t.u32(),
    currentTick: t.u32(),
    maxTicks: t.u32(),
    hillRadius: t.f32(),
    winCondition: t.string(),
  }
);

export const MatchCreature = table(
  { name: 'match_creature', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64(),
    creatureIdx: t.u8(),
    designId: t.u64(),
    name: t.string(),
    /** Team index (0-3) — creatures only attack enemies on different teams */
    teamIdx: t.u8(),
    posX: t.f32(),
    posY: t.f32(),
    facing: t.f32(),
    speed: t.f32(),
    alive: t.bool(),
    deathCause: t.string(),
    tickOfDeath: t.u32(),
    // Drives
    aggression: t.f32(),
    fear: t.f32(),
    pain: t.f32(),
    exploration: t.f32(),
    // Per-tick deltas
    tickDamageDealt: t.f32(),
    tickDamageTaken: t.f32(),
    tickPartsLost: t.u8(),
    hadVisibleEnemies: t.bool(),
    brainStance: t.f32(),
    // Cumulative stats
    damageDealt: t.f32(),
    damageTaken: t.f32(),
    partsLost: t.u16(),
    partsDestroyed: t.u16(),
    // Derived stats
    totalWeight: t.f32(),
    totalEnergyDrain: t.f32(),
    totalArmor: t.f32(),
    contactDamage: t.f32(),
    placement: t.u8(),
  }
);

export const MatchPart = table(
  { name: 'match_part', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64(),
    creatureIdx: t.u8(),
    instanceId: t.string(),
    parentInstanceId: t.string(),
    partId: t.string(),
    currentDurability: t.f32(),
    accumulatedDamage: t.f32(),
    attached: t.bool(),
  }
);

export const MatchWeapon = table(
  { name: 'match_weapon', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64(),
    creatureIdx: t.u8(),
    instanceId: t.string(),
    damage: t.f32(),
    reach: t.f32(),
    attached: t.bool(),
  }
);

export const MatchSensor = table(
  { name: 'match_sensor', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64(),
    creatureIdx: t.u8(),
    instanceId: t.string(),
    range: t.f32(),
    arcRadians: t.f32(),
    attached: t.bool(),
  }
);

export const CreatureDesign = table(
  { name: 'creature_design', public: true },
  {
    designId: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    name: t.string(),
    /** JSON-encoded body tree (PartInstance[]) */
    bodyJson: t.string(),
    /** JSON-encoded brain topology (number[]) */
    brainTopology: t.string(),
    /** JSON-encoded brain weights (number[]) */
    brainWeights: t.string(),
  }
);

export const MatchEvent = table(
  { name: 'match_event', public: true, event: true },
  {
    matchId: t.u64(),
    tick: t.u32(),
    creatureIdx: t.u8(),
    eventType: t.string(),
    data: t.string(),
  }
);

export const TickSchedule = table(
  {
    name: 'tick_schedule',
    scheduled: () => scheduledReducerHolder.ref!,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const TickMetrics = table(
  { name: 'tick_metrics', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64(),
    tick: t.u32(),
    durationMicros: t.u64(),
  }
);

export const ArenaState = table(
  { name: 'arena_state', public: true },
  {
    id: t.u64().primaryKey(),
    roundNumber: t.u32(),
  }
);

// ── Schema export ─────────────────────────────────────────────────

const spacetimedb = schema({
  match: Match,
  matchCreature: MatchCreature,
  matchPart: MatchPart,
  matchWeapon: MatchWeapon,
  matchSensor: MatchSensor,
  creatureDesign: CreatureDesign,
  matchEvent: MatchEvent,
  tickSchedule: TickSchedule,
  tickMetrics: TickMetrics,
  arenaState: ArenaState,
});

export default spacetimedb;
