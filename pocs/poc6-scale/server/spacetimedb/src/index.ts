/**
 * POC 6: SpacetimeDB at Scale -- Reducers & Lifecycle
 *
 * Imports the schema from schema.ts and defines all reducers.
 * The tick_world reducer is wired to TickSchedule via
 * scheduledReducerHolder (set at module load time, resolved later by SDK).
 *
 * Key measurement: tick_world records timing metrics for each tick
 * to validate whether SpacetimeDB can handle 500+ creatures at <250ms/tick.
 */

import spacetimedb from './schema';
import {
  scheduledReducerHolder,
  TickSchedule,
  TICK_INTERVAL_MICROS,
  WORLD_SIZE,
  WORLD_CENTER,
  CREATURE_SPEED,
  ARRIVAL_THRESHOLD,
  COMBAT_RANGE,
  COMBAT_DAMAGE,
  CHUNK_SIZE,
  MAX_TICK_METRICS,
} from './schema';
import { t } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

export default spacetimedb;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Monotonically increasing tick counter */
let tickCounter = 0n;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the chunk coordinate for a given world position */
function toChunk(coord: number): number {
  return Math.floor(coord / CHUNK_SIZE);
}

// ---------------------------------------------------------------------------
// Lifecycle reducers
// ---------------------------------------------------------------------------

/**
 * init -- runs once when the module is first published.
 * Seeds the tick schedule so the game loop starts immediately.
 */
export const init = spacetimedb.init((ctx) => {
  console.info('[init] Module published. Scheduling game tick.');

  ctx.db.tickSchedule.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(TICK_INTERVAL_MICROS),
  });

  console.info('[init] Game tick scheduled at 250ms interval (4 ticks/sec).');
});

/**
 * client_connected -- create or reactivate a player record.
 */
export const onConnect = spacetimedb.clientConnected((ctx) => {
  const existing = ctx.db.player.identity.find(ctx.sender);

  if (existing) {
    ctx.db.player.identity.update({ ...existing, online: true });
    console.info(`[connect] Player "${existing.name}" reconnected.`);
  } else {
    const hexPrefix = ctx.sender.toHexString().slice(0, 8);
    const playerName = `Player-${hexPrefix}`;

    ctx.db.player.insert({
      identity: ctx.sender,
      name: playerName,
      online: true,
    });
    console.info(`[connect] New player "${playerName}" joined.`);
  }
});

/**
 * client_disconnected -- mark player offline but keep data.
 */
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (player) {
    ctx.db.player.identity.update({ ...player, online: false });
    console.info(`[disconnect] Player "${player.name}" went offline.`);
  }
});

// ---------------------------------------------------------------------------
// Game reducers
// ---------------------------------------------------------------------------

/**
 * spawn_batch -- spawn `count` creatures at random positions with random targets.
 * Uses ctx.random() exclusively (Math.random is banned in SpacetimeDB modules).
 */
export const spawn_batch = spacetimedb.reducer(
  { count: t.u32() },
  (ctx, { count }) => {
    const random = ctx.random;

    for (let i = 0; i < count; i++) {
      const x = random() * WORLD_SIZE;
      const y = random() * WORLD_SIZE;
      const targetX = random() * WORLD_SIZE;
      const targetY = random() * WORLD_SIZE;

      ctx.db.creature.insert({
        id: 0n,
        owner: ctx.sender,
        x,
        y,
        targetX,
        targetY,
        speed: CREATURE_SPEED,
        health: 100.0,
        chunkX: toChunk(x),
        chunkY: toChunk(y),
      });
    }

    console.info(`[spawn_batch] Spawned ${count} creatures for ${ctx.sender.toHexString().slice(0, 8)}.`);
  }
);

/**
 * reset -- delete all creatures. Any connected player can trigger this.
 */
export const reset = spacetimedb.reducer(
  {},
  (ctx) => {
    let count = 0;
    for (const creature of [...ctx.db.creature.iter()]) {
      ctx.db.creature.id.delete(creature.id);
      count++;
    }
    console.info(`[reset] Deleted ${count} creatures.`);
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: game tick
// ---------------------------------------------------------------------------

/**
 * tick_world -- runs every 250ms via the TickSchedule table.
 *
 * Each tick:
 *  1. Record start time
 *  2. Move each creature toward its target
 *  3. When arrived, pick a new random target
 *  4. Check combat (N^2 within same chunk only -- spatial optimization)
 *  5. Record end time and insert TickMetrics row
 *  6. Prune old TickMetrics rows (keep last MAX_TICK_METRICS)
 */
export const tick_world = spacetimedb.reducer(
  { arg: TickSchedule.rowType },
  (ctx, { arg: _scheduleRow }) => {
    const startMs = Date.now();
    const random = ctx.random;

    const creatures = [...ctx.db.creature.iter()];
    const creatureCount = creatures.length;
    let combatEvents = 0;

    // Phase 1: movement
    for (const creature of creatures) {
      const dx = creature.targetX - creature.x;
      const dy = creature.targetY - creature.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > ARRIVAL_THRESHOLD) {
        // Move toward target
        const step = Math.min(creature.speed, dist);
        const nx = dx / dist;
        const ny = dy / dist;
        const newX = creature.x + nx * step;
        const newY = creature.y + ny * step;

        ctx.db.creature.id.update({
          ...creature,
          x: newX,
          y: newY,
          chunkX: toChunk(newX),
          chunkY: toChunk(newY),
        });
      } else {
        // Arrived — pick a new random target
        const newTargetX = random() * WORLD_SIZE;
        const newTargetY = random() * WORLD_SIZE;

        ctx.db.creature.id.update({
          ...creature,
          targetX: newTargetX,
          targetY: newTargetY,
        });
      }
    }

    // Phase 2: combat (N^2 within same chunk only)
    // Build chunk map for spatial lookup
    const chunkMap = new Map<string, typeof creatures>();
    for (const creature of creatures) {
      const key = `${creature.chunkX},${creature.chunkY}`;
      const bucket = chunkMap.get(key);
      if (bucket) {
        bucket.push(creature);
      } else {
        chunkMap.set(key, [creature]);
      }
    }

    // Check combat within each chunk
    for (const bucket of chunkMap.values()) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];

          // Skip same-owner combat
          if (a.owner.toHexString() === b.owner.toHexString()) {
            continue;
          }

          const cdx = a.x - b.x;
          const cdy = a.y - b.y;
          const combatDist = Math.sqrt(cdx * cdx + cdy * cdy);

          if (combatDist < COMBAT_RANGE) {
            combatEvents++;
            // Apply damage to both
            const newHealthA = a.health - COMBAT_DAMAGE;
            const newHealthB = b.health - COMBAT_DAMAGE;

            if (newHealthA > 0) {
              ctx.db.creature.id.update({ ...a, health: newHealthA });
            }
            if (newHealthB > 0) {
              ctx.db.creature.id.update({ ...b, health: newHealthB });
            }
          }
        }
      }
    }

    // Phase 3: record metrics
    const endMs = Date.now();
    const durationMicros = BigInt((endMs - startMs) * 1000);
    tickCounter++;

    ctx.db.tickMetrics.insert({
      id: 0n,
      tickNumber: tickCounter,
      creatureCount,
      durationMicros,
      combatEvents,
    });

    // Phase 4: prune old metrics (keep last MAX_TICK_METRICS)
    const allMetrics = [...ctx.db.tickMetrics.iter()];
    if (allMetrics.length > MAX_TICK_METRICS) {
      // Sort by tickNumber ascending, delete oldest
      allMetrics.sort((a, b) => Number(a.tickNumber - b.tickNumber));
      const toDelete = allMetrics.length - MAX_TICK_METRICS;
      for (let i = 0; i < toDelete; i++) {
        ctx.db.tickMetrics.id.delete(allMetrics[i].id);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Wire the scheduled table to the tick_world reducer.
// This runs at module load time. The SDK resolves the thunk
// (calls scheduledReducerHolder.ref) after all exports are registered.
// ---------------------------------------------------------------------------
scheduledReducerHolder.ref = tick_world;
