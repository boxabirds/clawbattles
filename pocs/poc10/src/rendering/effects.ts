import * as THREE from 'three';

// ── Hit flash constants ───────────────────────────────────────────
const FLASH_DURATION_MS = 100;
const FLASH_COLOR = new THREE.Color(0xffffff);

// ── Part debris constants ─────────────────────────────────────────
const DEBRIS_DURATION_MS = 2000;
const DEBRIS_GRAVITY = -15;
const DEBRIS_LAUNCH_SPEED = 5;
const DEBRIS_SPIN_SPEED = 8;

interface ActiveFlash {
  mesh: THREE.Mesh;
  originalEmissive: THREE.Color;
  startTime: number;
}

interface DebrisParticle {
  obj: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  startTime: number;
}

export class EffectsManager {
  private flashes: ActiveFlash[] = [];
  private debris: DebrisParticle[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Flash a mesh white briefly on hit */
  triggerFlash(mesh: THREE.Mesh): void {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat.emissive) return;

    this.flashes.push({
      mesh,
      originalEmissive: mat.emissive.clone(),
      startTime: performance.now(),
    });

    mat.emissive.copy(FLASH_COLOR);
    mat.emissiveIntensity = 1;
  }

  /** Launch a part as debris (clone it, remove from creature, animate) */
  spawnDebris(obj: THREE.Object3D, worldPos: THREE.Vector3): void {
    const clone = obj.clone();
    clone.position.copy(worldPos);
    this.scene.add(clone);

    const angle = Math.random() * Math.PI * 2;
    const velocity = new THREE.Vector3(
      Math.cos(angle) * DEBRIS_LAUNCH_SPEED,
      DEBRIS_LAUNCH_SPEED * 1.5,
      Math.sin(angle) * DEBRIS_LAUNCH_SPEED
    );

    const spin = new THREE.Vector3(
      (Math.random() - 0.5) * DEBRIS_SPIN_SPEED,
      (Math.random() - 0.5) * DEBRIS_SPIN_SPEED,
      (Math.random() - 0.5) * DEBRIS_SPIN_SPEED
    );

    this.debris.push({ obj: clone, velocity, spin, startTime: performance.now() });
  }

  /** Update all active effects. Call every frame. */
  update(): void {
    const now = performance.now();

    // Update flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      const elapsed = now - flash.startTime;
      if (elapsed >= FLASH_DURATION_MS) {
        const mat = flash.mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(flash.originalEmissive);
        mat.emissiveIntensity = 0;
        this.flashes.splice(i, 1);
      }
    }

    // Update debris
    const dt = 1 / 60; // approximate
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const elapsed = now - d.startTime;

      if (elapsed >= DEBRIS_DURATION_MS) {
        this.scene.remove(d.obj);
        this.debris.splice(i, 1);
        continue;
      }

      // Physics
      d.velocity.y += DEBRIS_GRAVITY * dt;
      d.obj.position.addScaledVector(d.velocity, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;

      // Fade
      const t = elapsed / DEBRIS_DURATION_MS;
      d.obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (!mat.transparent) {
            mat.transparent = true;
            mat.depthWrite = false;
          }
          mat.opacity = 1 - t;
        }
      });
    }
  }

  /** Clean up all active effects */
  dispose(): void {
    for (const d of this.debris) {
      this.scene.remove(d.obj);
    }
    this.debris = [];

    for (const flash of this.flashes) {
      const mat = flash.mesh.material as THREE.MeshStandardMaterial;
      mat.emissive.copy(flash.originalEmissive);
      mat.emissiveIntensity = 0;
    }
    this.flashes = [];
  }
}
