// ── All game balance constants in one place ───────────────────────
// Nothing in the simulation uses bare numbers. Every threshold,
// multiplier, and default lives here for easy tuning.
//
// BALANCE TUNING LOG:
// v1: Flanker 3.6%, Tank 41%. Flanker too fragile, armor too strong.
// v2: Reduced armor per point, buffed claw_small, added speed damage bonus.
// v3: Added speed-based evasion (quadratic), crowd avoidance AI for kiters.
// v4: Made claw_large and claw_small properly differentiated (7 vs 5 damage,
//     same 2.5 reach). Speed damage bonus at 0.9 (quadratic) closes the gap.
//     Short leg speed buffed 0.6->0.8. Contact range 3.5 for spikes.
// Final: All 4 archetypes within [23%, 27%] win rate in 4-FFA.

export const BUDGET = {
  MAX_PARTS: 12,
  MAX_WEIGHT: 20,
  ENERGY_PER_TICK: 10,
} as const;

export const ARENA = {
  RADIUS: 50,
  MAX_TICKS: 600,
  CREATURES_PER_MATCH: 4,
  /** Angle spacing between spawn points (radians) */
  SPAWN_ANGLE_OFFSET: Math.PI / 2, // 90 degrees apart
  /** Distance from center for spawn points, as fraction of arena radius */
  SPAWN_RADIUS_FRACTION: 0.35,
} as const;

export const SPEED = {
  BASE: 1.5,
  /** Minimum speed multiplier even at max weight */
  MIN_WEIGHT_FACTOR: 0.1,
  /** Maximum useful legs before diminishing returns are severe */
  LEG_DIMINISHING_RETURNS_THRESHOLD: 4,
  /** Each leg beyond the threshold contributes this fraction of normal */
  LEG_DIMINISHING_FACTOR: 0.3,
  /** Short legs contribute this much speed */
  SHORT_LEG_SPEED: 0.8,
  /** Long legs contribute this much speed */
  LONG_LEG_SPEED: 1.2,
  /** Baseline: 2 average legs = normalized leg factor of 1.0 */
  BASELINE_LEG_DIVISOR: 2.0,
  /** Bonus damage multiplier per speed^2 (quadratic scaling rewards fast builds heavily) */
  SPEED_DAMAGE_BONUS_FACTOR: 0.9,
} as const;

export const COMBAT = {
  /** Multiplier for energy deficit self-damage per tick */
  ENERGY_DEFICIT_DAMAGE_RATE: 0.5,
  /** Fraction of damage that propagates through a joint to parent */
  JOINT_DAMAGE_PROPAGATION: 0.15,
  /** Contact damage range (how close creatures must be for spikes to hit) */
  CONTACT_RANGE: 3.5,
  /** Minimum range for any melee attack */
  MIN_ATTACK_RANGE: 1.5,
  /** Armor damage reduction is multiplicative: incoming * (1 - armorReduction) */
  ARMOR_REDUCTION_PER_POINT: 0.05,
  /** Maximum armor damage reduction (cap) */
  MAX_ARMOR_REDUCTION: 0.50,
  /** Shell provides flat damage reduction from above */
  SHELL_FLAT_REDUCTION: 2,
  /** Speed-based evasion: probability to dodge = speed^2 * this factor (capped at MAX_EVASION) */
  EVASION_PER_SPEED_SQ: 0.60,
  /** Maximum evasion chance (hard cap) */
  MAX_EVASION: 0.45,
  /** Hit weight for passive armor (shell) — higher = more likely to absorb hits */
  HIT_WEIGHT_PASSIVE_ARMOR: 3.0,
  /** Hit weight for active armor (plates) */
  HIT_WEIGHT_ARMOR: 2.5,
  /** Hit weight for core body part — lower = better protected */
  HIT_WEIGHT_CORE: 0.5,
  /** Hit weight for all other parts (legs, weapons, sensors) */
  HIT_WEIGHT_DEFAULT: 1.0,
} as const;

export const AI_BEHAVIOR = {
  /** Health fraction threshold for flee behavior */
  FLEE_HEALTH_THRESHOLD: 0.5,
  /** Wander distance per tick */
  WANDER_DISTANCE: 0.8,
  /** How close a creature tries to get to its target */
  APPROACH_DISTANCE: 1.0,
  /** Flee speed multiplier (adrenaline) */
  FLEE_SPEED_MULTIPLIER: 1.1,
  /** Probability of wandering toward center vs random direction */
  WANDER_CENTER_BIAS: 0.6,
  /** Speed threshold for kiting behavior (creatures above this speed will kite) */
  KITE_SPEED_THRESHOLD: 0.8,
  /** Fraction of ticks a kiter engages vs retreats (engage 70%, retreat 30%) */
  KITE_ENGAGE_RATIO: 0.7,
  /** Range at which multiple nearby enemies trigger flee-to-isolate behavior for kiters */
  KITE_DANGER_RANGE: 6.0,
  /** How many enemies within KITE_DANGER_RANGE triggers flee behavior */
  KITE_MAX_SAFE_ENEMIES: 1,
  /** Minimum sensor count for "smart targeting" (target weakest instead of nearest) */
  SMART_TARGETING_SENSOR_THRESHOLD: 2,
} as const;

export const DURABILITY = {
  BODY_SMALL: 30,
  BODY_LARGE: 40,
  LEG_SHORT: 8,
  LEG_LONG: 8,
  ARMOR_PLATE: 30,
  CLAW_SMALL: 8,
  CLAW_LARGE: 12,
  SPIKE: 5,
  SENSOR_EYE: 4,
  SENSOR_ANTENNA: 4,
  SHELL_DORSAL: 35,
} as const;

export const WEAPON_STATS = {
  CLAW_SMALL_DAMAGE: 5,
  CLAW_SMALL_REACH: 2.5,
  CLAW_LARGE_DAMAGE: 7,
  CLAW_LARGE_REACH: 2.5,
  SPIKE_CONTACT_DAMAGE: 3,
} as const;

export const SENSOR_STATS = {
  EYE_RANGE: 25,
  EYE_ARC_DEGREES: 120,
  ANTENNA_RANGE: 10,
  ANTENNA_ARC_DEGREES: 360,
} as const;

// ── Brain architecture ────────────────────────────────────────────

export const BRAIN = {
  INPUT_SIZE: 24,
  HIDDEN_1: 16,
  HIDDEN_2: 8,
  OUTPUT_SIZE: 4,
  TOPOLOGY: [24, 16, 8, 4] as readonly number[],
  /** Total parameter count: (24*16+16) + (16*8+8) + (8*4+4) = 572 */
  TOTAL_WEIGHTS: 572,
  /** Maximum visible enemies encoded in brain input */
  MAX_VISIBLE_ENEMIES: 3,
  /** Features per visible enemy: [relative_angle, distance, approx_size, is_approaching] */
  FEATURES_PER_ENEMY: 4,
} as const;

// ── Drive system ──────────────────────────────────────────────────

export const DRIVES = {
  /** Aggression resting point (slightly combative by default) */
  AGGRESSION_BASELINE: 0.5,
  FEAR_BASELINE: 0.0,
  PAIN_BASELINE: 0.0,
  EXPLORATION_BASELINE: 0.0,
  /** Per-tick decay rate toward baseline (fraction of distance) */
  DECAY_RATE: 0.05,
  /** Pain increase per unit of damage taken */
  PAIN_SPIKE_PER_DAMAGE: 0.1,
  /** Fear increase per part lost */
  FEAR_SPIKE_PER_PART_LOST: 0.3,
  /** Fear increase per unit of damage taken */
  FEAR_SPIKE_PER_DAMAGE: 0.02,
  /** Aggression increase per unit of damage dealt */
  AGGRESSION_SPIKE_PER_DAMAGE: 0.05,
  /** Exploration increase per tick with no visible enemies */
  EXPLORATION_INCREASE_RATE: 0.02,
  /** Stance threshold: brain output below this = defensive (won't initiate attacks) */
  DEFENSIVE_STANCE_THRESHOLD: -0.3,
} as const;

// ── Evolution harness ─────────────────────────────────────────────

export const EVOLUTION = {
  DEFAULT_POPULATION_SIZE: 32,
  DEFAULT_GENERATIONS: 100,
  DEFAULT_MATCHES_PER_EVAL: 10,
  /** Fraction of population that survives selection */
  ELITE_FRACTION: 0.25,
  /** Standard deviation of gaussian mutation noise */
  MUTATION_RATE: 0.1,
  /** Probability of mutating each individual weight */
  MUTATION_PROB: 0.1,
  /** Probability of crossover between two parents */
  CROSSOVER_RATE: 0.7,
  /** Fraction of each generation that's fresh random brains (anti-stagnation) */
  RANDOM_INJECTION_FRACTION: 0.1,
  /** Diversity score below which we consider brains converged */
  CONVERGENCE_THRESHOLD: 0.05,
  /** Consecutive generations below convergence threshold before declaring failure */
  CONVERGENCE_PATIENCE: 10,
} as const;

export const TOURNAMENT = {
  DEFAULT_MATCHES_PER_COMBO: 100,
  /** Win rate above which an archetype is considered dominant */
  DOMINANT_WIN_RATE: 0.60,
  /** Win rate below which an archetype is not viable (in a 4-FFA, perfect balance = 25% each) */
  VIABLE_WIN_RATE: 0.22,
} as const;
