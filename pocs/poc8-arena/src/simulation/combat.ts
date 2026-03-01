import type {
  CreatureState,
  RuntimePart,
  SensoryEvent,
  Vec2,
} from './types.js';
import { BUDGET, SPEED, COMBAT, AI_BEHAVIOR, ARENA, DRIVES } from './constants.js';
import { getVisibleEnemies, estimateThreat, distance, angleTo, type VisibleEnemy } from './sensory.js';
import { SeededRNG } from './prng.js';
import { forward, composeBrainInput, decodeBrainOutput } from './brain.js';

// ── Part tree helpers ─────────────────────────────────────────────

/** Collect all attached parts from a runtime part tree */
function collectAttachedParts(root: RuntimePart): RuntimePart[] {
  const parts: RuntimePart[] = [];
  if (!root.attached) return parts;
  parts.push(root);
  for (const child of root.children) {
    parts.push(...collectAttachedParts(child));
  }
  return parts;
}

/** Recalculate all derived stats from the current part tree */
export function recalculateStats(creature: CreatureState): void {
  const parts = collectAttachedParts(creature.rootPart);

  // Weight
  creature.totalWeight = 0;
  for (const p of parts) {
    creature.totalWeight += p.definition.weight;
  }

  // Energy drain
  creature.totalEnergyDrain = 0;
  for (const p of parts) {
    creature.totalEnergyDrain += p.definition.energyPerTick;
  }

  // Sensors
  creature.sensorRanges = [];
  for (const p of parts) {
    if (p.definition.role === 'sensor' && p.definition.sensorRange != null && p.definition.sensorArc != null) {
      creature.sensorRanges.push({
        instanceId: p.instanceId,
        range: p.definition.sensorRange,
        arc: (p.definition.sensorArc * Math.PI) / 180, // convert degrees to radians
      });
    }
  }

  // Weapons (active, not spikes)
  creature.weapons = [];
  for (const p of parts) {
    if (p.definition.damage != null && p.definition.reach != null) {
      creature.weapons.push({
        instanceId: p.instanceId,
        damage: p.definition.damage,
        reach: p.definition.reach,
      });
    }
  }

  // Contact damage (spikes)
  creature.contactDamage = 0;
  for (const p of parts) {
    if (p.definition.contactDamage != null) {
      creature.contactDamage += p.definition.contactDamage;
    }
  }

  // Armor
  creature.totalArmor = 0;
  for (const p of parts) {
    creature.totalArmor += p.definition.armorValue;
  }

  // Speed
  let legFactor = 0;
  let legCount = 0;
  for (const p of parts) {
    if (p.definition.role === 'locomotion' && p.definition.speedContribution != null) {
      legCount++;
      if (legCount <= SPEED.LEG_DIMINISHING_RETURNS_THRESHOLD) {
        legFactor += p.definition.speedContribution;
      } else {
        legFactor += p.definition.speedContribution * SPEED.LEG_DIMINISHING_FACTOR;
      }
    }
  }
  const normalizedLegFactor = legCount > 0 ? legFactor / SPEED.BASELINE_LEG_DIVISOR : 0;

  const weightFraction = creature.totalWeight / BUDGET.MAX_WEIGHT;
  const weightFactor = Math.max(SPEED.MIN_WEIGHT_FACTOR, 1 - weightFraction);

  creature.speed = SPEED.BASE * weightFactor * normalizedLegFactor;
}

// ── Health calculation ────────────────────────────────────────────

/** Calculate creature's current health as a fraction of max durability */
function getHealthFraction(creature: CreatureState): number {
  const parts = collectAttachedParts(creature.rootPart);
  let currentDurability = 0;
  let maxDurability = 0;
  for (const p of parts) {
    currentDurability += p.currentDurability;
    maxDurability += p.definition.durability;
  }
  if (maxDurability === 0) return 0;
  return currentDurability / maxDurability;
}

// ── Tick Phases ───────────────────────────────────────────────────

/** Phase 1: Energy — deduct energy costs, apply self-damage on deficit */
export function energyPhase(creatures: CreatureState[]): void {
  for (const c of creatures) {
    if (!c.alive) continue;
    const deficit = c.totalEnergyDrain - BUDGET.ENERGY_PER_TICK;
    if (deficit > 0) {
      // Self-damage to core proportional to deficit
      const selfDamage = deficit * COMBAT.ENERGY_DEFICIT_DAMAGE_RATE;
      c.rootPart.currentDurability -= selfDamage;
      c.rootPart.accumulatedDamage += selfDamage;
      c.damageTaken += selfDamage;
      c.tickDamageTaken += selfDamage;
    }
  }
}

/** Phase 2: Drive update — shift drives based on previous tick's combat events */
export function driveUpdatePhase(creatures: CreatureState[]): void {
  for (const c of creatures) {
    if (!c.alive) continue;

    const drives = c.drives;

    // Decay toward baselines
    drives.aggression += (DRIVES.AGGRESSION_BASELINE - drives.aggression) * DRIVES.DECAY_RATE;
    drives.fear += (DRIVES.FEAR_BASELINE - drives.fear) * DRIVES.DECAY_RATE;
    drives.pain += (DRIVES.PAIN_BASELINE - drives.pain) * DRIVES.DECAY_RATE;
    drives.exploration += (DRIVES.EXPLORATION_BASELINE - drives.exploration) * DRIVES.DECAY_RATE;

    // Spike from previous tick's events
    drives.pain = Math.min(1, drives.pain + c.tickDamageTaken * DRIVES.PAIN_SPIKE_PER_DAMAGE);
    drives.fear = Math.min(1, drives.fear
      + c.tickDamageTaken * DRIVES.FEAR_SPIKE_PER_DAMAGE
      + c.tickPartsLost * DRIVES.FEAR_SPIKE_PER_PART_LOST);
    drives.aggression = Math.min(1, drives.aggression
      + c.tickDamageDealt * DRIVES.AGGRESSION_SPIKE_PER_DAMAGE);

    // Exploration increases when no enemies visible
    if (!c.hadVisibleEnemies) {
      drives.exploration = Math.min(1, drives.exploration + DRIVES.EXPLORATION_INCREASE_RATE);
    }

    // Clamp all drives to [0, 1]
    drives.aggression = Math.max(0, Math.min(1, drives.aggression));
    drives.fear = Math.max(0, Math.min(1, drives.fear));
    drives.pain = Math.max(0, Math.min(1, drives.pain));
    drives.exploration = Math.max(0, Math.min(1, drives.exploration));
  }
}

/** Phase 3: Sense — calculate visibility for each creature */
export function sensePhase(
  creatures: CreatureState[]
): Map<string, VisibleEnemy[]> {
  const visibility = new Map<string, VisibleEnemy[]>();
  for (const c of creatures) {
    if (!c.alive) continue;
    visibility.set(c.id, getVisibleEnemies(c, creatures));
  }
  return visibility;
}

/** Phase 4: Movement — creatures move based on brain output or hardcoded AI */
export function movementPhase(
  creatures: CreatureState[],
  visibility: Map<string, VisibleEnemy[]>,
  rng: SeededRNG
): void {
  for (const c of creatures) {
    if (!c.alive || c.speed <= 0) continue;

    const visible = visibility.get(c.id) ?? [];

    // ── Brain-driven movement ────────────────────────────────────
    if (c.brain) {
      const input = composeBrainInput(c, visible);
      const rawOutput = forward(input, c.brain);
      const output = decodeBrainOutput(rawOutput, visible.length);

      const moveSpeed = c.speed * output.movementSpeed;

      // Movement direction: brain output angle is relative to current facing
      const absoluteAngle = c.facing + output.movementAngle;
      let targetPos: Vec2 = {
        x: c.position.x + Math.cos(absoluteAngle) * moveSpeed,
        y: c.position.y + Math.sin(absoluteAngle) * moveSpeed,
      };

      // Update facing: face movement direction if moving, or face target enemy
      if (output.targetIndex >= 0 && output.targetIndex < visible.length) {
        c.facing = angleTo(c.position, visible[output.targetIndex].creature.position);
      } else if (moveSpeed > 0.01) {
        c.facing = absoluteAngle;
      }

      // Store stance for attack phase (used to modulate attack willingness)
      c.brainStance = output.stance;

      // Arena clamping
      const distFromCenter = Math.sqrt(targetPos.x * targetPos.x + targetPos.y * targetPos.y);
      if (distFromCenter > ARENA.RADIUS) {
        const scale = ARENA.RADIUS / distFromCenter;
        targetPos.x *= scale;
        targetPos.y *= scale;
      }

      c.position = targetPos;
      continue;
    }

    // ── Hardcoded AI fallback (no brain) ─────────────────────────
    const healthFrac = getHealthFraction(c);

    let targetPos: Vec2;
    let moveSpeed = c.speed;

    if (visible.length > 0 && healthFrac > AI_BEHAVIOR.FLEE_HEALTH_THRESHOLD) {
      // Target selection: creatures with multiple sensors target weakest enemy
      // (information advantage), others target nearest (simplest strategy)
      const hasSuperiorVision = c.sensorRanges.length >= AI_BEHAVIOR.SMART_TARGETING_SENSOR_THRESHOLD;

      let chosenTarget: VisibleEnemy;
      if (hasSuperiorVision && visible.length > 1) {
        chosenTarget = visible.reduce((a, b) =>
          getHealthFraction(a.creature) < getHealthFraction(b.creature) ? a : b
        );
      } else {
        chosenTarget = visible.reduce((a, b) => (a.distance < b.distance ? a : b));
      }

      const isKiter = c.speed >= AI_BEHAVIOR.KITE_SPEED_THRESHOLD;

      // Crowd avoidance: fast creatures flee when outnumbered at close range
      const nearbyEnemies = visible.filter((v) => v.distance < AI_BEHAVIOR.KITE_DANGER_RANGE);
      if (isKiter && nearbyEnemies.length > AI_BEHAVIOR.KITE_MAX_SAFE_ENEMIES) {
        // Too many enemies nearby — disengage to find isolated prey
        const avgEnemyX = nearbyEnemies.reduce((s, v) => s + v.creature.position.x, 0) / nearbyEnemies.length;
        const avgEnemyY = nearbyEnemies.reduce((s, v) => s + v.creature.position.y, 0) / nearbyEnemies.length;
        const fleeAngle = Math.atan2(c.position.y - avgEnemyY, c.position.x - avgEnemyX);
        targetPos = {
          x: c.position.x + Math.cos(fleeAngle) * moveSpeed,
          y: c.position.y + Math.sin(fleeAngle) * moveSpeed,
        };
        c.facing = fleeAngle + Math.PI; // face backward toward enemies
      } else if (isKiter && rng.next() > AI_BEHAVIOR.KITE_ENGAGE_RATIO &&
                 chosenTarget.distance < c.weapons.reduce((max, w) => Math.max(max, w.reach), 0)) {
        // Kiting: alternate between engaging and retreating
        const retreatAngle = angleTo(chosenTarget.creature.position, c.position);
        targetPos = {
          x: c.position.x + Math.cos(retreatAngle) * moveSpeed,
          y: c.position.y + Math.sin(retreatAngle) * moveSpeed,
        };
        c.facing = angleTo(c.position, chosenTarget.creature.position);
      } else {
        // Engage: approach target
        const approachDist = Math.max(0, chosenTarget.distance - AI_BEHAVIOR.APPROACH_DISTANCE);
        const angle = angleTo(c.position, chosenTarget.creature.position);
        targetPos = {
          x: c.position.x + Math.cos(angle) * Math.min(moveSpeed, approachDist),
          y: c.position.y + Math.sin(angle) * Math.min(moveSpeed, approachDist),
        };
        c.facing = angle;
      }
    } else if (visible.length > 0 && healthFrac <= AI_BEHAVIOR.FLEE_HEALTH_THRESHOLD) {
      // Flee from strongest visible enemy
      const strongest = visible.reduce((a, b) =>
        estimateThreat(a.creature) > estimateThreat(b.creature) ? a : b
      );
      const fleeAngle = angleTo(strongest.creature.position, c.position);
      moveSpeed *= AI_BEHAVIOR.FLEE_SPEED_MULTIPLIER;
      targetPos = {
        x: c.position.x + Math.cos(fleeAngle) * moveSpeed,
        y: c.position.y + Math.sin(fleeAngle) * moveSpeed,
      };
      c.facing = fleeAngle;
    } else {
      // Wander with center bias — creatures drift toward the arena center
      // so they eventually find each other even without sensors
      let wanderAngle: number;
      if (rng.next() < AI_BEHAVIOR.WANDER_CENTER_BIAS) {
        // Move toward center
        wanderAngle = Math.atan2(-c.position.y, -c.position.x);
      } else {
        wanderAngle = rng.nextAngle();
      }
      targetPos = {
        x: c.position.x + Math.cos(wanderAngle) * AI_BEHAVIOR.WANDER_DISTANCE,
        y: c.position.y + Math.sin(wanderAngle) * AI_BEHAVIOR.WANDER_DISTANCE,
      };
      c.facing = wanderAngle;
    }

    // Clamp to arena bounds
    const distFromCenter = Math.sqrt(targetPos.x * targetPos.x + targetPos.y * targetPos.y);
    if (distFromCenter > ARENA.RADIUS) {
      const scale = ARENA.RADIUS / distFromCenter;
      targetPos.x *= scale;
      targetPos.y *= scale;
    }

    c.position = targetPos;
  }
}

/** Phase 5: Attack — resolve weapon attacks and spike contact damage */
export function attackPhase(
  creatures: CreatureState[],
  rng: SeededRNG
): Array<{ attacker: CreatureState; target: CreatureState; damage: number; weapon: string }> {
  const hits: Array<{ attacker: CreatureState; target: CreatureState; damage: number; weapon: string }> = [];

  for (const attacker of creatures) {
    if (!attacker.alive) continue;

    // Brain-driven creatures with defensive stance only attack at contact range
    const isDefensive = attacker.brain != null
      && attacker.brainStance < DRIVES.DEFENSIVE_STANCE_THRESHOLD;

    // Active weapon attacks
    for (const weapon of attacker.weapons) {
      // Defensive creatures skip weapon attacks unless enemy is extremely close
      if (isDefensive && weapon.reach > COMBAT.CONTACT_RANGE) continue;
      // Find nearest alive enemy in range
      let bestTarget: CreatureState | null = null;
      let bestDist = Infinity;

      for (const target of creatures) {
        if (target.id === attacker.id || !target.alive) continue;
        const dist = distance(attacker.position, target.position);
        if (dist <= weapon.reach && dist < bestDist) {
          bestDist = dist;
          bestTarget = target;
        }
      }

      if (bestTarget) {
        // Speed damage bonus: faster creatures hit harder with active weapons
        // Uses speed squared for stronger differentiation between fast and slow builds
        const speedBonus = 1 + (attacker.speed * attacker.speed) * SPEED.SPEED_DAMAGE_BONUS_FACTOR;
        hits.push({
          attacker,
          target: bestTarget,
          damage: weapon.damage * speedBonus,
          weapon: weapon.instanceId,
        });
      }
    }

    // Spike contact damage
    if (attacker.contactDamage > 0) {
      for (const target of creatures) {
        if (target.id === attacker.id || !target.alive) continue;
        const dist = distance(attacker.position, target.position);
        if (dist <= COMBAT.CONTACT_RANGE) {
          hits.push({
            attacker,
            target,
            damage: attacker.contactDamage,
            weapon: 'spikes',
          });
        }
      }
    }
  }

  return hits;
}

/** Choose which part gets hit on a target creature */
function chooseHitPart(target: CreatureState, rng: SeededRNG): RuntimePart | null {
  const parts = collectAttachedParts(target.rootPart);
  if (parts.length === 0) return null;

  // Weighted random: armor parts and shell are more likely to absorb hits
  // (they're on the outside). Core is least likely (most protected).
  const weights: number[] = [];
  for (const p of parts) {
    if (p.definition.role === 'passive_armor') {
      weights.push(COMBAT.HIT_WEIGHT_PASSIVE_ARMOR);
    } else if (p.definition.role === 'armor') {
      weights.push(COMBAT.HIT_WEIGHT_ARMOR);
    } else if (p.definition.role === 'core') {
      weights.push(COMBAT.HIT_WEIGHT_CORE);
    } else {
      weights.push(COMBAT.HIT_WEIGHT_DEFAULT);
    }
  }

  let totalWeight = 0;
  for (const w of weights) totalWeight += w;
  let roll = rng.next() * totalWeight;

  for (let i = 0; i < parts.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return parts[i];
  }

  return parts[parts.length - 1];
}

/** Phase 5: Damage — apply hits, handle armor reduction, detach broken parts */
export function damagePhase(
  hits: Array<{ attacker: CreatureState; target: CreatureState; damage: number; weapon: string }>,
  creatures: CreatureState[],
  rng: SeededRNG,
  events: SensoryEvent[],
  tick: number
): void {
  for (const hit of hits) {
    const { attacker, target, damage } = hit;
    if (!target.alive) continue;

    // Speed-based evasion: faster creatures are harder to hit (quadratic scaling)
    const evasionChance = Math.min(
      target.speed * target.speed * COMBAT.EVASION_PER_SPEED_SQ,
      COMBAT.MAX_EVASION
    );
    if (rng.next() < evasionChance) continue; // dodged!

    const hitPart = chooseHitPart(target, rng);
    if (!hitPart) continue;

    // Armor reduction
    const armorReduction = Math.min(
      target.totalArmor * COMBAT.ARMOR_REDUCTION_PER_POINT,
      COMBAT.MAX_ARMOR_REDUCTION
    );
    let effectiveDamage = damage * (1 - armorReduction);

    // Shell flat reduction for non-spike hits
    if (hitPart.definition.role === 'passive_armor' && hit.weapon !== 'spikes') {
      effectiveDamage = Math.max(0, effectiveDamage - COMBAT.SHELL_FLAT_REDUCTION);
    }

    if (effectiveDamage <= 0) continue;

    // Apply damage to hit part
    hitPart.currentDurability -= effectiveDamage;
    hitPart.accumulatedDamage += effectiveDamage;

    // Propagate partial damage through joints to parent
    if (hitPart.parent && hitPart.parent.attached) {
      const propagated = effectiveDamage * COMBAT.JOINT_DAMAGE_PROPAGATION;
      hitPart.parent.currentDurability -= propagated;
      hitPart.parent.accumulatedDamage += propagated;
    }

    // Track stats (cumulative + per-tick deltas for drive system)
    attacker.damageDealt += effectiveDamage;
    attacker.tickDamageDealt += effectiveDamage;
    target.damageTaken += effectiveDamage;
    target.tickDamageTaken += effectiveDamage;

    // Record contact hit event
    events.push({
      tick,
      creatureId: target.id,
      type: 'contact_hit',
      data: {
        damage: effectiveDamage,
        hitPart: hitPart.instanceId,
        attackerId: attacker.id,
      },
    });

    // Check for part detachment
    detachDestroyedParts(target, attacker, events, tick);
  }
}

/** Recursively detach parts with durability <= 0, including their children */
function detachDestroyedParts(
  owner: CreatureState,
  attacker: CreatureState,
  events: SensoryEvent[],
  tick: number
): void {
  function checkPart(part: RuntimePart): void {
    if (!part.attached) return;

    if (part.currentDurability <= 0) {
      detachSubtree(part, owner, attacker, events, tick);
      return;
    }

    // Check children (copy array since detach modifies it)
    for (const child of [...part.children]) {
      checkPart(child);
    }
  }

  // Don't check root (body) — body destruction is a death condition
  for (const child of [...owner.rootPart.children]) {
    checkPart(child);
  }
}

function detachSubtree(
  part: RuntimePart,
  owner: CreatureState,
  attacker: CreatureState,
  events: SensoryEvent[],
  tick: number
): void {
  // Count all parts in subtree
  const subtreeParts = collectAttachedParts(part);
  const detachedCount = subtreeParts.length;

  // Mark all as detached
  for (const p of subtreeParts) {
    p.attached = false;
  }

  // Remove from parent's children
  if (part.parent) {
    part.parent.children = part.parent.children.filter((c) => c !== part);
  }

  owner.partsLost += detachedCount;
  owner.tickPartsLost += detachedCount;
  attacker.partsDestroyed += detachedCount;

  events.push({
    tick,
    creatureId: owner.id,
    type: 'part_lost',
    data: { partId: part.definition.id, instanceId: part.instanceId, count: detachedCount },
  });
  events.push({
    tick,
    creatureId: attacker.id,
    type: 'part_destroyed_on_enemy',
    data: { targetId: owner.id, partId: part.definition.id, count: detachedCount },
  });

  // Recalculate owner stats
  recalculateStats(owner);
}

/** Phase 6: Death check — remove dead creatures */
export function deathCheckPhase(
  creatures: CreatureState[],
  events: SensoryEvent[],
  tick: number
): void {
  for (const c of creatures) {
    if (!c.alive) continue;

    let cause: 'core_destroyed' | 'no_locomotion' | 'energy_depleted' | null = null;

    // Core destroyed
    if (c.rootPart.currentDurability <= 0) {
      cause = 'core_destroyed';
    }

    // No locomotion
    if (cause === null) {
      const parts = collectAttachedParts(c.rootPart);
      const hasLocomotion = parts.some((p) => p.definition.role === 'locomotion');
      if (!hasLocomotion) {
        cause = 'no_locomotion';
      }
    }

    // Energy depleted (core durability dropped to zero from energy deficit)
    if (cause === null && c.rootPart.currentDurability <= 0) {
      cause = 'energy_depleted';
    }

    if (cause !== null) {
      c.alive = false;
      c.deathCause = cause;
      c.tickOfDeath = tick;

      events.push({
        tick,
        creatureId: c.id,
        type: 'enemy_killed',
        data: { cause },
      });
    }
  }
}
