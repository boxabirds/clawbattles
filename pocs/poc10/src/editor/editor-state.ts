import type { CreatureBlueprint, PartInstance, PartId, PartDefinition, PortSlot } from '../simulation/types.js';
import { MIRROR_DIRECTION } from '../simulation/types.js';
import { getPartDef } from '../simulation/catalog.js';
import { BUDGET } from '../simulation/constants.js';

// ── Stats computation constants ──────────────────────────────────

const BASE_SPEED = 1.0;
const SPEED_PER_LEG = 1.0;
const SPEED_DIMINISHING_THRESHOLD = 6;
const SPEED_DIMINISHING_VALUE = 0.3;
const BASE_HP = 25;
const HP_PER_SEGMENT = 10; // body parts beyond core
const HP_PER_SHELL = 20;
const DPS_PER_CLAW_SMALL = 5;
const DPS_PER_CLAW_LARGE = 7;
const DPS_PER_SPIKE = 3;
const VISION_PER_EYE = 5;
const VISION_PER_ANTENNA = 8;

export interface CreatureStats {
  speed: number;
  hp: number;
  dps: number;
  vision: number;
  weight: number;
  energy: number;
  partCount: number;
  legCount: number;
}

let nextInstanceId = 0;

function generateInstanceId(partId: PartId): string {
  return `${partId}_${nextInstanceId++}`;
}

/** Flatten a part tree into an array */
export function collectParts(root: PartInstance): PartInstance[] {
  const parts: PartInstance[] = [root];
  for (const child of root.children) {
    parts.push(...collectParts(child));
  }
  return parts;
}

/** Find a part by instanceId in the tree */
export function findPart(root: PartInstance, instanceId: string): PartInstance | null {
  if (root.instanceId === instanceId) return root;
  for (const child of root.children) {
    const found = findPart(child, instanceId);
    if (found) return found;
  }
  return null;
}

/** Find parent of a part */
export function findParent(root: PartInstance, instanceId: string): PartInstance | null {
  for (const child of root.children) {
    if (child.instanceId === instanceId) return root;
    const found = findParent(child, instanceId);
    if (found) return found;
  }
  return null;
}

/** Get open (unoccupied) port slots on a part */
export function getOpenPorts(part: PartInstance): Array<{ portIndex: number; slot: PortSlot }> {
  const def = getPartDef(part.partId);
  const occupiedIndices = new Set(part.children.map((c) => c.portIndex));

  return def.portLayout
    .map((slot, index) => ({ portIndex: index, slot }))
    .filter(({ portIndex }) => !occupiedIndices.has(portIndex));
}

/** Check if a part type can attach to a specific port slot */
export function canAttach(childPartId: PartId, portSlot: PortSlot): boolean {
  const childDef = getPartDef(childPartId);
  return childDef.attachesTo.includes(portSlot.type);
}

/** Get valid open ports on a part for a specific child type */
export function getValidPorts(
  parent: PartInstance,
  childPartId: PartId
): Array<{ portIndex: number; slot: PortSlot }> {
  return getOpenPorts(parent).filter(({ slot }) => canAttach(childPartId, slot));
}

/** Compute creature stats from blueprint */
export function computeStats(blueprint: CreatureBlueprint): CreatureStats {
  const parts = collectParts(blueprint.body);
  let weight = 0;
  let energy = 0;
  let hp = BASE_HP;
  let dps = 0;
  let vision = 0;
  let legCount = 0;

  for (const p of parts) {
    const def = getPartDef(p.partId);
    weight += def.weight;
    energy += def.energyPerTick;

    switch (p.partId) {
      case 'body_large':
        hp += HP_PER_SEGMENT;
        break;
      case 'shell_dorsal':
        hp += HP_PER_SHELL;
        break;
      case 'armor_plate':
        hp += def.durability;
        break;
      case 'leg_short':
      case 'leg_long':
        legCount++;
        break;
      case 'claw_small':
        dps += DPS_PER_CLAW_SMALL;
        break;
      case 'claw_large':
        dps += DPS_PER_CLAW_LARGE;
        break;
      case 'spike':
        dps += DPS_PER_SPIKE;
        break;
      case 'sensor_eye':
        vision += VISION_PER_EYE;
        break;
      case 'sensor_antenna':
        vision += VISION_PER_ANTENNA;
        break;
    }
  }

  let speed = BASE_SPEED;
  for (let i = 0; i < legCount; i++) {
    speed += i < SPEED_DIMINISHING_THRESHOLD ? SPEED_PER_LEG : SPEED_DIMINISHING_VALUE;
  }

  return { speed, hp, dps, vision, weight, energy, partCount: parts.length, legCount };
}

// ── Editor State ──────────────────────────────────────────────────

export class EditorState {
  blueprint: CreatureBlueprint;
  selectedPartType: PartId | null = null;
  symmetryOn = false;
  private history: string[] = []; // instanceIds in placement order

  constructor(blueprint: CreatureBlueprint) {
    this.blueprint = blueprint;
    // Re-index instance counter from existing blueprint
    const parts = collectParts(blueprint.body);
    nextInstanceId = parts.length + 100;
  }

  /** Add a part to a parent at a specific port index. Returns the new instanceId or null. */
  addPart(partId: PartId, parentInstanceId: string, portIndex: number): string | null {
    const parent = findPart(this.blueprint.body, parentInstanceId);
    if (!parent) return null;

    const parentDef = getPartDef(parent.partId);
    if (portIndex < 0 || portIndex >= parentDef.portLayout.length) return null;

    // Check port not occupied
    if (parent.children.some((c) => c.portIndex === portIndex)) return null;

    // Check type compatibility
    const slot = parentDef.portLayout[portIndex];
    if (!canAttach(partId, slot)) return null;

    // Check budget
    const allParts = collectParts(this.blueprint.body);
    if (allParts.length >= BUDGET.MAX_PARTS) return null;

    const instanceId = generateInstanceId(partId);
    const newPart: PartInstance = {
      partId,
      instanceId,
      portIndex,
      children: [],
    };

    parent.children.push(newPart);
    this.history.push(instanceId);

    // Bilateral symmetry: try to place mirror
    if (this.symmetryOn) {
      const mirrorDir = MIRROR_DIRECTION[slot.direction];
      if (mirrorDir !== slot.direction) {
        // Find the mirror port on same parent
        const mirrorPortIdx = parentDef.portLayout.findIndex(
          (p, i) => p.direction === mirrorDir && p.type === slot.type && !parent.children.some((c) => c.portIndex === i)
        );
        if (mirrorPortIdx >= 0) {
          const mirrorId = generateInstanceId(partId);
          parent.children.push({
            partId,
            instanceId: mirrorId,
            portIndex: mirrorPortIdx,
            children: [],
          });
          this.history.push(mirrorId);
        }
      }
    }

    return instanceId;
  }

  /** Remove a part and all its descendants. Returns true if removed. */
  removePart(instanceId: string): boolean {
    // Can't remove root body
    if (instanceId === this.blueprint.body.instanceId) return false;

    const parent = findParent(this.blueprint.body, instanceId);
    if (!parent) return false;

    const idx = parent.children.findIndex((c) => c.instanceId === instanceId);
    if (idx === -1) return false;

    // Collect all descendant IDs for history cleanup
    const removed = collectParts(parent.children[idx]);
    const removedIds = new Set(removed.map((p) => p.instanceId));

    parent.children.splice(idx, 1);
    this.history = this.history.filter((id) => !removedIds.has(id));

    return true;
  }

  /** Undo last placement */
  undo(): boolean {
    if (this.history.length === 0) return false;
    const lastId = this.history[this.history.length - 1];
    return this.removePart(lastId);
  }

  /** Reset to just the body */
  reset(): void {
    this.blueprint.body.children = [];
    this.history = [];
  }

  /** Get stats for current creature */
  getStats(): CreatureStats {
    return computeStats(this.blueprint);
  }
}
