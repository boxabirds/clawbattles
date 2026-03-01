import type { CreatureBlueprint, PartInstance, PartId } from './types.js';

let instanceCounter = 0;

function p(partId: PartId, portIndex: number, children: PartInstance[] = []): PartInstance {
  return {
    partId,
    instanceId: `${partId}_${instanceCounter++}`,
    portIndex,
    children,
  };
}

function resetCounter(prefix: number): void {
  instanceCounter = prefix * 100;
}

// ── Port layout reference ──────────────────────────────────────────
//
// body_small portLayout indices:
//   0: limb   (left)
//   1: limb   (right)
//   2: sensor (top)
//   3: armor  (front)
//   4: dorsal (back)
//
// body_large portLayout indices:
//   0: limb   (left-front)
//   1: limb   (right-front)
//   2: limb   (left-back)
//   3: limb   (right-back)
//   4: sensor (top-front)
//   5: sensor (top-back)
//   6: armor  (front)
//   7: armor  (back)
//   8: dorsal (top)
//
// leg_short / leg_long portLayout indices:
//   0: limb   (bottom / tip)

export const ARCHETYPES = {
  /**
   * BERSERKER: Fast glass cannon.
   * Parts: 7 | Weight: 12.5 | Energy: 10
   */
  berserker(): CreatureBlueprint {
    resetCounter(1);
    return {
      name: 'Berserker',
      body: p('body_small', -1, [
        p('leg_long', 0, [p('claw_large', 0)]),   // left limb -> leg -> claw on tip
        p('leg_long', 1, [p('claw_small', 0)]),    // right limb -> leg -> claw on tip
        p('sensor_eye', 2),                         // top sensor
        p('spike', 3),                              // front armor port -> spike
      ]),
    };
  },

  /**
   * TANK: Slow, heavily armored, moderate offense.
   * Parts: 8 | Weight: 19.5 | Energy: 7
   */
  tank(): CreatureBlueprint {
    resetCounter(2);
    return {
      name: 'Tank',
      body: p('body_large', -1, [
        p('leg_short', 0),                          // left-front limb
        p('leg_short', 1),                          // right-front limb
        p('leg_short', 2, [p('claw_small', 0)]),    // left-back limb -> claw on tip
        p('sensor_antenna', 4),                     // top-front sensor
        p('armor_plate', 6),                        // front armor
        p('shell_dorsal', 8),                       // dorsal slot
      ]),
    };
  },

  /**
   * FLANKER: Fastest creature, dual-claw striker.
   * Parts: 7 | Weight: 10.5 | Energy: 8
   */
  flanker(): CreatureBlueprint {
    resetCounter(3);
    return {
      name: 'Flanker',
      body: p('body_small', -1, [
        p('leg_long', 0, [p('claw_small', 0)]),    // left limb -> leg -> claw
        p('leg_long', 1, [p('claw_small', 0)]),    // right limb -> leg -> claw
        p('sensor_eye', 2),                         // top sensor
        p('spike', 3),                              // front armor port -> spike
      ]),
    };
  },

  /**
   * SPIKER: Many legs, spike on every tip.
   * Parts: 11 | Weight: 15 | Energy: 8
   */
  spiker(): CreatureBlueprint {
    resetCounter(4);
    return {
      name: 'Spiker',
      body: p('body_large', -1, [
        p('leg_short', 0, [p('spike', 0)]),         // left-front -> spike
        p('leg_short', 1, [p('spike', 0)]),         // right-front -> spike
        p('leg_short', 2, [p('spike', 0)]),         // left-back -> spike
        p('leg_short', 3, [p('spike', 0)]),         // right-back -> spike
        p('sensor_antenna', 4),                     // top-front sensor
        p('sensor_antenna', 5),                     // top-back sensor
      ]),
    };
  },
};

export type ArchetypeName = keyof typeof ARCHETYPES;

export function getArchetypeNames(): ArchetypeName[] {
  return Object.keys(ARCHETYPES) as ArchetypeName[];
}

export function buildAllArchetypes(): Array<{ name: ArchetypeName; blueprint: CreatureBlueprint }> {
  return getArchetypeNames().map((name) => ({
    name,
    blueprint: ARCHETYPES[name](),
  }));
}
