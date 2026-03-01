/**
 * POC 5.5: Creature Editor + SpacetimeDB -- Schema
 *
 * All table definitions and the schema export live here.
 * Reducers live in index.ts to avoid circular type inference.
 */

import { schema, table, t } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Player table -- tracks connected identities with display names.
 */
export const Player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    online: t.bool(),
  }
);

/**
 * CreatureDesign table -- stores creature blueprints as JSON.
 * Each design belongs to an owner (Identity) and can be deployed
 * to the arena (only one deployed per player at a time).
 */
export const CreatureDesign = table(
  {
    name: 'creature_design',
    public: true,
    indexes: [
      { accessor: 'design_owner', algorithm: 'btree' as const, columns: ['owner'] as const },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    name: t.string(),
    blueprint: t.string(),
    createdAt: t.u64(),
    updatedAt: t.u64(),
    deployed: t.bool(),
    statsJson: t.string(),
  }
);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const spacetimedb = schema({
  player: Player,
  creatureDesign: CreatureDesign,
});

export default spacetimedb;
