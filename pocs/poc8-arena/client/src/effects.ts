/**
 * effects.ts
 *
 * Visual combat effects: lunge, damage flash, screen shake, death explosion.
 * All are time-based animations that tick each frame.
 */

import * as THREE from 'three';

// ── Constants ─────────────────────────────────────────────────────

const LUNGE_DISTANCE = 0.3;
const LUNGE_DURATION_MS = 200;

const FLASH_DURATION_MS = 100;
const FLASH_COLOR = new THREE.Color(0xffffff);

/** Screen shake tiers */
export const SHAKE_SMALL = { intensity: 0.3, durationMs: 150 };
export const SHAKE_MEDIUM = { intensity: 0.8, durationMs: 300 };
export const SHAKE_LARGE = { intensity: 1.5, durationMs: 400 };

const DEATH_EXPLODE_DURATION_MS = 1500;
const DEATH_EXPLODE_SPEED = 2.0;
const DEATH_GRAVITY = -4;

/** Death flash: bright point light that fades over this duration */
const DEATH_FLASH_DURATION_MS = 2500;
const DEATH_FLASH_INTENSITY = 15;
const DEATH_FLASH_DISTANCE = 40;
const DEATH_FLASH_HEIGHT = 3;

// ── Lunge animation ──────────────────────────────────────────────

interface Lunge {
  group: THREE.Group;
  direction: THREE.Vector3;
  startTime: number;
  originalPos: THREE.Vector3;
}

const activeLunges: Lunge[] = [];

/**
 * Brief lunge toward a target position.
 * The group translates forward then snaps back.
 */
export function triggerLunge(group: THREE.Group, targetWorldPos: THREE.Vector3): void {
  const dir = new THREE.Vector3()
    .subVectors(targetWorldPos, group.position)
    .normalize();

  activeLunges.push({
    group,
    direction: dir,
    startTime: performance.now(),
    originalPos: group.position.clone(),
  });
}

export function updateLunges(): void {
  const now = performance.now();
  for (let i = activeLunges.length - 1; i >= 0; i--) {
    const l = activeLunges[i];
    const elapsed = now - l.startTime;

    if (elapsed > LUNGE_DURATION_MS) {
      // Snap back
      l.group.position.copy(l.originalPos);
      activeLunges.splice(i, 1);
      continue;
    }

    // Ease-in-out: go forward then back
    const t = elapsed / LUNGE_DURATION_MS;
    const offset = Math.sin(t * Math.PI) * LUNGE_DISTANCE;
    l.group.position.copy(l.originalPos).addScaledVector(l.direction, offset);
  }
}

// ── Damage flash ──────────────────────────────────────────────────

interface Flash {
  mesh: THREE.Object3D;
  originalEmissive: Map<THREE.MeshStandardMaterial, THREE.Color>;
  startTime: number;
}

const activeFlashes: Flash[] = [];

/**
 * Flash a part white for FLASH_DURATION_MS.
 * Works on any Object3D by traversing its mesh children.
 */
export function triggerFlash(obj: THREE.Object3D): void {
  const originalEmissive = new Map<THREE.MeshStandardMaterial, THREE.Color>();

  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      originalEmissive.set(child.material, child.material.emissive.clone());
      child.material.emissive.copy(FLASH_COLOR);
      child.material.emissiveIntensity = 1.0;
    }
  });

  if (originalEmissive.size > 0) {
    activeFlashes.push({ mesh: obj, originalEmissive, startTime: performance.now() });
  }
}

export function updateFlashes(): void {
  const now = performance.now();
  for (let i = activeFlashes.length - 1; i >= 0; i--) {
    const f = activeFlashes[i];
    const elapsed = now - f.startTime;

    if (elapsed > FLASH_DURATION_MS) {
      // Restore original emissive
      for (const [mat, orig] of f.originalEmissive) {
        mat.emissive.copy(orig);
        mat.emissiveIntensity = 0.6; // default
      }
      activeFlashes.splice(i, 1);
      continue;
    }

    // Decay from white back to original
    const t = elapsed / FLASH_DURATION_MS;
    for (const [mat, orig] of f.originalEmissive) {
      mat.emissive.lerpColors(FLASH_COLOR, orig, t);
      mat.emissiveIntensity = 1.0 - t * 0.4;
    }
  }
}

// ── Screen shake ──────────────────────────────────────────────────

interface Shake {
  intensity: number;
  durationMs: number;
  startTime: number;
}

let activeShake: Shake | null = null;

/**
 * Start a screen shake. Overwrites any current shake if stronger.
 */
export function triggerShake(params: { intensity: number; durationMs: number }): void {
  if (activeShake && activeShake.intensity > params.intensity) {
    // Don't override a stronger shake
    const remaining = activeShake.durationMs - (performance.now() - activeShake.startTime);
    if (remaining > 0) return;
  }
  activeShake = { ...params, startTime: performance.now() };
}

/**
 * Returns a camera offset vector to apply this frame.
 * Returns zero vector if no shake active.
 */
export function getShakeOffset(): THREE.Vector3 {
  if (!activeShake) return new THREE.Vector3();

  const elapsed = performance.now() - activeShake.startTime;
  if (elapsed > activeShake.durationMs) {
    activeShake = null;
    return new THREE.Vector3();
  }

  // Linear decay
  const remaining = 1 - elapsed / activeShake.durationMs;
  const scale = activeShake.intensity * remaining;

  return new THREE.Vector3(
    (Math.random() - 0.5) * scale,
    (Math.random() - 0.5) * scale * 0.5,
    (Math.random() - 0.5) * scale,
  );
}

// ── Death explosion ───────────────────────────────────────────────

interface DeathDebris {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  created: number;
}

const deathDebris: DeathDebris[] = [];

/**
 * Explode all remaining parts on a creature outward + downward.
 */
export function triggerDeathExplosion(group: THREE.Group, partMeshes: Map<string, THREE.Object3D>): void {
  const worldPos = new THREE.Vector3();
  group.getWorldPosition(worldPos);

  for (const [_id, partObj] of partMeshes) {
    const partWorld = new THREE.Vector3();
    partObj.getWorldPosition(partWorld);

    const clone = partObj.clone();
    clone.position.copy(partWorld);
    // Need to add to a parent scope — caller handles this via returned array
    group.parent?.add(clone);

    // Direction: outward from center of creature
    const dir = new THREE.Vector3().subVectors(partWorld, worldPos).normalize();
    if (dir.lengthSq() < 0.01) {
      dir.set(Math.random() - 0.5, 0.5, Math.random() - 0.5).normalize();
    }

    deathDebris.push({
      mesh: clone,
      velocity: dir.multiplyScalar(DEATH_EXPLODE_SPEED).add(new THREE.Vector3(0, 2, 0)),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
      ),
      created: performance.now(),
    });
  }

  // Hide the original creature group
  group.visible = false;
}

export function updateDeathDebris(dt: number): void {
  const now = performance.now();
  for (let i = deathDebris.length - 1; i >= 0; i--) {
    const d = deathDebris[i];
    const age = now - d.created;

    if (age > DEATH_EXPLODE_DURATION_MS) {
      d.mesh.parent?.remove(d.mesh);
      deathDebris.splice(i, 1);
      continue;
    }

    d.velocity.y += DEATH_GRAVITY * dt;
    d.mesh.position.add(d.velocity.clone().multiplyScalar(dt));

    d.mesh.rotation.x += d.angularVelocity.x * dt;
    d.mesh.rotation.y += d.angularVelocity.y * dt;
    d.mesh.rotation.z += d.angularVelocity.z * dt;

    // Fade
    const fadeProgress = age / DEATH_EXPLODE_DURATION_MS;
    d.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.transparent = true;
        child.material.opacity = 1 - fadeProgress;
      }
    });
  }
}

// ── Death flash light ────────────────────────────────────────────

interface DeathFlash {
  light: THREE.PointLight;
  created: number;
}

const deathFlashes: DeathFlash[] = [];

/**
 * Spawn a bright point light at a creature's death position.
 * Fades out over DEATH_FLASH_DURATION_MS (~2.5s).
 */
export function triggerDeathFlash(scene: THREE.Scene, position: THREE.Vector3, color: number): void {
  const light = new THREE.PointLight(color, DEATH_FLASH_INTENSITY, DEATH_FLASH_DISTANCE);
  light.position.set(position.x, position.y + DEATH_FLASH_HEIGHT, position.z);
  scene.add(light);
  deathFlashes.push({ light, created: performance.now() });
}

export function updateDeathFlashes(): void {
  const now = performance.now();
  for (let i = deathFlashes.length - 1; i >= 0; i--) {
    const f = deathFlashes[i];
    const age = now - f.created;

    if (age > DEATH_FLASH_DURATION_MS) {
      f.light.parent?.remove(f.light);
      f.light.dispose();
      deathFlashes.splice(i, 1);
      continue;
    }

    // Quadratic falloff for natural-looking fade
    const t = age / DEATH_FLASH_DURATION_MS;
    f.light.intensity = DEATH_FLASH_INTENSITY * (1 - t) * (1 - t);
  }
}
