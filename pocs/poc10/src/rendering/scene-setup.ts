import * as THREE from 'three';

// ── Lighting constants ────────────────────────────────────────────
const BG_COLOR = 0x0a0a12;
const AMBIENT_COLOR = 0x8888aa;
const AMBIENT_INTENSITY = 1.2;
const DIRECTIONAL_COLOR = 0xffffff;
const DIRECTIONAL_INTENSITY = 2.0;
const DIRECTIONAL_POSITION = [5, 8, 5] as const;
const FILL_LIGHT_COLOR = 0x8899cc;
const FILL_LIGHT_INTENSITY = 1.0;
const FILL_LIGHT_POSITION = [-4, 3, -3] as const;
const HEMISPHERE_SKY_COLOR = 0x6699dd;
const HEMISPHERE_GROUND_COLOR = 0x334466;
const HEMISPHERE_INTENSITY = 0.8;

// ── Ground constants ──────────────────────────────────────────────
const GRID_SIZE = 20;
const GRID_DIVISIONS = 20;
const GRID_COLOR = 0x3a3a5a;
const GRID_OPACITY = 0.3;
const GRID_Y = -0.5;

export interface SceneSetup {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  lights: {
    ambient: THREE.AmbientLight;
    directional: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    hemisphere: THREE.HemisphereLight;
  };
  ground: THREE.GridHelper;
}

/** Create the shared Three.js scene with lighting and ground grid */
export function createScene(): SceneSetup {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(DIRECTIONAL_COLOR, DIRECTIONAL_INTENSITY);
  directional.position.set(...DIRECTIONAL_POSITION);
  scene.add(directional);

  const fill = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
  fill.position.set(...FILL_LIGHT_POSITION);
  scene.add(fill);

  const hemisphere = new THREE.HemisphereLight(
    HEMISPHERE_SKY_COLOR, HEMISPHERE_GROUND_COLOR, HEMISPHERE_INTENSITY
  );
  scene.add(hemisphere);

  const ground = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, GRID_COLOR, GRID_COLOR);
  ground.position.y = GRID_Y;
  (ground.material as THREE.Material).opacity = GRID_OPACITY;
  (ground.material as THREE.Material).transparent = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  camera.position.set(2, 1.5, 3);

  return { scene, camera, lights: { ambient, directional, fill, hemisphere }, ground };
}

/** Clear all user-added objects from scene (preserve lights and ground) */
export function clearSceneObjects(scene: THREE.Scene, keep: THREE.Object3D[]): void {
  const keepSet = new Set(keep);
  const toRemove: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj !== scene && !keepSet.has(obj) && obj.parent === scene) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) {
    scene.remove(obj);
  }
}
