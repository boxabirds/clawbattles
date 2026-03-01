/**
 * POC 11: ClawWorld Arena — Spectator Viewer
 *
 * Three.js visualization of matches running on SpacetimeDB.
 * Subscribes to MatchCreature, MatchPart, and MatchEvent.
 * Builds per-creature meshes from actual part trees.
 * Lerp interpolation at 60fps between 10Hz server ticks.
 */

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DbConnection } from './module_bindings';
import type {
  CreatureDesign,
  Match,
  MatchCreature,
  MatchEvent,
  MatchPart,
} from './module_bindings/types';
import { buildCreatureMesh, type CreatureMesh } from './creature-builder';
import {
  triggerLunge,
  updateLunges,
  triggerFlash,
  updateFlashes,
  triggerShake,
  getShakeOffset,
  triggerDeathExplosion,
  updateDeathDebris,
  triggerDeathFlash,
  updateDeathFlashes,
  SHAKE_LARGE,
} from './effects';
import {
  startDirector,
  stopDirector,
  isDirectorActive,
  directorEvent,
  updateDirector,
  type CreatureInfo,
} from './camera-director';
import { SoundManager } from './audio/sound-manager.js';

// ── Constants ─────────────────────────────────────────────────────

const STDB_URI = `ws://${window.location.hostname}:3000`;
const STDB_DATABASE = 'poc8arena';
const AUTH_TOKEN_KEY = 'poc8arena_token';
const RECONNECT_DELAY_MS = 2000;

/** Server arena radius — matches schema.ts ARENA.RADIUS */
const ARENA_RADIUS = 50;
/** Client-side interpolation factor (fraction per frame toward server position) */
const CLIENT_INTERP_FACTOR = 0.2;
/** Max frame delta time cap (seconds) */
const MAX_DELTA = 0.05;

/** Team color hues (degrees): Red, Green, Blue, Orange */
const TEAM_HUES = [0, 120, 210, 40];
const TEAM_SATURATION = 0.8;
const TEAM_BASE_LIGHTNESS = 0.5;
const TEAM_MEMBER_LIGHTNESS_STEP = 0.06;

const CREATURES_PER_MATCH = 16;
const TEAMS_PER_MATCH = 4;
const CREATURES_PER_TEAM = 4;

/** Get hex color for a team (all members same color) */
function getTeamHex(teamIdx: number): number {
  const hue = TEAM_HUES[teamIdx % TEAM_HUES.length];
  return new THREE.Color().setHSL(hue / 360, TEAM_SATURATION, TEAM_BASE_LIGHTNESS).getHex();
}

/** Get CSS color string for a team member */
function getTeamCss(teamIdx: number, memberIdx: number): string {
  const hue = TEAM_HUES[teamIdx % TEAM_HUES.length];
  const lightness = TEAM_BASE_LIGHTNESS + (memberIdx - 1.5) * TEAM_MEMBER_LIGHTNESS_STEP;
  const c = new THREE.Color().setHSL(hue / 360, TEAM_SATURATION, lightness);
  return `#${c.getHex().toString(16).padStart(6, '0')}`;
}

/** Get team's base CSS color */
function getTeamBaseCss(teamIdx: number): string {
  const hue = TEAM_HUES[teamIdx % TEAM_HUES.length];
  const c = new THREE.Color().setHSL(hue / 360, TEAM_SATURATION, TEAM_BASE_LIGHTNESS);
  return `#${c.getHex().toString(16).padStart(6, '0')}`;
}

const TEAM_NAMES = ['RED', 'GREEN', 'BLUE', 'ORANGE'];

const BODY_Y = 1.5;
const MAX_HP_ESTIMATE = 40;
/** Health fraction below which the HUD bar glows red */
const CRITICAL_HEALTH_THRESHOLD = 0.1;

const KILL_FEED_DURATION_MS = 6000;
const KILL_FEED_FADE_RATIO = 0.6;
const KILL_FEED_MAX_VISIBLE = 6;

const MATCH_FINISH_DELAY_MS = 3000;

/** Hill circle rendering */
const HILL_RING_HALF_WIDTH = 0.3;
const HILL_RING_SEGMENTS = 64;
const HILL_RING_Y = 0.03;
const HILL_COLOR = 0xffaa22;
const HILL_FILL_OPACITY = 0.04;
const HILL_RING_OPACITY_MIN = 0.3;
const HILL_RING_OPACITY_MAX = 0.7;
const HILL_RING_PULSE_SPEED = 0.002;

/** Match HUD */
const TICKS_PER_SECOND = 10;
const TIMER_URGENT_THRESHOLD_SECONDS = 10;

/** Dust particle system */
const DUST_PARTICLE_COUNT = 300;
const DUST_SPREAD = ARENA_RADIUS * 1.2;
const DUST_HEIGHT = 20;
const DUST_DRIFT_SPEED = 0.15;

/** Arena boundary glow ring */
const RING_INNER_OFFSET = 0.5;
const RING_OUTER_OFFSET = 1.5;
const RING_GLOW_COLOR = 0x334466;

/** Fog distances */
const FOG_NEAR = 120;
const FOG_FAR = 180;

/** Part detachment physics */
const DETACH_DURATION_MS = 2000;
const DETACH_UPWARD_SPEED = 3;
const DETACH_OUTWARD_SPEED = 2;
const DETACH_GRAVITY = -8;
const DETACH_SPIN_SPEED = 5;

/** Attack line flash */
const ATTACK_LINE_DURATION_MS = 300;

// ── State ─────────────────────────────────────────────────────────

let conn: InstanceType<typeof DbConnection> | null = null;

interface CreatureVisual {
  mesh: CreatureMesh;
  serverX: number;
  serverY: number;
  serverFacing: number;
  alive: boolean;
  name: string;
  idx: number;
  teamIdx: number;
}

const creatureVisuals = new Map<number, CreatureVisual>();
let currentMatch: Match | null = null;
/** The matchId we're actively watching — all callbacks filter by this */
let activeMatchId: bigint | null = null;
let selectedDesignIds: bigint[] = [];
let allDesigns: CreatureDesign[] = [];
const killFeedMessages: { text: string; time: number; color: string }[] = [];
let autopanEnabled = true;
/** Suppresses victory overlay when user manually restarts */
let suppressFinishOverlay = false;

/** Pending creatures waiting for MatchPart data */
const pendingCreatures = new Map<number, MatchCreature>();

// ── Sound ────────────────────────────────────────────────────────
const sound = new SoundManager();

// ── Three.js setup ────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060608);
scene.fog = new THREE.Fog(0x060608, FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 60, 55);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.getElementById('app')!.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

// ── Lighting ──────────────────────────────────────────────────────

const ambient = new THREE.AmbientLight(0x303045, 0.5);
scene.add(ambient);

const directional = new THREE.DirectionalLight(0xeeeeff, 0.9);
directional.position.set(30, 50, 20);
directional.castShadow = true;
directional.shadow.mapSize.set(1024, 1024);
directional.shadow.camera.near = 1;
directional.shadow.camera.far = 120;
directional.shadow.camera.left = -60;
directional.shadow.camera.right = 60;
directional.shadow.camera.top = 60;
directional.shadow.camera.bottom = -60;
scene.add(directional);

// Rim light from behind for creature silhouette pop
const rimLight = new THREE.DirectionalLight(0x4466aa, 0.4);
rimLight.position.set(-20, 30, -40);
scene.add(rimLight);

// ── Arena floor — near-black with subtle circular grid ────────────

const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS, 64);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x0a0a10,
  roughness: 0.95,
  metalness: 0.05,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Subtle concentric circles on the floor
const FLOOR_RING_COUNT = 5;
const FLOOR_RING_THICKNESS = 0.15;
for (let i = 1; i <= FLOOR_RING_COUNT; i++) {
  const r = (i / FLOOR_RING_COUNT) * ARENA_RADIUS;
  const ringGeo = new THREE.RingGeometry(r - FLOOR_RING_THICKNESS, r + FLOOR_RING_THICKNESS, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x151520,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.5,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.01;
  scene.add(ringMesh);
}

// Arena boundary — glowing emissive ring
const boundaryGeo = new THREE.RingGeometry(
  ARENA_RADIUS - RING_INNER_OFFSET,
  ARENA_RADIUS + RING_OUTER_OFFSET,
  128,
);
const boundaryMat = new THREE.MeshBasicMaterial({
  color: RING_GLOW_COLOR,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.6,
});
const boundary = new THREE.Mesh(boundaryGeo, boundaryMat);
boundary.rotation.x = -Math.PI / 2;
boundary.position.y = 0.02;
scene.add(boundary);

// ── Dust particles ────────────────────────────────────────────────

const dustGeo = new THREE.BufferGeometry();
const dustPositions = new Float32Array(DUST_PARTICLE_COUNT * 3);
const dustVelocities = new Float32Array(DUST_PARTICLE_COUNT * 3);

for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
  dustPositions[i * 3] = (Math.random() - 0.5) * DUST_SPREAD * 2;
  dustPositions[i * 3 + 1] = Math.random() * DUST_HEIGHT;
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * DUST_SPREAD * 2;

  dustVelocities[i * 3] = (Math.random() - 0.5) * DUST_DRIFT_SPEED;
  dustVelocities[i * 3 + 1] = (Math.random() - 0.5) * DUST_DRIFT_SPEED * 0.3;
  dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * DUST_DRIFT_SPEED;
}

dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

const dustMat = new THREE.PointsMaterial({
  color: 0x888899,
  size: 0.15,
  transparent: true,
  opacity: 0.3,
  sizeAttenuation: true,
  depthWrite: false,
});
const dustSystem = new THREE.Points(dustGeo, dustMat);
scene.add(dustSystem);

function updateDust(dt: number): void {
  const positions = dustGeo.attributes.position.array as Float32Array;
  for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
    positions[i * 3] += dustVelocities[i * 3] * dt;
    positions[i * 3 + 1] += dustVelocities[i * 3 + 1] * dt;
    positions[i * 3 + 2] += dustVelocities[i * 3 + 2] * dt;

    if (Math.abs(positions[i * 3]) > DUST_SPREAD) positions[i * 3] *= -0.9;
    if (positions[i * 3 + 1] < 0 || positions[i * 3 + 1] > DUST_HEIGHT) {
      dustVelocities[i * 3 + 1] *= -1;
    }
    if (Math.abs(positions[i * 3 + 2]) > DUST_SPREAD) positions[i * 3 + 2] *= -0.9;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

function updateBoundaryGlow(now: number): void {
  const pulse = 0.4 + Math.sin(now * 0.001) * 0.15;
  boundaryMat.opacity = pulse;
}

// ── Creature mesh creation (deferred until parts arrive) ──────────

function tryBuildCreature(creatureIdx: number): void {
  const row = pendingCreatures.get(creatureIdx);
  if (!row || !conn) return;

  // Collect all MatchPart rows for this creature in the current match
  const parts: MatchPart[] = [];
  for (const p of conn.db.matchPart.iter()) {
    if (p.creatureIdx === creatureIdx && currentMatch && p.matchId === currentMatch.matchId) {
      parts.push(p);
    }
  }

  if (parts.length === 0) return; // Parts haven't arrived yet

  const teamIdx = row.teamIdx;
  const teamMemberIdx = [...creatureVisuals.values()].filter(v => v.teamIdx === teamIdx).length;
  const color = getTeamHex(teamIdx);
  const cssColor = getTeamCss(teamIdx, teamMemberIdx);

  const cmesh = buildCreatureMesh(parts, creatureIdx, color, cssColor, row.name);
  scene.add(cmesh.group);

  // Register creature's synth profile from its part composition
  sound.registerCreature(creatureIdx, parts.map((p) => p.partId));

  const visual: CreatureVisual = {
    mesh: cmesh,
    serverX: row.posX,
    serverY: row.posY,
    serverFacing: row.facing,
    alive: row.alive,
    name: row.name,
    idx: creatureIdx,
    teamIdx,
  };

  // Snap to initial position
  cmesh.group.position.set(row.posX, 0, row.posY);
  creatureVisuals.set(creatureIdx, visual);
  pendingCreatures.delete(creatureIdx);
  setHealthPanelName(creatureIdx, row.name);
  updateAliveDot(creatureIdx, row.alive);
}

function updateCreaturePosition(visual: CreatureVisual, dt: number): void {
  const { mesh } = visual;
  const targetX = visual.serverX;
  const targetZ = visual.serverY; // server Y → Three.js Z

  mesh.group.position.x += (targetX - mesh.group.position.x) * CLIENT_INTERP_FACTOR;
  mesh.group.position.z += (targetZ - mesh.group.position.z) * CLIENT_INTERP_FACTOR;

  // Rotate toward facing
  const targetRotation = -visual.serverFacing + Math.PI / 2;
  mesh.group.rotation.y += (targetRotation - mesh.group.rotation.y) * CLIENT_INTERP_FACTOR;

  // Health bar always faces camera
  // Death visual: sink and fade
  if (!visual.alive) {
    mesh.group.position.y = Math.max(-1, mesh.group.position.y - dt * 0.5);
    const mat = mesh.body.material as THREE.MeshStandardMaterial;
    mat.opacity = Math.max(0.15, mat.opacity - dt * 0.3);
    mat.transparent = true;
  }

  // Subtle idle bob
  if (visual.alive) {
    mesh.body.position.y = BODY_Y + Math.sin(performance.now() * 0.003 + visual.idx) * 0.08;
  }
}

// ── Part detachment animation ─────────────────────────────────────

interface DetachedPart {
  obj: THREE.Object3D;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  created: number;
}

const detachedParts: DetachedPart[] = [];

function detachPart(visual: CreatureVisual, instanceId: string): void {
  const partObj = visual.mesh.partMeshes.get(instanceId);
  if (!partObj) return;

  // Get world position before detaching
  const worldPos = new THREE.Vector3();
  partObj.getWorldPosition(worldPos);

  // Clone for flying debris
  const clone = partObj.clone();
  clone.position.copy(worldPos);
  scene.add(clone);

  // Remove from creature
  partObj.removeFromParent();
  visual.mesh.partMeshes.delete(instanceId);

  // Random outward velocity
  const outward = new THREE.Vector3(
    (Math.random() - 0.5) * DETACH_OUTWARD_SPEED,
    DETACH_UPWARD_SPEED + Math.random() * 2,
    (Math.random() - 0.5) * DETACH_OUTWARD_SPEED,
  );

  detachedParts.push({
    obj: clone,
    velocity: outward,
    angularVelocity: new THREE.Vector3(
      (Math.random() - 0.5) * DETACH_SPIN_SPEED,
      (Math.random() - 0.5) * DETACH_SPIN_SPEED,
      (Math.random() - 0.5) * DETACH_SPIN_SPEED,
    ),
    created: performance.now(),
  });
}

function updateDetachedParts(dt: number): void {
  const now = performance.now();
  for (let i = detachedParts.length - 1; i >= 0; i--) {
    const dp = detachedParts[i];
    const age = now - dp.created;

    if (age > DETACH_DURATION_MS) {
      scene.remove(dp.obj);
      detachedParts.splice(i, 1);
      continue;
    }

    // Gravity
    dp.velocity.y += DETACH_GRAVITY * dt;
    dp.obj.position.add(dp.velocity.clone().multiplyScalar(dt));

    // Spin
    dp.obj.rotation.x += dp.angularVelocity.x * dt;
    dp.obj.rotation.y += dp.angularVelocity.y * dt;
    dp.obj.rotation.z += dp.angularVelocity.z * dt;

    // Fade
    const fadeProgress = age / DETACH_DURATION_MS;
    dp.obj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.transparent = true;
        child.material.opacity = 1 - fadeProgress;
      }
    });
  }
}

// ── Hill circle (king-of-the-hill zone) ───────────────────────────

let hillRingMesh: THREE.Mesh | null = null;
let hillFillMesh: THREE.Mesh | null = null;

function createHillCircle(radius: number): void {
  removeHillCircle();

  // Glowing pulsing ring
  const ringGeo = new THREE.RingGeometry(
    radius - HILL_RING_HALF_WIDTH,
    radius + HILL_RING_HALF_WIDTH,
    HILL_RING_SEGMENTS,
  );
  const ringMat = new THREE.MeshBasicMaterial({
    color: HILL_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: HILL_RING_OPACITY_MIN,
  });
  hillRingMesh = new THREE.Mesh(ringGeo, ringMat);
  hillRingMesh.rotation.x = -Math.PI / 2;
  hillRingMesh.position.y = HILL_RING_Y;
  scene.add(hillRingMesh);

  // Subtle filled circle
  const fillGeo = new THREE.CircleGeometry(radius, HILL_RING_SEGMENTS);
  const fillMat = new THREE.MeshBasicMaterial({
    color: HILL_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: HILL_FILL_OPACITY,
  });
  hillFillMesh = new THREE.Mesh(fillGeo, fillMat);
  hillFillMesh.rotation.x = -Math.PI / 2;
  hillFillMesh.position.y = HILL_RING_Y;
  scene.add(hillFillMesh);
}

function updateHillCircle(now: number): void {
  if (!hillRingMesh) return;
  const pulse = HILL_RING_OPACITY_MIN
    + (HILL_RING_OPACITY_MAX - HILL_RING_OPACITY_MIN)
    * (0.5 + 0.5 * Math.sin(now * HILL_RING_PULSE_SPEED));
  (hillRingMesh.material as THREE.MeshBasicMaterial).opacity = pulse;
}

function removeHillCircle(): void {
  if (hillRingMesh) {
    scene.remove(hillRingMesh);
    hillRingMesh.geometry.dispose();
    (hillRingMesh.material as THREE.Material).dispose();
    hillRingMesh = null;
  }
  if (hillFillMesh) {
    scene.remove(hillFillMesh);
    hillFillMesh.geometry.dispose();
    (hillFillMesh.material as THREE.Material).dispose();
    hillFillMesh = null;
  }
}

// ── Attack line flash effect ──────────────────────────────────────

interface AttackLine {
  line: THREE.Line;
  created: number;
  duration: number;
}

const attackLines: AttackLine[] = [];

function showAttackLine(fromIdx: number, toIdx: number): void {
  const from = creatureVisuals.get(fromIdx);
  const to = creatureVisuals.get(toIdx);
  if (!from || !to) return;

  const points = [
    new THREE.Vector3(from.mesh.group.position.x, BODY_Y, from.mesh.group.position.z),
    new THREE.Vector3(to.mesh.group.position.x, BODY_Y, to.mesh.group.position.z),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const fromVisual = creatureVisuals.get(fromIdx);
  const attackColor = fromVisual ? getTeamHex(fromVisual.teamIdx) : 0xffffff;
  const mat = new THREE.LineBasicMaterial({
    color: attackColor,
    transparent: true,
    opacity: 1.0,
  });
  const line = new THREE.Line(geo, mat);
  scene.add(line);

  attackLines.push({ line, created: performance.now(), duration: ATTACK_LINE_DURATION_MS });
}

function updateAttackLines(): void {
  const now = performance.now();
  for (let i = attackLines.length - 1; i >= 0; i--) {
    const al = attackLines[i];
    const age = now - al.created;
    if (age > al.duration) {
      scene.remove(al.line);
      al.line.geometry.dispose();
      (al.line.material as THREE.Material).dispose();
      attackLines.splice(i, 1);
    } else {
      (al.line.material as THREE.LineBasicMaterial).opacity = 1 - age / al.duration;
    }
  }
}

// ── Alive dots HUD ────────────────────────────────────────────────

const aliveDotsEl = document.getElementById('alive-dots')!;
const killFeedEl = document.getElementById('kill-feed')!;
const matchOverlay = document.getElementById('match-overlay')!;
const overlayText = document.getElementById('overlay-text')!;
const roundLabelEl = document.getElementById('round-label')!;
const timerLabelEl = document.getElementById('timer-label')!;

function initHealthPanel(): void {
  aliveDotsEl.innerHTML = '';
  for (let t = 0; t < TEAMS_PER_MATCH; t++) {
    const teamGroup = document.createElement('div');
    teamGroup.className = 'team-group';
    for (let m = 0; m < CREATURES_PER_TEAM; m++) {
      const idx = t * CREATURES_PER_TEAM + m;
      const row = document.createElement('div');
      row.className = 'hp-row';
      row.dataset.idx = String(idx);

      const name = document.createElement('span');
      name.className = 'hp-name';
      name.textContent = '???';

      const track = document.createElement('div');
      track.className = 'hp-track';
      const fill = document.createElement('div');
      fill.className = 'hp-fill';
      fill.style.background = getTeamCss(t, m);
      fill.style.width = '100%';
      track.appendChild(fill);

      row.appendChild(name);
      row.appendChild(track);
      teamGroup.appendChild(row);
    }
    aliveDotsEl.appendChild(teamGroup);
  }
}

function setHealthPanelName(idx: number, name: string): void {
  const row = aliveDotsEl.querySelector(`.hp-row[data-idx="${idx}"]`);
  if (row) {
    const nameEl = row.querySelector('.hp-name') as HTMLElement;
    if (nameEl) nameEl.textContent = name;
  }
}

function updateHealthBar(idx: number, frac: number): void {
  const row = aliveDotsEl.querySelector(`.hp-row[data-idx="${idx}"]`);
  if (!row) return;
  const fill = row.querySelector('.hp-fill') as HTMLElement;
  if (fill) {
    fill.style.width = `${Math.max(0, frac * 100)}%`;
    row.classList.toggle('critical', frac > 0 && frac < CRITICAL_HEALTH_THRESHOLD);
  }
}

function updateAliveDot(idx: number, alive: boolean): void {
  const row = aliveDotsEl.querySelector(`.hp-row[data-idx="${idx}"]`);
  if (row) {
    row.classList.toggle('dead', !alive);
  }
}

function updateKillFeed(): void {
  const now = performance.now();
  let feedHtml = '';
  for (let i = killFeedMessages.length - 1; i >= Math.max(0, killFeedMessages.length - KILL_FEED_MAX_VISIBLE); i--) {
    const msg = killFeedMessages[i];
    const age = now - msg.time;
    if (age > KILL_FEED_DURATION_MS) continue;
    const cls = age > KILL_FEED_DURATION_MS * KILL_FEED_FADE_RATIO ? 'kill-msg fade' : 'kill-msg';
    feedHtml += `<div class="${cls}" style="color:${msg.color}">${msg.text}</div>`;
  }
  killFeedEl.innerHTML = feedHtml;
}

// ── Match info HUD (timer + round) ────────────────────────────────

function updateMatchInfo(): void {
  if (!currentMatch || currentMatch.state !== 'running') return;
  const ticksRemaining = Math.max(0, currentMatch.maxTicks - currentMatch.currentTick);
  const secondsRemaining = Math.ceil(ticksRemaining / TICKS_PER_SECOND);
  timerLabelEl.textContent = `${secondsRemaining}s`;
  timerLabelEl.classList.toggle('urgent', secondsRemaining <= TIMER_URGENT_THRESHOLD_SECONDS);
}

function updateRoundLabel(): void {
  if (!conn) return;
  let roundNumber = 1;
  for (const row of conn.db.arenaState.iter()) {
    roundNumber = row.roundNumber;
    break;
  }
  roundLabelEl.textContent = `ROUND ${roundNumber}`;
}

// ── Match overlay (intro / winner) ────────────────────────────────

let overlayTimeout: ReturnType<typeof setTimeout> | null = null;

function showOverlay(text: string, color: string, durationMs: number): void {
  if (overlayTimeout) clearTimeout(overlayTimeout);
  overlayText.textContent = text;
  overlayText.style.color = color;
  matchOverlay.classList.add('visible');
  overlayTimeout = setTimeout(() => {
    matchOverlay.classList.remove('visible');
    overlayTimeout = null;
  }, durationMs);
}

// ── Setup panel ───────────────────────────────────────────────────

const setupPanel = document.getElementById('setup-panel')!;
const connStatus = document.getElementById('conn-status')!;
const designListEl = document.getElementById('design-list')!;
const startBtn = document.getElementById('start-btn')! as HTMLButtonElement;

function clearArena(): void {
  for (const visual of creatureVisuals.values()) {
    scene.remove(visual.mesh.group);
  }
  creatureVisuals.clear();
  pendingCreatures.clear();
  for (const al of attackLines) {
    scene.remove(al.line);
    al.line.geometry.dispose();
    (al.line.material as THREE.Material).dispose();
  }
  attackLines.length = 0;
  for (const dp of detachedParts) {
    scene.remove(dp.obj);
  }
  detachedParts.length = 0;
  killFeedMessages.length = 0;
  removeHillCircle();
  sound.resetState();
}

function showSetupPanel(): void {
  setupPanel.style.display = 'block';
  refreshDesignList();
}

function hideSetupPanel(): void {
  setupPanel.style.display = 'none';
}

function refreshDesignList(): void {
  if (!conn) return;

  allDesigns = [...conn.db.creatureDesign.iter()];
  selectedDesignIds = [];

  let html = '';
  for (const d of allDesigns) {
    html += `<div class="design-item" data-id="${d.designId}">
      <div class="idx">D${d.designId}</div>
      <div>${d.name}</div>
    </div>`;
  }

  if (allDesigns.length === 0) {
    html = '<div style="color:#444;padding:8px;">No creature designs found. Submit designs via the agent first.</div>';
  }

  designListEl.innerHTML = html;
  updateStartButton();

  for (const item of designListEl.querySelectorAll('.design-item')) {
    item.addEventListener('click', () => {
      const id = BigInt(item.getAttribute('data-id')!);
      const idx = selectedDesignIds.indexOf(id);
      if (idx >= 0) {
        selectedDesignIds.splice(idx, 1);
        item.classList.remove('selected');
      } else if (selectedDesignIds.length < CREATURES_PER_MATCH) {
        selectedDesignIds.push(id);
        item.classList.add('selected');
      }
      updateStartButton();
    });
  }
}

function updateStartButton(): void {
  if (selectedDesignIds.length === CREATURES_PER_MATCH) {
    startBtn.disabled = false;
    startBtn.textContent = 'START MATCH';
  } else {
    const remaining = CREATURES_PER_MATCH - selectedDesignIds.length;
    startBtn.disabled = true;
    startBtn.textContent = `SELECT ${remaining} MORE CREATURE${remaining === 1 ? '' : 'S'}`;
  }
}

startBtn.addEventListener('click', () => {
  if (!conn || selectedDesignIds.length !== CREATURES_PER_MATCH) return;
  launchMatch(selectedDesignIds);
});

function launchMatch(ids: bigint[]): void {
  if (!conn || ids.length !== CREATURES_PER_MATCH) return;
  // Assign teams round-robin: first CREATURES_PER_TEAM = team 0, etc.
  const entries = ids.map((id, i) => ({
    designId: Number(id),
    teamIdx: Math.floor(i / CREATURES_PER_TEAM),
  }));
  conn.reducers.startMatch({ entriesJson: JSON.stringify(entries) });
  hideSetupPanel();
}

/** Check if a match is already running in the DB */
function hasRunningMatch(): boolean {
  if (!conn) return false;
  for (const m of conn.db.match.iter()) {
    if (m.state === 'running') return true;
  }
  return false;
}

/** Auto-start: pick first 16 designs and go (skips if match already running) */
function autoStart(force = false): void {
  if (!conn) return;
  if (!force && hasRunningMatch()) return;
  const designs = [...conn.db.creatureDesign.iter()];
  if (designs.length < CREATURES_PER_MATCH) return;
  const ids = designs.slice(0, CREATURES_PER_MATCH).map(d => d.designId);
  launchMatch(ids);
}

// ── Control panel ─────────────────────────────────────────────────

const btnAutopan = document.getElementById('btn-autopan')!;
const btnRestart = document.getElementById('btn-restart')!;

btnAutopan.addEventListener('click', () => {
  autopanEnabled = !autopanEnabled;
  btnAutopan.classList.toggle('active', autopanEnabled);
  if (autopanEnabled) {
    startDirector();
    controls.enabled = false;
  } else {
    stopDirector();
    controls.enabled = true;
  }
});

btnRestart.addEventListener('click', () => {
  suppressFinishOverlay = true;
  autoStart(true);
});

// ── SpacetimeDB connection ────────────────────────────────────────

function connectToSTDB(token?: string): void {
  conn = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DATABASE)
    .withToken(token)
    .onConnect((connection, _identity, newToken) => {
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
      connStatus.textContent = 'Connected';
      connStatus.style.color = '#666';

      connection.subscriptionBuilder()
        .onApplied(() => {
          console.log('[stdb] Subscriptions active');
          updateRoundLabel();
          autoStart();
        })
        .onError((_ctx: unknown, err: unknown) => {
          console.error('[stdb] Subscription error:', err);
        })
        .subscribe([
          'SELECT * FROM creature_design',
          'SELECT * FROM match',
          'SELECT * FROM match_creature',
          'SELECT * FROM match_part',
          'SELECT * FROM match_event',
          'SELECT * FROM arena_state',
        ]);
    })
    .onConnectError((_ctx: unknown, err: unknown) => {
      console.error('[stdb] Connection error:', err);
      connStatus.textContent = `Connection error — retrying...`;
      connStatus.style.color = '#f44';
      // Always clear stale token and retry fresh — handles server republish with --clear-database
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
    })
    .onDisconnect(() => {
      console.log('[stdb] Disconnected');
      connStatus.textContent = 'Disconnected — reconnecting...';
      connStatus.style.color = '#ff0';
      // Reconnect fresh — don't reuse potentially stale token
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
    })
    .build();

  // ── Table callbacks ─────────────────────────────────────────────
  // CRITICAL: Every callback filters by activeMatchId to prevent
  // cross-match data pollution (old creatures, stale updates, etc.)

  // Match state changes — only track the most recent running match
  conn.db.match.onInsert((_ctx: unknown, row: Match) => {
    currentMatch = row;
    if (row.state === 'running') {
      activeMatchId = row.matchId;
      clearArena();
      initHealthPanel();
      hideSetupPanel();
      updateRoundLabel();
      if (row.hillRadius > 0) {
        createHillCircle(row.hillRadius);
      }
      if (autopanEnabled) {
        startDirector();
        controls.enabled = false;
      }
      sound.resetState();
    }
    // Ignore finished matches from subscription backfill
  });
  conn.db.match.onUpdate((_ctx: unknown, _old: Match, row: Match) => {
    if (row.matchId !== activeMatchId) return;
    currentMatch = row;
    if (row.state === 'finished') {
      removeHillCircle();
      if (suppressFinishOverlay) {
        // Manual restart — skip overlay, clean up immediately
        suppressFinishOverlay = false;
        stopDirector();
        sound.releaseAll();
        activeMatchId = null;
      } else {
        // Find the actual winner from server placement data (placement 1 = winner)
        const mvp = [...conn!.db.matchCreature.iter()]
          .filter(c => c.matchId === row.matchId && c.placement === 1)[0];
        const winTeam = mvp?.teamIdx ?? [...creatureVisuals.values()].find(v => v.alive)?.teamIdx;
        if (winTeam !== undefined) {
          const teamName = TEAM_NAMES[winTeam] ?? `TEAM ${winTeam}`;
          const color = getTeamBaseCss(winTeam);
          const conditionSuffix = row.winCondition === 'hill_control'
            ? ' (HILL CONTROL)'
            : row.winCondition === 'tiebreaker'
              ? ' (TIEBREAKER)'
              : '';
          showOverlay(`${teamName} TEAM WINS${conditionSuffix}`, color, MATCH_FINISH_DELAY_MS);
        }
        setTimeout(() => {
          stopDirector();
          sound.releaseAll();
          controls.enabled = !autopanEnabled;
          activeMatchId = null;
          autoStart();
        }, MATCH_FINISH_DELAY_MS);
      }
    }
  });

  // Creature appears — defer mesh creation until parts arrive
  conn.db.matchCreature.onInsert((_ctx: unknown, row: MatchCreature) => {
    if (row.matchId !== activeMatchId) return;
    pendingCreatures.set(row.creatureIdx, row);
    tryBuildCreature(row.creatureIdx);
  });

  conn.db.matchCreature.onUpdate((_ctx: unknown, _old: MatchCreature, row: MatchCreature) => {
    if (row.matchId !== activeMatchId) return;

    if (pendingCreatures.has(row.creatureIdx)) {
      pendingCreatures.set(row.creatureIdx, row);
      return;
    }

    const visual = creatureVisuals.get(row.creatureIdx);
    if (!visual) return;

    visual.serverX = row.posX;
    visual.serverY = row.posY;
    visual.serverFacing = row.facing;

    // Footstep sounds based on movement
    sound.onCreatureMove(row.creatureIdx, row.posX, row.posY);

    const healthFrac = Math.max(0, 1 - row.damageTaken / MAX_HP_ESTIMATE);
    updateHealthBar(row.creatureIdx, healthFrac);

    if (!row.alive && visual.alive) {
      visual.alive = false;
      updateAliveDot(row.creatureIdx, false);
      addKillFeedMessage(`${row.name} died: ${row.deathCause}`, row.creatureIdx);
      triggerDeathExplosion(visual.mesh.group, visual.mesh.partMeshes);
      triggerDeathFlash(scene, visual.mesh.group.position, getTeamHex(visual.teamIdx));
      triggerShake(SHAKE_LARGE);
      directorEvent('kill', row.creatureIdx);
      sound.onCreatureDeath(row.creatureIdx);
    }
  });

  conn.db.matchCreature.onDelete((_ctx: unknown, row: MatchCreature) => {
    if (row.matchId !== activeMatchId) return;
    const visual = creatureVisuals.get(row.creatureIdx);
    if (visual) {
      scene.remove(visual.mesh.group);
      creatureVisuals.delete(row.creatureIdx);
    }
    pendingCreatures.delete(row.creatureIdx);
  });

  // MatchPart — triggers deferred creature builds + part detachment
  conn.db.matchPart.onInsert((_ctx: unknown, row: MatchPart) => {
    if (row.matchId !== activeMatchId) return;
    if (pendingCreatures.has(row.creatureIdx)) {
      tryBuildCreature(row.creatureIdx);
    }
  });

  conn.db.matchPart.onUpdate((_ctx: unknown, old: MatchPart, row: MatchPart) => {
    if (row.matchId !== activeMatchId) return;
    if (old.attached && !row.attached) {
      const visual = creatureVisuals.get(row.creatureIdx);
      if (visual) {
        detachPart(visual, row.instanceId);
      }
    }
  });

  // Combat events
  conn.db.matchEvent.onInsert((_ctx: unknown, row: MatchEvent) => {
    if (row.matchId !== activeMatchId) return;

    if (row.eventType === 'attack_swing') {
      try {
        const data = JSON.parse(row.data);
        const attacker = creatureVisuals.get(row.creatureIdx);
        const target = creatureVisuals.get(data.targetIdx);
        if (attacker && target) {
          triggerLunge(attacker.mesh.group, target.mesh.group.position);
        }
        sound.onAttackSwing(row.creatureIdx);
      } catch { /* ignore */ }
    } else if (row.eventType === 'contact_hit') {
      try {
        const data = JSON.parse(row.data);
        const attackerIdx = data.attackerIdx ?? row.creatureIdx;
        showAttackLine(attackerIdx, row.creatureIdx);

        const victim = creatureVisuals.get(row.creatureIdx);
        if (victim) {
          triggerFlash(victim.mesh.body);
        }

        const HIGH_DAMAGE_THRESHOLD = 5;
        if (data.damage > HIGH_DAMAGE_THRESHOLD) {
          directorEvent('hit', row.creatureIdx, { damage: data.damage });
        }
        // Sound from the attacker's perspective (their body hits)
        sound.onContactHit(attackerIdx);
      } catch { /* ignore */ }
    } else if (row.eventType === 'part_lost') {
      try {
        const data = JSON.parse(row.data);
        addKillFeedMessage(
          `${getCreatureName(row.creatureIdx)} lost ${data.partId ?? 'a part'}`,
          row.creatureIdx,
        );
        directorEvent('part_lost', row.creatureIdx);
        sound.onPartLost(row.creatureIdx);
      } catch { /* ignore */ }
    }
  });
}

function getCreatureName(idx: number): string {
  return creatureVisuals.get(idx)?.name ?? `Creature ${idx}`;
}

function addKillFeedMessage(text: string, creatureIdx: number): void {
  const visual = creatureVisuals.get(creatureIdx);
  const color = visual ? getTeamBaseCss(visual.teamIdx) : '#aaa';
  killFeedMessages.push({
    text,
    time: performance.now(),
    color,
  });
}

// ── Render loop ───────────────────────────────────────────────────

const clock = new THREE.Clock();

function animate(): void {
  const dt = Math.min(clock.getDelta(), MAX_DELTA);
  const now = performance.now();

  // Update creature positions (lerp)
  for (const visual of creatureVisuals.values()) {
    updateCreaturePosition(visual, dt);
  }

  // Update effects
  updateAttackLines();
  updateDetachedParts(dt);
  updateLunges();
  updateFlashes();
  updateDeathDebris(dt);
  updateDeathFlashes();
  updateDust(dt);
  updateBoundaryGlow(now);
  updateHillCircle(now);

  // HUD
  updateKillFeed();
  updateMatchInfo();

  // Auto-director camera
  if (isDirectorActive()) {
    const creatures: CreatureInfo[] = [...creatureVisuals.values()].map(v => ({
      idx: v.idx,
      alive: v.alive,
      position: v.mesh.group.position.clone(),
    }));
    updateDirector(dt, camera, creatures);
  }

  // Apply camera shake offset
  const shakeOffset = getShakeOffset();
  camera.position.add(shakeOffset);

  // Render — only update OrbitControls when it's driving (not during autopan)
  if (controls.enabled) controls.update();
  renderer.renderAsync(scene, camera);

  // Remove shake offset so it doesn't accumulate
  camera.position.sub(shakeOffset);

  requestAnimationFrame(animate);
}

// ── Window resize ─────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Boot ──────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  await renderer.init();

  // Sound init: explicit button click
  const btnSound = document.getElementById('btn-sound')!;
  btnSound.addEventListener('click', () => sound.init());

  showSetupPanel();
  connectToSTDB(localStorage.getItem(AUTH_TOKEN_KEY) || undefined);
  requestAnimationFrame(animate);
}

boot();
