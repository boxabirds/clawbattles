import type { CreatureBlueprint, PartInstance, PartId } from '../simulation/types.js';

/**
 * Helper to build a part instance with a unique ID.
 * Counter is scoped per-archetype via resetCounter().
 */
let instanceCounter = 0;
function p(partId: PartId, children: PartInstance[] = []): PartInstance {
  return {
    partId,
    instanceId: `${partId}_${instanceCounter++}`,
    children,
  };
}

function resetCounter(prefix: number): void {
  instanceCounter = prefix * 100;
}

// ── Port reference ────────────────────────────────────────────────
// body_small ports: [limb, limb, sensor, armor]          (4 ports + dorsal slot)
// body_large ports: [limb, limb, limb, limb, sensor, sensor, armor, armor] (8 ports + dorsal slot)
// leg_short ports:  [limb]                               (1 port — for mounting weapons/sensors on leg tip)
// leg_long ports:   [limb]                               (1 port)
//
// Part attachment rules (attachesTo):
//   legs       -> limb
//   claws      -> limb
//   spikes     -> limb, armor
//   armor      -> armor, limb
//   sensors    -> sensor, limb
//   shell      -> dorsal (doesn't consume a port)

// ── Weight/energy cheat sheet ─────────────────────────────────────
// MAX_WEIGHT = 20, ENERGY_PER_TICK = 10

export const ARCHETYPES = {
  /**
   * BERSERKER: Fast glass cannon. Two weapon-tipped legs, eye for targeting, spike for contact.
   *
   * Parts: 7 | Weight: 3+2+3+2+1+0.5+1 = 12.5 | Energy: 1+2+3+2+1+1+0 = 10 (exact budget)
   */
  berserker(): CreatureBlueprint {
    resetCounter(1);
    return {
      name: 'Berserker',
      body: p('body_small', [
        p('leg_long', [p('claw_large')]),    // limb 0 -> leg -> claw_large on leg's limb port
        p('leg_long', [p('claw_small')]),     // limb 1 -> leg -> claw_small on leg's limb port
        p('sensor_eye'),                      // sensor 0 -> 120-degree forward vision
        p('spike'),                           // armor 0 -> passive contact damage
      ]),
    };
  },

  /**
   * TANK: Slow, heavily armored, moderate offense. Outlasts enemies with armor + shell,
   * deals damage with claw_small on a leg tip. Antenna for 360-degree awareness.
   *
   * body_large(6) + 3 leg_short(3) + claw_small(1) + armor_plate(4) + antenna(0.5) + shell(5) = 19.5
   * Parts: 8 | Energy: 2+3+1+0+1+0 = 7 | Weight: 19.5
   */
  tank(): CreatureBlueprint {
    resetCounter(2);
    return {
      name: 'Tank',
      body: p('body_large', [
        p('leg_short'),                       // limb 0
        p('leg_short'),                       // limb 1
        p('leg_short', [p('claw_small')]),     // limb 2 -> claw on leg tip
        // limb 3 unused
        p('sensor_antenna'),                  // sensor 0 -> 360-degree awareness
        // sensor 1 unused
        p('armor_plate'),                     // armor 0
        // armor 1 unused
        p('shell_dorsal'),                    // dorsal slot
      ]),
    };
  },

  /**
   * FLANKER: Fastest creature, dual-claw striker. body_small for minimum weight,
   * two long legs with claws, eye for targeting, spike for contact damage.
   * Compensates for fragility with extreme speed and evasion.
   *
   * Parts: 7 | Weight: 3+2+1+2+1+0.5+1 = 10.5 | Energy: 1+2+1+2+1+1+0 = 8
   */
  flanker(): CreatureBlueprint {
    resetCounter(3);
    return {
      name: 'Flanker',
      body: p('body_small', [
        p('leg_long', [p('claw_small')]),      // limb 0 -> leg -> claw on tip
        p('leg_long', [p('claw_small')]),       // limb 1 -> leg -> claw on tip
        p('sensor_eye'),                        // sensor 0 -> 120-degree long range
        p('spike'),                             // armor 0 -> contact damage
      ]),
    };
  },

  /**
   * SPIKER: Many legs, spike on every tip. Passive contact damage machine.
   *
   * body_large + 4 leg_short(spike each) + 2 sensor_antenna
   * Parts: 11 | Weight: 6+4+4+1 = 15 | Energy: 2+4+0+2 = 8
   */
  spiker(): CreatureBlueprint {
    resetCounter(4);
    return {
      name: 'Spiker',
      body: p('body_large', [
        p('leg_short', [p('spike')]),           // limb 0 -> leg -> spike
        p('leg_short', [p('spike')]),           // limb 1 -> leg -> spike
        p('leg_short', [p('spike')]),           // limb 2 -> leg -> spike
        p('leg_short', [p('spike')]),           // limb 3 -> leg -> spike
        p('sensor_antenna'),                    // sensor 0
        p('sensor_antenna'),                    // sensor 1
        // armor ports unused
      ]),
    };
    // Weight: 6+4*1+4*1+2*0.5 = 15 | Energy: 2+4*1+4*0+2*1 = 8
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
