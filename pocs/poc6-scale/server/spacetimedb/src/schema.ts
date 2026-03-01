/**
 * POC 6: SpacetimeDB at Scale -- Schema
 *
 * All table definitions and the schema export live here.
 * Reducers live in index.ts to avoid circular type inference.
 *
 * The TickSchedule table uses a late-binding holder for its
 * scheduled reducer reference. index.ts sets the holder after
 * defining tick_world.
 */

import { schema, table, t } from 'spacetimedb/server';
import type { ReducerExport } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Game tick interval: 250ms in microseconds (4 ticks/sec target) */
export const TICK_INTERVAL_MICROS = 250_000n;

/** World boundary size (0 to WORLD_SIZE) */
export const WORLD_SIZE = 1000.0;

/** World center coordinate */
export const WORLD_CENTER = WORLD_SIZE / 2;

/** Default creature movement speed (units per tick) */
export const CREATURE_SPEED = 1.0;

/** Distance threshold to consider a creature "arrived" at its target */
export const ARRIVAL_THRESHOLD = 1.0;

/** Maximum distance for combat between two creatures */
export const COMBAT_RANGE = 5.0;

/** Damage dealt per combat event */
export const COMBAT_DAMAGE = 1.0;

/** Spatial chunk size for combat optimization (10x10 grid) */
export const CHUNK_SIZE = 100;

/** Maximum number of TickMetrics rows to retain */
export const MAX_TICK_METRICS = 100;

// ---------------------------------------------------------------------------
// Late-binding holder for the scheduled reducer
// ---------------------------------------------------------------------------

/**
 * Mutable holder for the tick_world reducer reference.
 * index.ts sets this after defining the reducer.
 * The TickSchedule thunk reads it at resolution time (after all exports registered).
 */
export const scheduledReducerHolder: { ref: ReducerExport<any, any> | null } = {
  ref: null,
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const Player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    online: t.bool(),
  }
);

export const Creature = table(
  {
    name: 'creature',
    public: true,
    indexes: [
      { accessor: 'creature_owner', algorithm: 'btree' as const, columns: ['owner'] as const },
      { accessor: 'creature_chunk', algorithm: 'btree' as const, columns: ['chunkX', 'chunkY'] as const },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    x: t.f32(),
    y: t.f32(),
    targetX: t.f32(),
    targetY: t.f32(),
    speed: t.f32(),
    health: t.f32(),
    chunkX: t.i32(),
    chunkY: t.i32(),
  }
);

/**
 * Scheduled table -- drives the game-tick loop.
 * The thunk reads from scheduledReducerHolder, which index.ts populates.
 * SpacetimeDB resolves the thunk after all exports are registered.
 */
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
    tickNumber: t.u64(),
    creatureCount: t.u32(),
    durationMicros: t.u64(),
    combatEvents: t.u32(),
  }
);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const spacetimedb = schema({
  player: Player,
  creature: Creature,
  tickSchedule: TickSchedule,
  tickMetrics: TickMetrics,
});

export default spacetimedb;
