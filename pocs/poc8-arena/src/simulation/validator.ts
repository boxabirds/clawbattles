import type { CreatureBlueprint, PartInstance, PartId } from './types.js';
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

/** Check that instance IDs are unique */
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

/** Check part count constraint */
function checkPartCount(parts: PartInstance[]): string[] {
  if (parts.length > BUDGET.MAX_PARTS) {
    return [`Part count ${parts.length} exceeds MAX_PARTS (${BUDGET.MAX_PARTS})`];
  }
  return [];
}

/** Check total weight constraint */
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

/** Check energy budget (whether ENERGY_PER_TICK can cover all parts) */
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
  // This is a warning, not a hard error — creatures CAN exceed energy budget
  // but they'll take self-damage. We return it as info but don't fail validation.
  return [];
}

/** Check that the root is a body part */
function checkRoot(root: PartInstance): string[] {
  const def = getPartDef(root.partId);
  if (def.role !== 'core') {
    return [`Root part must be a core (body) part, got "${def.name}" with role "${def.role}"`];
  }
  return [];
}

/** Check port compatibility: children must attach to valid port types */
function checkPortCompatibility(root: PartInstance): string[] {
  const errors: string[] = [];

  function checkNode(node: PartInstance): void {
    const parentDef = getPartDef(node.partId);
    const availablePorts = [...parentDef.providesPortTypes];

    // Shell (dorsal) sits on top of body, doesn't consume a port
    // Handle it separately: bodies always have a dorsal slot
    const dorsalChildren = node.children.filter((c) => {
      const childDef = getPartDef(c.partId);
      return childDef.attachesTo.includes('dorsal');
    });
    const nonDorsalChildren = node.children.filter((c) => {
      const childDef = getPartDef(c.partId);
      return !childDef.attachesTo.includes('dorsal');
    });

    // Dorsal parts: only bodies can have them, max 1
    if (dorsalChildren.length > 0 && parentDef.role !== 'core') {
      errors.push(`Only body parts can have dorsal attachments, but "${parentDef.name}" has one`);
    }
    if (dorsalChildren.length > 1) {
      errors.push(`Only one dorsal attachment allowed, found ${dorsalChildren.length}`);
    }

    // Non-dorsal children must match available port types
    if (nonDorsalChildren.length > availablePorts.length) {
      errors.push(
        `"${parentDef.name}" (${node.instanceId}) has ${nonDorsalChildren.length} children ` +
          `but only ${availablePorts.length} ports`
      );
    }

    for (const child of nonDorsalChildren) {
      const childDef = getPartDef(child.partId);
      // Find a compatible port
      const portIdx = availablePorts.findIndex((pt) => childDef.attachesTo.includes(pt));
      if (portIdx === -1) {
        errors.push(
          `"${childDef.name}" (${child.instanceId}) cannot attach to "${parentDef.name}" (${node.instanceId}). ` +
            `Needs port types [${childDef.attachesTo.join(', ')}], ` +
            `available: [${availablePorts.join(', ')}]`
        );
      } else {
        // Consume the port
        availablePorts.splice(portIdx, 1);
      }
    }

    // Recurse into children
    for (const child of node.children) {
      checkNode(child);
    }
  }

  checkNode(root);
  return errors;
}

/** Check creature has at least one locomotion part */
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

/**
 * Validate a creature blueprint against all constraints.
 * Returns validation result with detailed errors.
 */
export function validateCreature(blueprint: CreatureBlueprint): ValidationResult {
  const allParts = collectParts(blueprint.body);
  const errors: string[] = [];

  errors.push(...checkRoot(blueprint.body));
  errors.push(...checkUniqueIds(allParts));
  errors.push(...checkPartCount(allParts));
  errors.push(...checkWeight(allParts));
  errors.push(...checkPortCompatibility(blueprint.body));
  errors.push(...checkLocomotion(allParts));

  // Energy is a warning, not a hard fail — but we'll note it
  const energyWarnings = checkEnergy(allParts);

  return {
    valid: errors.length === 0,
    errors: [...errors, ...energyWarnings],
  };
}
