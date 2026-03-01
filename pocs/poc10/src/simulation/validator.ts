import type { CreatureBlueprint, PartInstance } from './types.js';
import { getPartDef } from './catalog.js';
import { BUDGET } from './constants.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Flatten the part tree into an array of all part instances */
function collectParts(root: PartInstance): PartInstance[] {
  const parts: PartInstance[] = [root];
  for (const child of root.children) {
    parts.push(...collectParts(child));
  }
  return parts;
}

function checkUniqueIds(parts: PartInstance[]): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const p of parts) {
    if (seen.has(p.instanceId)) {
      errors.push(`Duplicate instance ID: "${p.instanceId}"`);
    }
    seen.add(p.instanceId);
  }
  return errors;
}

function checkPartCount(parts: PartInstance[]): string[] {
  if (parts.length > BUDGET.MAX_PARTS) {
    return [`Part count ${parts.length} exceeds MAX_PARTS (${BUDGET.MAX_PARTS})`];
  }
  return [];
}

function checkWeight(parts: PartInstance[]): string[] {
  let totalWeight = 0;
  for (const p of parts) {
    totalWeight += getPartDef(p.partId).weight;
  }
  if (totalWeight > BUDGET.MAX_WEIGHT) {
    return [`Total weight ${totalWeight} exceeds MAX_WEIGHT (${BUDGET.MAX_WEIGHT})`];
  }
  return [];
}

function checkEnergy(parts: PartInstance[]): string[] {
  let totalEnergy = 0;
  for (const p of parts) {
    totalEnergy += getPartDef(p.partId).energyPerTick;
  }
  if (totalEnergy > BUDGET.ENERGY_PER_TICK) {
    return [
      `Total energy drain ${totalEnergy}/tick exceeds ENERGY_PER_TICK budget (${BUDGET.ENERGY_PER_TICK}). ` +
        `Creature will take self-damage every tick.`,
    ];
  }
  return [];
}

function checkRoot(root: PartInstance): string[] {
  const def = getPartDef(root.partId);
  if (def.role !== 'core') {
    return [`Root part must be a core (body) part, got "${def.name}" with role "${def.role}"`];
  }
  return [];
}

function checkPortCompatibility(root: PartInstance): string[] {
  const errors: string[] = [];

  function checkNode(node: PartInstance): void {
    const parentDef = getPartDef(node.partId);
    const availablePorts = [...parentDef.providesPortTypes];

    const dorsalChildren = node.children.filter((c) => {
      const childDef = getPartDef(c.partId);
      return childDef.attachesTo.includes('dorsal');
    });
    const nonDorsalChildren = node.children.filter((c) => {
      const childDef = getPartDef(c.partId);
      return !childDef.attachesTo.includes('dorsal');
    });

    if (dorsalChildren.length > 0 && parentDef.role !== 'core') {
      errors.push(`Only body parts can have dorsal attachments, but "${parentDef.name}" has one`);
    }
    if (dorsalChildren.length > 1) {
      errors.push(`Only one dorsal attachment allowed, found ${dorsalChildren.length}`);
    }

    if (nonDorsalChildren.length > availablePorts.length) {
      errors.push(
        `"${parentDef.name}" (${node.instanceId}) has ${nonDorsalChildren.length} children ` +
          `but only ${availablePorts.length} ports`
      );
    }

    for (const child of nonDorsalChildren) {
      const childDef = getPartDef(child.partId);
      const portIdx = availablePorts.findIndex((pt) => childDef.attachesTo.includes(pt));
      if (portIdx === -1) {
        errors.push(
          `"${childDef.name}" (${child.instanceId}) cannot attach to "${parentDef.name}" (${node.instanceId}). ` +
            `Needs port types [${childDef.attachesTo.join(', ')}], ` +
            `available: [${availablePorts.join(', ')}]`
        );
      } else {
        availablePorts.splice(portIdx, 1);
      }
    }

    for (const child of node.children) {
      checkNode(child);
    }
  }

  checkNode(root);
  return errors;
}

function checkLocomotion(parts: PartInstance[]): string[] {
  const hasLegs = parts.some((p) => {
    const def = getPartDef(p.partId);
    return def.role === 'locomotion';
  });
  if (!hasLegs) {
    return ['Creature has no locomotion parts (legs). It cannot move.'];
  }
  return [];
}

export function validateCreature(blueprint: CreatureBlueprint): ValidationResult {
  const allParts = collectParts(blueprint.body);
  const errors: string[] = [];

  errors.push(...checkRoot(blueprint.body));
  errors.push(...checkUniqueIds(allParts));
  errors.push(...checkPartCount(allParts));
  errors.push(...checkWeight(allParts));
  errors.push(...checkPortCompatibility(blueprint.body));
  errors.push(...checkLocomotion(allParts));

  const energyWarnings = checkEnergy(allParts);

  return {
    valid: errors.length === 0,
    errors: [...errors, ...energyWarnings],
  };
}
