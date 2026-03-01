import type { CreatureState, Vec2, SensorInfo } from './types.js';

/** Euclidean distance between two points */
export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Angle from point a to point b (radians) */
export function angleTo(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Normalize angle to [0, 2*PI) */
function normalizeAngle(angle: number): number {
  const TWO_PI = Math.PI * 2;
  let result = angle % TWO_PI;
  if (result < 0) result += TWO_PI;
  return result;
}

/** Check if an angle is within a given arc centered on a facing direction */
function isInArc(targetAngle: number, facingAngle: number, arcRadians: number): boolean {
  const FULL_CIRCLE = Math.PI * 2;
  // 360-degree sensors always return true
  if (arcRadians >= FULL_CIRCLE) return true;

  const halfArc = arcRadians / 2;
  const diff = normalizeAngle(targetAngle - facingAngle);
  return diff <= halfArc || diff >= FULL_CIRCLE - halfArc;
}

export interface VisibleEnemy {
  creature: CreatureState;
  distance: number;
  angle: number;
}

/**
 * Determine which enemies a creature can see based on its sensor parts.
 * Returns list of visible enemies with distance/angle info.
 */
export function getVisibleEnemies(
  observer: CreatureState,
  allCreatures: CreatureState[]
): VisibleEnemy[] {
  if (observer.sensorRanges.length === 0) {
    // Blind creature — sees nothing
    return [];
  }

  const visible: VisibleEnemy[] = [];
  const seen = new Set<string>();

  for (const other of allCreatures) {
    if (other.id === observer.id || !other.alive) continue;
    if (seen.has(other.id)) continue;

    const dist = distance(observer.position, other.position);
    const angle = angleTo(observer.position, other.position);

    for (const sensor of observer.sensorRanges) {
      if (dist <= sensor.range && isInArc(angle, observer.facing, sensor.arc)) {
        visible.push({ creature: other, distance: dist, angle });
        seen.add(other.id);
        break;
      }
    }
  }

  return visible;
}

/**
 * Estimate total "threat" of a creature (for flee AI).
 * Higher = more dangerous.
 */
export function estimateThreat(creature: CreatureState): number {
  let threat = 0;
  for (const w of creature.weapons) {
    threat += w.damage;
  }
  threat += creature.contactDamage;
  threat += creature.speed;
  return threat;
}
