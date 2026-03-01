/**
 * POC 2: SpacetimeDB 2.0 Module -- Schema
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

/** Default starting health for new players */
export const DEFAULT_PLAYER_HEALTH = 100;

/** Default creature movement speed (units per tick) */
export const DEFAULT_CREATURE_SPEED = 2.0;

/** Default body-part count for a newly spawned creature */
export const DEFAULT_CREATURE_PARTS = 3;

/** Game tick interval: 1 second in microseconds */
export const TICK_INTERVAL_MICROS = 1_000_000n;

/** Distance threshold to consider a creature "arrived" at its target */
export const ARRIVAL_THRESHOLD = 0.5;

/** Maximum distance for combat between two creatures */
export const COMBAT_RANGE = 3.0;

/** Base damage dealt per combat event */
export const COMBAT_BASE_DAMAGE = 10.0;

/** World boundary (max coordinate value) */
export const WORLD_BOUND = 500.0;

/** World center coordinate (spawn default) */
export const WORLD_CENTER = WORLD_BOUND / 2;

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
    x: t.f32(),
    y: t.f32(),
    health: t.u16(),
    online: t.bool(),
  }
);

export const Creature = table(
  {
    name: 'creature',
    public: true,
    indexes: [
      { accessor: 'creature_owner', algorithm: 'btree' as const, columns: ['owner'] as const },
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
    partCount: t.u16(),
  }
);

/**
 * Event table -- rows are transient (delivered to subscribers then discarded).
 * Combat events fire whenever two creatures from different owners overlap.
 */
export const EventCombat = table(
  { name: 'event_combat', public: true, event: true },
  {
    attackerId: t.u64(),
    defenderId: t.u64(),
    damage: t.f32(),
    x: t.f32(),
    y: t.f32(),
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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const spacetimedb = schema({
  player: Player,
  creature: Creature,
  eventCombat: EventCombat,
  tickSchedule: TickSchedule,
});

export default spacetimedb;
