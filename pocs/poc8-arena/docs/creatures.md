# Creature System

Source of truth: `server/spacetimedb/src/schema.ts` (part catalog, constants).

## Budgets

| Resource | Limit | Notes |
|----------|-------|-------|
| Parts | 12 max | Total attached parts per creature |
| Weight | 20 max | Sum of all part weights; heavier = slower |
| Energy | 10/tick | Active parts consume energy each tick; deficit damages parts |

## Bodies

Every creature has exactly one body. The body determines HP, weight, energy overhead, and available ports.

| Body | Weight | Energy | HP | Ports | Notes |
|------|--------|--------|----|-------|-------|
| Small | 3 | 1 | 30 | 4 (2 limb, 1 sensor, 1 armor) | Light, fast chassis |
| Large | 6 | 2 | 40 | 8 (4 limb, 2 sensor, 2 armor) | Heavy, tanky chassis |
| Centipede | 5 | 2 | 35 | 10 (6 limb, 2 sensor, 2 armor) | Most ports, mid-weight |

## Locomotion

Speed formula: `BASE (1.5) + sum(speedContributions) / BASELINE_LEG_DIVISOR (2.0)`, penalized by weight and with diminishing returns after 4 legs.

Speed also drives:
- **Evasion**: up to 45% dodge chance via `EVASION_PER_SPEED_SQ (0.6) * speed^2`
- **Damage bonus**: `1 + speed^2 * 0.25` (nerfed from 0.9 -- max ~2x instead of 5-8x)

| Part | Speed | Weight | Energy | HP | Sub-ports | Notes |
|------|-------|--------|--------|----|-----------|-------|
| Short leg | 0.8 | 1 | 1 | 8 | 1 limb | Cheap, reliable |
| Long leg | 1.2 | 2 | 2 | 8 | 1 limb | Faster, heavier, opens a sub-port for weapons |
| Wing | 1.5 | 1 | 2 | 6 | 0 | Fastest per-weight but fragile, no sub-ports |

## Weapons

Two types: **active** (swing at enemies in range) and **passive** (damage on body collision).

| Part | Damage | Reach | Weight | Energy | HP | Type |
|------|--------|-------|--------|--------|----|------|
| Small claw | 5 | 2.5 | 1 | 1 | 8 | Active -- efficient DPS |
| Large claw | 7 | 2.5 | 3 | 3 | 12 | Active -- burst damage, durable |
| Stinger | 12 | 2.0 | 2 | 2 | 6 | Active -- glass cannon |
| Mandible | 4 | 1.5 | 2 | 1 | 10 | Active -- cheap sustained DPS |
| Spike | 3 | contact | 1 | 0 | 5 | Passive -- zero energy, damages on collision |

Bump damage also exists: all bodies deal `0.05 * weight` on collision, preventing weaponless stalemates.

## Defense

| Part | Armor value | HP | Weight | Energy | Mechanism |
|------|-------------|-----|--------|--------|-----------|
| Armor plate | 5 | 35 | 4 | 0 | % reduction: `5 * 5% = 25%` off incoming damage |
| Shell (dorsal) | 8 | 40 | 5 | 0 | Flat reduction: absorbs 3 damage per hit |

Hit targeting is weighted: armor and passive armor attract hits (weight 2.5 and 3.0) while the core body has low targeting weight (0.5). This means armor soaks hits preferentially.

## Sensors

Determine what the AI brain can perceive.

| Part | Range | Arc | Notes |
|------|-------|-----|-------|
| Eye | 25 | 120 degrees | Long range, narrow forward cone |
| Antenna | 10 | 360 degrees | Short range, full surround awareness |

Without sensors, the creature is blind and relies on hardcoded fallback AI.

## Stamina

Forces match resolution within ~60 seconds.

- **Grace period**: 200 ticks (20s) at full strength
- **Decay**: after grace, all parts lose `0.3% + (tick - 200) * 0.0005%` of max HP per tick
- **Effect**: high-durability builds (tank, beetle) survive fatigue longer; glass builds crumble

## Key Tradeoffs

- **Weight vs speed**: every part costs weight. Heavier creatures are slower, dodge less, and deal less speed-bonus damage.
- **Energy vs parts**: active weapons and legs eat energy. Armor, spikes, and shells are free. Overcommitting to active parts causes energy deficit, which damages your own parts.
- **Glass vs tank**: fast creatures evade (up to 45% dodge) but die in a few hits. Armored creatures tank through but can't chase or dodge.
- **Active vs passive weapons**: claws/stingers have range and high damage but cost energy. Spikes are free but require body contact.
- **Ports constrain builds**: small body only has 4 ports. Centipede has 10 but weighs more than small. Large has 8 but heaviest.

## Archetypes

Defined in `agent/src/archetypes.ts`. Currently 10 archetypes, with 16 creatures per match cycling through them.

| Archetype | Body | Parts | Strategy |
|-----------|------|-------|----------|
| Berserker | Small | 2 long legs, large claw, small claw, eye, spike | Fast burst -- hits hard, dies fast |
| Tank | Large | 3 short legs, small claw, antenna, armor, shell | Slow brick wall, soaks everything |
| Flanker | Small | 2 long legs, 2 small claws, eye, spike | Speed DPS, dual-wield efficient damage |
| Spiker | Large | 4 short legs (each with spike), 2 antennae | AoE contact damage, no active weapons |
| Wasp | Small | 2 wings, short leg, stinger, eye | Fastest creature, 12-damage burst, paper thin |
| Centipede | Centipede | 4 short legs, 2 mandibles, 2 antennae | Sustained cheap DPS, many legs |
| Scorpion | Large | 2 short legs, stinger, large claw, eye, armor | Burst + sustain hybrid with some protection |
| Beetle | Large | 2 short legs, armor, shell, antenna, spike | Pure armor wall -- maximum survivability |
| Mantis | Small | 2 long legs, 2 large claws, eye, spike | Maximum DPS, dual large claws, very fragile |
| Crawler | Centipede | 4 short legs, 2 wings, 2 spikes, antenna | Fast contact damage, centipede body with wings |

## Teams

Matches are 16 creatures in 4 teams of 4. Teammates cannot see or attack each other. Match ends when only one team has survivors. Teams spawn clustered at evenly-spaced angles around the arena.
