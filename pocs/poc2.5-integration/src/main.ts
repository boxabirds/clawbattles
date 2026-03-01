import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DbConnection } from './module_bindings';
import type { Creature, Player, EventCombat } from './module_bindings/types';

// ---- Constants ----
const GROUND_SIZE = 100;
const GROUND_Y = 0;
const GROUND_COLOR = 0x2a2a4a;
const GROUND_SHININESS = 10;
const BACKGROUND_COLOR = 0x1a1a2e;
const FOG_NEAR = 80;
const FOG_FAR = 150;

const CREATURE_RADIUS = 0.5;
const CREATURE_SEGMENTS_W = 16;
const CREATURE_SEGMENTS_H = 12;
const CREATURE_Y_OFFSET = 0.3;
const CREATURE_SHININESS = 20;
const CREATURE_HUE_SATURATION = 0.7;
const CREATURE_HUE_LIGHTNESS_MINE = 0.6;
const CREATURE_HUE_LIGHTNESS_OTHER = 0.4;
const CREATURE_HUE_MODULO = 360;

const SELECT_RING_INNER = 0.75;
const SELECT_RING_OUTER = 0.85;
const SELECT_RING_SEGMENTS = 32;
const SELECT_RING_OPACITY = 0.6;
const SELECT_RING_Y_OFFSET = 0.02;

const TARGET_LINE_COLOR = 0x666688;
const TARGET_LINE_OPACITY = 0.5;
const TARGET_LINE_Y_OFFSET = 0.05;
const MOVEMENT_THRESHOLD = 1;

const GRID_DIVISIONS = 20;
const GRID_CENTER_COLOR = 0x333355;
const GRID_LINE_COLOR = 0x222244;
const GRID_Y_OFFSET = 0.01;

const AMBIENT_LIGHT_COLOR = 0x8888cc;
const AMBIENT_LIGHT_INTENSITY = 0.6;
const DIR_LIGHT_INTENSITY = 1.2;
const DIR_LIGHT_X = 20;
const DIR_LIGHT_Y = 40;
const DIR_LIGHT_Z = 15;

const CAMERA_FOV = 45;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;
const CAMERA_START_X = 30;
const CAMERA_START_Y = 25;
const CAMERA_START_Z = 30;
const CAMERA_MAX_POLAR = Math.PI / 2.2;
const ORBIT_DAMPING = 0.1;

const FPS_SAMPLE_MS = 250;
const FPS_GOOD_THRESHOLD = 50;
const FPS_OK_THRESHOLD = 30;
const FPS_COLOR_GOOD = '#4ade80';
const FPS_COLOR_OK = '#facc15';
const FPS_COLOR_BAD = '#f87171';

const STDB_URI = `ws://${window.location.hostname}:3000`;
const STDB_DATABASE = 'poc2';
const AUTH_TOKEN_KEY = 'poc25_token';

const MAX_LOG_ENTRIES = 50;

// SpacetimeDB world is 0-500. Map to Three.js centered coords -50..+50.
const DB_WORLD_SIZE = 500;
const WORLD_SCALE = GROUND_SIZE / DB_WORLD_SIZE;
const WORLD_OFFSET = GROUND_SIZE / 2;

const STATUS_CONNECTED_COLOR = '#4ade80';
const STATUS_ERROR_COLOR = '#f87171';

// ---- State ----
const creatureMap = new Map<bigint, Creature>();
const creatureMeshes = new Map<bigint, THREE.Mesh>();
const playerMap = new Map<string, Player>();
const targetLines = new Map<bigint, THREE.Line>();
let selectedCreatureId: bigint | null = null;
let myIdentity: string | null = null;
let conn: DbConnection | null = null;
let selectionRing: THREE.Mesh | null = null;

// ---- DOM ----
const connStatusEl = document.getElementById('conn-status')!;
const playerCountEl = document.getElementById('player-count')!;
const creatureCountEl = document.getElementById('creature-count')!;
const fpsEl = document.getElementById('fps-display')!;
const logEl = document.getElementById('event-log')!;

function log(msg: string) {
  const div = document.createElement('div');
  const ts = new Date().toLocaleTimeString();
  div.textContent = `[${ts}] ${msg}`;
  logEl.prepend(div);
  while (logEl.children.length > MAX_LOG_ENTRIES) {
    logEl.removeChild(logEl.lastChild!);
  }
}

// ---- Three.js Setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(BACKGROUND_COLOR);
scene.fog = new THREE.Fog(BACKGROUND_COLOR, FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  CAMERA_NEAR,
  CAMERA_FAR,
);
camera.position.set(CAMERA_START_X, CAMERA_START_Y, CAMERA_START_Z);
camera.lookAt(0, 0, 0);

// Lights
scene.add(new THREE.AmbientLight(AMBIENT_LIGHT_COLOR, AMBIENT_LIGHT_INTENSITY));
const dirLight = new THREE.DirectionalLight(0xffffff, DIR_LIGHT_INTENSITY);
dirLight.position.set(DIR_LIGHT_X, DIR_LIGHT_Y, DIR_LIGHT_Z);
scene.add(dirLight);

// Ground plane
const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMat = new THREE.MeshPhongMaterial({
  color: GROUND_COLOR,
  shininess: GROUND_SHININESS,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
ground.name = 'ground';
scene.add(ground);

// Grid helper
const grid = new THREE.GridHelper(GROUND_SIZE, GRID_DIVISIONS, GRID_CENTER_COLOR, GRID_LINE_COLOR);
grid.position.y = GROUND_Y + GRID_Y_OFFSET;
scene.add(grid);

// Shared geometry
const creatureGeo = new THREE.SphereGeometry(CREATURE_RADIUS, CREATURE_SEGMENTS_W, CREATURE_SEGMENTS_H);
const selectRingGeo = new THREE.RingGeometry(SELECT_RING_INNER, SELECT_RING_OUTER, SELECT_RING_SEGMENTS);
const targetLineMat = new THREE.LineBasicMaterial({
  color: TARGET_LINE_COLOR,
  transparent: true,
  opacity: TARGET_LINE_OPACITY,
});

// ---- Renderer ----
let renderer: THREE.WebGPURenderer | THREE.WebGLRenderer;
let controls: OrbitControls;

async function initRenderer() {
  // Try WebGPU first, fall back to WebGL
  let useWebGPU = false;
  try {
    const { WebGPURenderer } = await import('three/webgpu');
    renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    await renderer.init();
    useWebGPU = true;
    log('Renderer: WebGPU');
  } catch {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    log('Renderer: WebGL (WebGPU unavailable)');
  }

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = ORBIT_DAMPING;
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = CAMERA_MAX_POLAR;
  controls.update();
}

// ---- Coordinate conversion ----
function dbToThreeX(dbX: number): number {
  return dbX * WORLD_SCALE - WORLD_OFFSET;
}

function dbToThreeZ(dbY: number): number {
  return dbY * WORLD_SCALE - WORLD_OFFSET;
}

function threeToDbX(threeX: number): number {
  return (threeX + WORLD_OFFSET) / WORLD_SCALE;
}

function threeToDbY(threeZ: number): number {
  return (threeZ + WORLD_OFFSET) / WORLD_SCALE;
}

// ---- Creature rendering ----
function ownerToHue(ownerHex: string): number {
  let h = 0;
  for (let i = 0; i < ownerHex.length; i++) {
    h = ((h << 5) - h + ownerHex.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % CREATURE_HUE_MODULO;
}

function addCreatureMesh(row: Creature) {
  const ownerHex = row.owner?.toHexString?.() ?? String(row.owner);
  const isMine = ownerHex === myIdentity;
  const hue = ownerToHue(ownerHex);
  const lightness = isMine ? CREATURE_HUE_LIGHTNESS_MINE : CREATURE_HUE_LIGHTNESS_OTHER;
  const color = new THREE.Color().setHSL(hue / CREATURE_HUE_MODULO, CREATURE_HUE_SATURATION, lightness);

  const mat = new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: CREATURE_SHININESS });
  const mesh = new THREE.Mesh(creatureGeo, mat);

  mesh.position.set(dbToThreeX(row.x), CREATURE_Y_OFFSET, dbToThreeZ(row.y));
  mesh.userData.creatureId = row.id;

  scene.add(mesh);
  creatureMeshes.set(row.id, mesh);
}

function updateCreatureMesh(row: Creature) {
  const mesh = creatureMeshes.get(row.id);
  if (!mesh) return;
  mesh.position.set(dbToThreeX(row.x), CREATURE_Y_OFFSET, dbToThreeZ(row.y));
}

function removeCreatureMesh(id: bigint) {
  const mesh = creatureMeshes.get(id);
  if (mesh) {
    scene.remove(mesh);
    (mesh.material as THREE.Material).dispose();
    creatureMeshes.delete(id);
  }
  if (selectedCreatureId === id) {
    selectedCreatureId = null;
  }
}

// ---- SpacetimeDB Connection ----
function connectToSTDB() {
  const storedToken = localStorage.getItem(AUTH_TOKEN_KEY) || undefined;

  conn = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DATABASE)
    .withToken(storedToken)
    .onConnect((connection, identity, token) => {
      myIdentity = identity.toHexString();
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      connStatusEl.textContent = 'Connected';
      connStatusEl.style.color = STATUS_CONNECTED_COLOR;
      log(`Connected as ${myIdentity.slice(0, 12)}...`);

      connection.subscriptionBuilder()
        .onApplied(() => {
          log('Subscriptions active');
          updateStats();
        })
        .onError((_ctx: unknown, err: unknown) => log(`Sub error: ${err}`))
        .subscribe([
          'SELECT * FROM player',
          'SELECT * FROM creature',
          'SELECT * FROM event_combat',
        ]);
    })
    .onConnectError((_ctx: unknown, err: unknown) => {
      connStatusEl.textContent = 'Error';
      connStatusEl.style.color = STATUS_ERROR_COLOR;
      log(`Connection error: ${err}`);
    })
    .onDisconnect(() => {
      connStatusEl.textContent = 'Disconnected';
      connStatusEl.style.color = STATUS_ERROR_COLOR;
      log('Disconnected');
    })
    .build();

  // Table callbacks
  conn.db.player.onInsert((_ctx: unknown, row: Player) => {
    const hex = row.identity.toHexString();
    playerMap.set(hex, row);
    log(`Player joined: ${row.name}`);
    updateStats();
  });
  conn.db.player.onUpdate((_ctx: unknown, _old: Player, row: Player) => {
    playerMap.set(row.identity.toHexString(), row);
    updateStats();
  });
  conn.db.player.onDelete((_ctx: unknown, row: Player) => {
    playerMap.delete(row.identity.toHexString());
    updateStats();
  });

  conn.db.creature.onInsert((_ctx: unknown, row: Creature) => {
    creatureMap.set(row.id, row);
    addCreatureMesh(row);
    log(`Creature ${row.id} spawned`);
    updateStats();
  });
  conn.db.creature.onUpdate((_ctx: unknown, _old: Creature, row: Creature) => {
    creatureMap.set(row.id, row);
    updateCreatureMesh(row);
    updateStats();
  });
  conn.db.creature.onDelete((_ctx: unknown, row: Creature) => {
    creatureMap.delete(row.id);
    removeCreatureMesh(row.id);
    updateStats();
  });

  conn.db.eventCombat.onInsert((_ctx: unknown, row: EventCombat) => {
    log(`Combat! ${row.attackerId} vs ${row.defenderId} (${row.damage} dmg)`);
  });
}

function updateStats() {
  playerCountEl.textContent = String(playerMap.size);
  creatureCountEl.textContent = String(creatureMap.size);
}

// ---- Raycasting / Input ----
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

function screenToNDC(event: MouseEvent): void {
  mouseNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function getGroundIntersection(event: MouseEvent): THREE.Vector3 | null {
  screenToNDC(event);
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObject(ground);
  return hits.length > 0 ? hits[0].point : null;
}

function getCreatureIntersection(event: MouseEvent): bigint | null {
  screenToNDC(event);
  raycaster.setFromCamera(mouseNDC, camera);
  const meshArray = [...creatureMeshes.values()];
  const hits = raycaster.intersectObjects(meshArray);
  if (hits.length > 0) {
    return hits[0].object.userData.creatureId;
  }
  return null;
}

function isOverHUD(event: MouseEvent): boolean {
  return !!(event.target as HTMLElement).closest('#hud, #event-log, #controls-hint');
}

// Left click: spawn creature at ground position
window.addEventListener('click', (e) => {
  if (!conn || isOverHUD(e)) return;

  const point = getGroundIntersection(e);
  if (!point) return;

  const dbX = threeToDbX(point.x);
  const dbY = threeToDbY(point.z);

  conn.reducers.spawnCreature({ x: dbX, y: dbY });
  log(`Spawning at (${dbX.toFixed(0)}, ${dbY.toFixed(0)})`);
});

// Right click: select creature or move selected creature
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!conn) return;

  // Check for creature hit first
  const creatureId = getCreatureIntersection(e);
  if (creatureId !== null) {
    selectedCreatureId = creatureId;
    log(`Selected creature ${creatureId}`);
    return;
  }

  // Move selected creature to ground point
  if (selectedCreatureId !== null) {
    const point = getGroundIntersection(e);
    if (!point) return;

    const dbX = threeToDbX(point.x);
    const dbY = threeToDbY(point.z);

    conn.reducers.moveCreature({
      creatureId: selectedCreatureId,
      targetX: dbX,
      targetY: dbY,
    });
    log(`Moving creature ${selectedCreatureId} to (${dbX.toFixed(0)}, ${dbY.toFixed(0)})`);
    selectedCreatureId = null;
  }
});

// ---- Selection ring + target lines rendering ----
function updateSelectionRing() {
  if (selectedCreatureId !== null && creatureMeshes.has(selectedCreatureId)) {
    if (!selectionRing) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: SELECT_RING_OPACITY,
      });
      selectionRing = new THREE.Mesh(selectRingGeo, mat);
      selectionRing.rotation.x = -Math.PI / 2;
      scene.add(selectionRing);
    }
    const creatureMesh = creatureMeshes.get(selectedCreatureId)!;
    selectionRing.position.set(
      creatureMesh.position.x,
      GROUND_Y + SELECT_RING_Y_OFFSET,
      creatureMesh.position.z,
    );
    selectionRing.visible = true;
  } else if (selectionRing) {
    selectionRing.visible = false;
  }
}

function updateTargetLines() {
  // Remove stale lines
  for (const [id, line] of targetLines) {
    if (!creatureMap.has(id)) {
      scene.remove(line);
      line.geometry.dispose();
      targetLines.delete(id);
    }
  }

  for (const [id, row] of creatureMap) {
    const dx = row.targetX - row.x;
    const dy = row.targetY - row.y;
    if (Math.abs(dx) < MOVEMENT_THRESHOLD && Math.abs(dy) < MOVEMENT_THRESHOLD) {
      const existing = targetLines.get(id);
      if (existing) existing.visible = false;
      continue;
    }

    const fromX = dbToThreeX(row.x);
    const fromZ = dbToThreeZ(row.y);
    const toX = dbToThreeX(row.targetX);
    const toZ = dbToThreeZ(row.targetY);

    let line = targetLines.get(id);
    if (!line) {
      const geo = new THREE.BufferGeometry();
      const VERTICES_PER_LINE = 2;
      const COMPONENTS_PER_VERTEX = 3;
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(new Float32Array(VERTICES_PER_LINE * COMPONENTS_PER_VERTEX), COMPONENTS_PER_VERTEX),
      );
      line = new THREE.Line(geo, targetLineMat);
      scene.add(line);
      targetLines.set(id, line);
    }

    const positions = line.geometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, fromX, GROUND_Y + TARGET_LINE_Y_OFFSET, fromZ);
    positions.setXYZ(1, toX, GROUND_Y + TARGET_LINE_Y_OFFSET, toZ);
    positions.needsUpdate = true;
    line.visible = true;
  }
}

// ---- FPS ----
let frameCount = 0;
let lastFpsTime = 0;

function updateFps(now: number) {
  frameCount++;
  if (now - lastFpsTime >= FPS_SAMPLE_MS) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
    fpsEl.textContent = String(fps);
    if (fps >= FPS_GOOD_THRESHOLD) {
      fpsEl.style.color = FPS_COLOR_GOOD;
    } else if (fps >= FPS_OK_THRESHOLD) {
      fpsEl.style.color = FPS_COLOR_OK;
    } else {
      fpsEl.style.color = FPS_COLOR_BAD;
    }
    frameCount = 0;
    lastFpsTime = now;
  }
}

// ---- Resize ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Main Loop ----
async function main() {
  await initRenderer();
  connectToSTDB();
  lastFpsTime = performance.now();

  function animate() {
    const now = performance.now();
    updateFps(now);
    updateSelectionRing();
    updateTargetLines();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

main().catch(console.error);
