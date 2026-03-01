import type { PartDefinition, PartId } from './types.js';
import { DURABILITY, WEAPON_STATS, SENSOR_STATS, SPEED } from './constants.js';

// ── Port layout geometry constants ─────────────────────────────

/** body_small: ellipsoid radius ~0.85 */
const BS_RAD = 0.85;
const BS_RAD_Y = 0.8;

/** body_large: ellipsoid radius ~1.2 */
const BL_RAD = 1.2;
const BL_RAD_Y = 0.9;

/** Leg provides 1 limb port at its tip */
const LEG_SHORT_TIP_Y = -0.7;
const LEG_LONG_TIP_Y = -1.1;

const CATALOG_ENTRIES: PartDefinition[] = [
  {
    id: 'body_small',
    name: 'Body (small)',
    ports: 4,
    weight: 3,
    energyPerTick: 1,
    role: 'core',
    durability: DURABILITY.BODY_SMALL,
    armorValue: 0,
    attachesTo: [],
    providesPortTypes: ['limb', 'limb', 'sensor', 'armor'],
    portLayout: [
      { type: 'limb',   position: [-BS_RAD, 0, 0],       direction: 'left' },
      { type: 'limb',   position: [BS_RAD, 0, 0],        direction: 'right' },
      { type: 'sensor', position: [0, BS_RAD_Y, 0],      direction: 'top' },
      { type: 'armor',  position: [0, 0, BS_RAD],        direction: 'front' },
      { type: 'dorsal', position: [0, BS_RAD_Y * 0.9, -BS_RAD * 0.3], direction: 'back' },
    ],
  },
  {
    id: 'body_large',
    name: 'Body (large)',
    ports: 8,
    weight: 6,
    energyPerTick: 2,
    role: 'core',
    durability: DURABILITY.BODY_LARGE,
    armorValue: 0,
    attachesTo: [],
    providesPortTypes: ['limb', 'limb', 'limb', 'limb', 'sensor', 'sensor', 'armor', 'armor'],
    portLayout: [
      { type: 'limb',   position: [-BL_RAD, 0, BL_RAD * 0.5],   direction: 'left' },
      { type: 'limb',   position: [BL_RAD, 0, BL_RAD * 0.5],    direction: 'right' },
      { type: 'limb',   position: [-BL_RAD, 0, -BL_RAD * 0.5],  direction: 'left' },
      { type: 'limb',   position: [BL_RAD, 0, -BL_RAD * 0.5],   direction: 'right' },
      { type: 'sensor', position: [0, BL_RAD_Y, BL_RAD * 0.3],  direction: 'top' },
      { type: 'sensor', position: [0, BL_RAD_Y, -BL_RAD * 0.3], direction: 'top' },
      { type: 'armor',  position: [0, 0, BL_RAD],               direction: 'front' },
      { type: 'armor',  position: [0, 0, -BL_RAD],              direction: 'back' },
      { type: 'dorsal', position: [0, BL_RAD_Y * 0.9, 0],       direction: 'top' },
    ],
  },
  {
    id: 'leg_short',
    name: 'Leg (short)',
    ports: 1,
    weight: 1,
    energyPerTick: 1,
    role: 'locomotion',
    durability: DURABILITY.LEG_SHORT,
    armorValue: 0,
    attachesTo: ['limb'],
    providesPortTypes: ['limb'],
    portLayout: [
      { type: 'limb', position: [0, LEG_SHORT_TIP_Y, 0], direction: 'bottom' },
    ],
    speedContribution: SPEED.SHORT_LEG_SPEED,
    stabilityContribution: 1.0,
  },
  {
    id: 'leg_long',
    name: 'Leg (long)',
    ports: 1,
    weight: 2,
    energyPerTick: 2,
    role: 'locomotion',
    durability: DURABILITY.LEG_LONG,
    armorValue: 0,
    attachesTo: ['limb'],
    providesPortTypes: ['limb'],
    portLayout: [
      { type: 'limb', position: [0, LEG_LONG_TIP_Y, 0], direction: 'bottom' },
    ],
    speedContribution: SPEED.LONG_LEG_SPEED,
    stabilityContribution: 0.5,
  },
  {
    id: 'armor_plate',
    name: 'Armor plate',
    ports: 1,
    weight: 4,
    energyPerTick: 0,
    role: 'armor',
    durability: DURABILITY.ARMOR_PLATE,
    armorValue: 5,
    attachesTo: ['armor', 'limb'],
    providesPortTypes: [],
    portLayout: [],
  },
  {
    id: 'claw_small',
    name: 'Claw (small)',
    ports: 1,
    weight: 1,
    energyPerTick: 1,
    role: 'weapon',
    durability: DURABILITY.CLAW_SMALL,
    armorValue: 0,
    attachesTo: ['limb'],
    providesPortTypes: [],
    portLayout: [],
    damage: WEAPON_STATS.CLAW_SMALL_DAMAGE,
    reach: WEAPON_STATS.CLAW_SMALL_REACH,
  },
  {
    id: 'claw_large',
    name: 'Claw (large)',
    ports: 1,
    weight: 3,
    energyPerTick: 3,
    role: 'weapon',
    durability: DURABILITY.CLAW_LARGE,
    armorValue: 0,
    attachesTo: ['limb'],
    providesPortTypes: [],
    portLayout: [],
    damage: WEAPON_STATS.CLAW_LARGE_DAMAGE,
    reach: WEAPON_STATS.CLAW_LARGE_REACH,
  },
  {
    id: 'spike',
    name: 'Spike',
    ports: 1,
    weight: 1,
    energyPerTick: 0,
    role: 'weapon',
    durability: DURABILITY.SPIKE,
    armorValue: 0,
    attachesTo: ['limb', 'armor'],
    providesPortTypes: [],
    portLayout: [],
    contactDamage: WEAPON_STATS.SPIKE_CONTACT_DAMAGE,
  },
  {
    id: 'sensor_eye',
    name: 'Sensor (eye)',
    ports: 1,
    weight: 0.5,
    energyPerTick: 1,
    role: 'sensor',
    durability: DURABILITY.SENSOR_EYE,
    armorValue: 0,
    attachesTo: ['sensor', 'limb'],
    providesPortTypes: [],
    portLayout: [],
    sensorRange: SENSOR_STATS.EYE_RANGE,
    sensorArc: SENSOR_STATS.EYE_ARC_DEGREES,
  },
  {
    id: 'sensor_antenna',
    name: 'Sensor (antenna)',
    ports: 1,
    weight: 0.5,
    energyPerTick: 1,
    role: 'sensor',
    durability: DURABILITY.SENSOR_ANTENNA,
    armorValue: 0,
    attachesTo: ['sensor', 'limb'],
    providesPortTypes: [],
    portLayout: [],
    sensorRange: SENSOR_STATS.ANTENNA_RANGE,
    sensorArc: SENSOR_STATS.ANTENNA_ARC_DEGREES,
  },
  {
    id: 'shell_dorsal',
    name: 'Shell (dorsal)',
    ports: 0,
    weight: 5,
    energyPerTick: 0,
    role: 'passive_armor',
    durability: DURABILITY.SHELL_DORSAL,
    armorValue: 8,
    attachesTo: ['dorsal'],
    providesPortTypes: [],
    portLayout: [],
  },
];

/** Part definitions indexed by PartId for O(1) lookup */
export const PART_CATALOG: ReadonlyMap<PartId, PartDefinition> = new Map(
  CATALOG_ENTRIES.map((p) => [p.id, p])
);

export function getPartDef(id: PartId): PartDefinition {
  const def = PART_CATALOG.get(id);
  if (!def) throw new Error(`Unknown part ID: ${id}`);
  return def;
}

/** All part definitions as array for iteration */
export function getAllParts(): PartDefinition[] {
  return CATALOG_ENTRIES;
}
