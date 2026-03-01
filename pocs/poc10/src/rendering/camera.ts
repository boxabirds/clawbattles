import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── Editor camera constants ──────────────────────────────────────
const EDITOR_FOV = 50;
const EDITOR_NEAR = 0.1;
const EDITOR_FAR = 100;
const EDITOR_POSITION: [number, number, number] = [2, 1.5, 3];
const ORBIT_DAMPING = 0.08;

// ── Arena camera constants ───────────────────────────────────────
const ARENA_FOV = 50;
const ARENA_HEIGHT = 60;
const ARENA_DISTANCE = 55;
const ARENA_ORBIT_SPEED = 0.08; // rad/s

export function createEditorCamera(canvas: HTMLCanvasElement): {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
} {
  const camera = new THREE.PerspectiveCamera(EDITOR_FOV, 1, EDITOR_NEAR, EDITOR_FAR);
  camera.position.set(...EDITOR_POSITION);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = ORBIT_DAMPING;
  controls.target.set(0, 0, 0);

  return { camera, controls };
}

export function createArenaCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(ARENA_FOV, 1, 0.1, 300);
  camera.position.set(0, ARENA_HEIGHT, ARENA_DISTANCE);
  camera.lookAt(0, 0, 0);
  return camera;
}

/** Simple arena camera that orbits the centroid of alive creatures */
export function updateArenaCamera(
  camera: THREE.PerspectiveCamera,
  positions: Array<{ x: number; y: number; z: number }>,
  time: number
): void {
  if (positions.length === 0) return;

  // Centroid
  let cx = 0, cy = 0, cz = 0;
  for (const p of positions) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  cx /= positions.length;
  cy /= positions.length;
  cz /= positions.length;

  // Orbit
  const angle = time * ARENA_ORBIT_SPEED;
  const orbitRadius = 40;
  camera.position.set(
    cx + Math.cos(angle) * orbitRadius,
    ARENA_HEIGHT,
    cz + Math.sin(angle) * orbitRadius
  );
  camera.lookAt(cx, cy, cz);
}
