/**
 * POC 5.5: Creature Editor + SpacetimeDB -- Reducers & Lifecycle
 *
 * Imports the schema from schema.ts and defines all reducers.
 */

import spacetimedb from './schema';
import { t, SenderError } from 'spacetimedb/server';

export default spacetimedb;

/** Hex prefix length for auto-generated player names */
const PLAYER_NAME_HEX_PREFIX_LEN = 8;

// ---------------------------------------------------------------------------
// Lifecycle reducers
// ---------------------------------------------------------------------------

/**
 * client_connected -- create or reactivate a player record.
 */
export const onConnect = spacetimedb.clientConnected((ctx) => {
  const existing = ctx.db.player.identity.find(ctx.sender);

  if (existing) {
    ctx.db.player.identity.update({ ...existing, online: true });
    console.info(`[connect] Player "${existing.name}" reconnected.`);
  } else {
    const hexPrefix = ctx.sender.toHexString().slice(0, PLAYER_NAME_HEX_PREFIX_LEN);
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
 * save_creature -- create a new creature design owned by the caller.
 */
export const save_creature = spacetimedb.reducer(
  { name: t.string(), blueprint: t.string(), statsJson: t.string() },
  (ctx, { name, blueprint, statsJson }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) {
      throw new SenderError('Player not found. Connect first.');
    }

    const now = BigInt(Date.now());

    const row = ctx.db.creatureDesign.insert({
      id: 0n,
      owner: ctx.sender,
      name,
      blueprint,
      createdAt: now,
      updatedAt: now,
      deployed: false,
      statsJson,
    });

    console.info(`[save] Player "${player.name}" saved creature "${name}" (id=${row.id}).`);
  }
);

/**
 * update_creature -- update an existing creature design (must be owner).
 */
export const update_creature = spacetimedb.reducer(
  { id: t.u64(), name: t.string(), blueprint: t.string(), statsJson: t.string() },
  (ctx, { id, name, blueprint, statsJson }) => {
    const design = ctx.db.creatureDesign.id.find(id);
    if (!design) {
      throw new SenderError(`Creature design ${id} not found.`);
    }

    if (design.owner.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('You do not own this creature design.');
    }

    const now = BigInt(Date.now());

    ctx.db.creatureDesign.id.update({
      ...design,
      name,
      blueprint,
      statsJson,
      updatedAt: now,
    });

    console.info(`[update] Creature "${name}" (id=${id}) updated.`);
  }
);

/**
 * delete_creature -- delete a creature design (must be owner).
 */
export const delete_creature = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    const design = ctx.db.creatureDesign.id.find(id);
    if (!design) {
      throw new SenderError(`Creature design ${id} not found.`);
    }

    if (design.owner.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('You do not own this creature design.');
    }

    ctx.db.creatureDesign.id.delete(id);
    console.info(`[delete] Creature design ${id} deleted.`);
  }
);

/**
 * deploy_creature -- set deployed=true on this creature, deployed=false on
 * all other creatures owned by this player. Only one active at a time.
 */
export const deploy_creature = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    const design = ctx.db.creatureDesign.id.find(id);
    if (!design) {
      throw new SenderError(`Creature design ${id} not found.`);
    }

    if (design.owner.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('You do not own this creature design.');
    }

    // Un-deploy all other designs owned by this player
    for (const d of ctx.db.creatureDesign.design_owner.filter(ctx.sender)) {
      if (d.id !== id && d.deployed) {
        ctx.db.creatureDesign.id.update({ ...d, deployed: false });
      }
    }

    // Deploy the target design
    ctx.db.creatureDesign.id.update({ ...design, deployed: true });
    console.info(`[deploy] Creature "${design.name}" (id=${id}) deployed.`);
  }
);

/**
 * set_player_name -- sets the player's display name.
 */
export const set_player_name = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) {
      throw new SenderError('Player not found. Connect first.');
    }

    ctx.db.player.identity.update({ ...player, name });
    console.info(`[rename] Player renamed to "${name}".`);
  }
);
