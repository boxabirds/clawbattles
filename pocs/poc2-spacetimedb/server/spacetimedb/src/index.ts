/**
 * POC 2: SpacetimeDB 2.0 Module -- Reducers & Lifecycle
 *
 * Imports the schema from schema.ts and defines all reducers.
 * The tick_world reducer is wired to TickSchedule via
 * scheduledReducerHolder (set at module load time, resolved later by SDK).
 */

import spacetimedb from './schema';
import {
  scheduledReducerHolder,
  TickSchedule,
  DEFAULT_PLAYER_HEALTH,
  DEFAULT_CREATURE_SPEED,
  DEFAULT_CREATURE_PARTS,
  TICK_INTERVAL_MICROS,
  ARRIVAL_THRESHOLD,
  COMBAT_RANGE,
  COMBAT_BASE_DAMAGE,
  WORLD_BOUND,
  WORLD_CENTER,
} from './schema';
import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

export default spacetimedb;

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

  console.info('[init] Game tick scheduled at 1-second interval.');
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
      x: WORLD_CENTER,
      y: WORLD_CENTER,
      health: DEFAULT_PLAYER_HEALTH,
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
 * spawn_creature -- spawn a creature at (x, y) for the calling player.
 */
export const spawn_creature = spacetimedb.reducer(
  { x: t.f32(), y: t.f32() },
  (ctx, { x, y }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) {
      throw new SenderError('Player not found. Connect first.');
    }

    const clampedX = Math.max(0, Math.min(WORLD_BOUND, x));
    const clampedY = Math.max(0, Math.min(WORLD_BOUND, y));

    const row = ctx.db.creature.insert({
      id: 0n,
      owner: ctx.sender,
      x: clampedX,
      y: clampedY,
      targetX: clampedX,
      targetY: clampedY,
      speed: DEFAULT_CREATURE_SPEED,
      partCount: DEFAULT_CREATURE_PARTS,
    });

    console.info(
      `[spawn] Player "${player.name}" spawned creature ${row.id} at (${clampedX.toFixed(1)}, ${clampedY.toFixed(1)}).`
    );
  }
);

/**
 * move_creature -- set a creature's movement target.
 * Only the owner may move their creature.
 */
export const move_creature = spacetimedb.reducer(
  { creatureId: t.u64(), targetX: t.f32(), targetY: t.f32() },
  (ctx, { creatureId, targetX, targetY }) => {
    const creature = ctx.db.creature.id.find(creatureId);
    if (!creature) {
      throw new SenderError(`Creature ${creatureId} not found.`);
    }

    if (creature.owner.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('You do not own this creature.');
    }

    const clampedX = Math.max(0, Math.min(WORLD_BOUND, targetX));
    const clampedY = Math.max(0, Math.min(WORLD_BOUND, targetY));

    ctx.db.creature.id.update({
      ...creature,
      targetX: clampedX,
      targetY: clampedY,
    });
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: game tick
// ---------------------------------------------------------------------------

/**
 * tick_world -- runs every 1 second via the TickSchedule table.
 *
 * Each tick:
 *  1. Moves each creature toward its target at its speed.
 *  2. Checks proximity combat between creatures of different owners.
 *  3. Emits EventCombat rows for combat that occurs.
 */
export const tick_world = spacetimedb.reducer(
  { arg: TickSchedule.rowType },
  (ctx, { arg: _scheduleRow }) => {
    const creatures = [...ctx.db.creature.iter()];

    // Phase 1: movement
    for (const creature of creatures) {
      const dx = creature.targetX - creature.x;
      const dy = creature.targetY - creature.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > ARRIVAL_THRESHOLD) {
        const step = Math.min(creature.speed, dist);
        const nx = dx / dist;
        const ny = dy / dist;

        ctx.db.creature.id.update({
          ...creature,
          x: creature.x + nx * step,
          y: creature.y + ny * step,
        });
      }
    }

    // Phase 2: proximity combat
    for (let i = 0; i < creatures.length; i++) {
      for (let j = i + 1; j < creatures.length; j++) {
        const a = creatures[i];
        const b = creatures[j];

        if (a.owner.toHexString() === b.owner.toHexString()) {
          continue;
        }

        const cdx = a.x - b.x;
        const cdy = a.y - b.y;
        const combatDist = Math.sqrt(cdx * cdx + cdy * cdy);

        if (combatDist < COMBAT_RANGE) {
          ctx.db.eventCombat.insert({
            attackerId: a.id,
            defenderId: b.id,
            damage: COMBAT_BASE_DAMAGE,
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
          });
        }
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
