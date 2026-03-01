// ── Part System Types ──────────────────────────────────────────────

export type PartId =
  | 'body_small'
  | 'body_large'
  | 'leg_short'
  | 'leg_long'
  | 'armor_plate'
  | 'claw_small'
  | 'claw_large'
  | 'spike'
  | 'sensor_eye'
  | 'sensor_antenna'
  | 'shell_dorsal';

export type PartRole = 'core' | 'locomotion' | 'weapon' | 'armor' | 'sensor' | 'passive_armor';

export type PortType = 'body' | 'limb' | 'sensor' | 'armor' | 'dorsal';

export interface PartDefinition {
  id: PartId;
  name: string;
  ports: number;
  weight: number;
  energyPerTick: number;
  role: PartRole;
  durability: number;
  armorValue: number;
  /** Which port types on the parent this part can attach to */
  attachesTo: PortType[];
  /** What port types this part exposes for children */
  providesPortTypes: PortType[];

  // Combat stats (only relevant for weapons/sensors)
  damage?: number;
  reach?: number;
  sensorRange?: number;
  sensorArc?: number; // degrees
  speedContribution?: number; // for legs
  stabilityContribution?: number; // for legs
  contactDamage?: number; // for spikes
}

// ── Brain Types ──────────────────────────────────────────────────

export interface DriveState {
  /** Increases when dealing damage, decays toward 0.5 */
  aggression: number;
  /** Increases when taking damage or losing parts, decays toward 0.0 */
  fear: number;
  /** Spikes on damage received, fast decay toward 0.0 */
  pain: number;
  /** Increases when no enemies visible, decays toward 0.0 */
  exploration: number;
}

export interface BrainLayer {
  /** Flattened weight matrix: inSize x outSize, row-major */
  weights: number[];
  /** Bias vector: outSize */
  biases: number[];
  outSize: number;
}

export interface BrainSpec {
  /** Layer sizes including input and output, e.g. [24, 16, 8, 4] */
  topology: readonly number[];
  /** All weights and biases flattened in layer order */
  weights: number[];
  activation: 'tanh';
}

export interface BrainOutput {
  /** Movement direction in radians (-PI to PI) */
  movementAngle: number;
  /** Fraction of max speed to use (0 to 1) */
  movementSpeed: number;
  /** Index into visible enemies to target (-1 = no target) */
  targetIndex: number;
  /** Aggression stance: negative = defensive/evasive, positive = aggressive (-1 to 1) */
  stance: number;
}

// ── Creature Blueprint (what a player submits) ────────────────────

export interface PartInstance {
  partId: PartId;
  /** Unique instance id within the creature */
  instanceId: string;
  children: PartInstance[];
}

export interface CreatureBlueprint {
  name: string;
  body: PartInstance;
  /** Optional neural net brain. If absent, uses hardcoded AI. */
  brain?: BrainSpec;
}

// ── Runtime State (during a match) ────────────────────────────────

export interface RuntimePart {
  instanceId: string;
  partId: PartId;
  definition: PartDefinition;
  currentDurability: number;
  accumulatedDamage: number;
  attached: boolean;
  children: RuntimePart[];
  parent: RuntimePart | null;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface CreatureState {
  id: string;
  name: string;
  blueprint: CreatureBlueprint;
  rootPart: RuntimePart;
  position: Vec2;
  facing: number; // radians
  alive: boolean;
  deathCause: DeathCause | null;
  tickOfDeath: number | null;

  // Brain + drives (if brain-driven creature)
  brain: BrainLayer[] | null;
  drives: DriveState;

  // Derived stats (recalculated when parts detach)
  speed: number;
  totalWeight: number;
  totalEnergyDrain: number;
  sensorRanges: SensorInfo[];
  weapons: WeaponInfo[];
  contactDamage: number;
  totalArmor: number;

  // Match stats
  damageDealt: number;
  damageTaken: number;
  partsLost: number;
  partsDestroyed: number; // on enemies

  // Per-tick deltas for drive updates (reset each tick)
  tickDamageDealt: number;
  tickDamageTaken: number;
  tickPartsLost: number;
  /** Whether this creature had visible enemies last tick */
  hadVisibleEnemies: boolean;
  /** Brain stance output from current tick's movement phase, used by attack phase.
   *  Negative = defensive, positive = aggressive. 0 when no brain. */
  brainStance: number;
}

export interface SensorInfo {
  instanceId: string;
  range: number;
  arc: number; // radians
}

export interface WeaponInfo {
  instanceId: string;
  damage: number;
  reach: number;
}

export type DeathCause = 'core_destroyed' | 'no_locomotion' | 'energy_depleted';

// ── Sensory Events ────────────────────────────────────────────────

export interface SensoryEvent {
  tick: number;
  creatureId: string;
  type: 'enemy_spotted' | 'contact_hit' | 'part_lost' | 'enemy_killed' | 'part_destroyed_on_enemy';
  data: Record<string, unknown>;
}

// ── Match Types ───────────────────────────────────────────────────

export interface MatchConfig {
  seed: number;
  maxTicks: number;
  creatures: CreatureBlueprint[];
}

export interface PlacementResult {
  creatureId: string;
  creatureName: string;
  placement: number;
  damageDealt: number;
  damageTaken: number;
  partsLost: number;
  partsDestroyed: number;
  ticksSurvived: number;
  deathCause: DeathCause | 'survived' | null;
}

export interface MatchResult {
  seed: number;
  tickCount: number;
  placements: PlacementResult[];
}
