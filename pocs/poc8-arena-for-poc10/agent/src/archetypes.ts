/**
 * Body archetypes for creature designs.
 * Returns JSON-serializable body trees matching the server's PartNode format.
 */

interface PartNode {
  partId: string;
  instanceId: string;
  children: PartNode[];
}

let counter = 0;
function p(partId: string, children: PartNode[] = []): PartNode {
  return { partId, instanceId: `${partId}_${counter++}`, children };
}

export type ArchetypeName =
  | 'berserker' | 'tank' | 'flanker' | 'spiker'
  | 'wasp' | 'centipede' | 'scorpion' | 'beetle' | 'mantis' | 'crawler';

const BODY_BUILDERS: Record<ArchetypeName, () => PartNode> = {
  berserker() {
    counter = 100;
    return p('body_small', [
      p('leg_long', [p('claw_large')]),
      p('leg_long', [p('claw_small')]),
      p('sensor_eye'),
      p('spike'),
    ]);
  },

  tank() {
    counter = 200;
    return p('body_large', [
      p('leg_short'),
      p('leg_short'),
      p('leg_short', [p('claw_small')]),
      p('sensor_antenna'),
      p('armor_plate'),
      p('shell_dorsal'),
    ]);
  },

  flanker() {
    counter = 300;
    return p('body_small', [
      p('leg_long', [p('claw_small')]),
      p('leg_long', [p('claw_small')]),
      p('sensor_eye'),
      p('spike'),
    ]);
  },

  spiker() {
    counter = 400;
    return p('body_large', [
      p('leg_short', [p('spike')]),
      p('leg_short', [p('spike')]),
      p('leg_short', [p('spike')]),
      p('leg_short', [p('spike')]),
      p('sensor_antenna'),
      p('sensor_antenna'),
    ]);
  },

  /** Glass cannon burst — wings for speed, stinger for damage */
  wasp() {
    counter = 500;
    return p('body_small', [
      p('wing'),
      p('wing'),
      p('leg_short', [p('stinger')]),
      p('sensor_eye'),
    ]);
  },

  /** Sustained DPS swarm — many legs, mandibles for cheap damage */
  centipede() {
    counter = 600;
    return p('body_centipede', [
      p('leg_short'),
      p('leg_short'),
      p('leg_short'),
      p('leg_short'),
      p('mandible'),
      p('mandible'),
      p('sensor_antenna'),
      p('sensor_antenna'),
    ]);
  },

  /** Burst + sustain — stinger and claw, some armor */
  scorpion() {
    counter = 700;
    return p('body_large', [
      p('leg_short'),
      p('leg_short'),
      p('stinger'),
      p('claw_large'),
      p('sensor_eye'),
      p('armor_plate'),
    ]);
  },

  /** Pure armor wall — heavy defensive build */
  beetle() {
    counter = 800;
    return p('body_large', [
      p('leg_short'),
      p('leg_short'),
      p('armor_plate'),
      p('shell_dorsal'),
      p('sensor_antenna'),
      p('spike'),
    ]);
  },

  /** DPS glass — dual large claws, fast but fragile */
  mantis() {
    counter = 900;
    return p('body_small', [
      p('leg_long', [p('claw_large')]),
      p('leg_long', [p('claw_large')]),
      p('sensor_eye'),
      p('spike'),
    ]);
  },

  /** Fast contact — centipede body with wings for speed, spikes for AoE */
  crawler() {
    counter = 1000;
    return p('body_centipede', [
      p('leg_short'),
      p('leg_short'),
      p('leg_short'),
      p('leg_short'),
      p('wing'),
      p('wing'),
      p('spike'),
      p('spike'),
      p('sensor_antenna'),
    ]);
  },
};

/** Get a body tree as a JSON string for the given archetype */
export function getBodyJson(archetype: ArchetypeName): string {
  return JSON.stringify(BODY_BUILDERS[archetype]());
}

/** Get all archetype names */
export function getArchetypeNames(): ArchetypeName[] {
  return Object.keys(BODY_BUILDERS) as ArchetypeName[];
}
