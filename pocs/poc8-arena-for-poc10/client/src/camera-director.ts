/**
 * camera-director.ts
 *
 * Auto-director camera system inspired by:
 * - Valve's HLTV Director: minimum shot durations, event priority, timing windows
 * - BeamNG: spring-damper camera feel instead of raw lerp
 * - iRacing: distance-based camera activation, group tracking
 *
 * Key principles:
 * - No cut faster than MIN_SHOT_DURATION (3s) — prevents seizure cuts
 * - Spring-damper for position/lookAt — natural acceleration/deceleration
 * - Event cuts are hard (fast spring), idle tracking is soft (slow spring)
 * - Director is a state machine driven by events, not a per-frame optimizer
 */

import * as THREE from 'three/webgpu';

// ── Timing guardrails (from Valve HLTV Director) ─────────────────

/** Minimum seconds a shot holds before any cut is allowed */
const MIN_SHOT_DURATION_S = 3.0;
/** Maximum seconds before the director forces a mode change */
const MAX_SHOT_DURATION_S = 10.0;
/** How long event-driven close-ups hold (part loss) */
const EVENT_CLOSEUP_HOLD_S = 2.5;
/** How long kill close-ups hold */
const KILL_CLOSEUP_HOLD_S = 3.5;

// ── Spring-damper constants ──────────────────────────────────────
// Semi-implicit Euler with exponential damping (frame-rate independent).
// velocity += force * dt; position += velocity * dt; velocity *= dampFactor^dt

/** Tracking mode: slow, cinematic follow */
const SPRING_TRACKING = 3.0;
/** Exponential damping per second for tracking (0 = no damping, higher = more drag) */
const DAMPING_TRACKING = 6.0;

/** Event cut: faster snap to new angle, still smooth */
const SPRING_CUT = 8.0;
const DAMPING_CUT = 8.0;

/** LookAt spring (always slightly tighter than position to avoid drift) */
const SPRING_LOOKAT = 5.0;
const DAMPING_LOOKAT = 7.0;

/** Spring decay: after a cut, gradually return to tracking spring over this many seconds */
const SPRING_DECAY_DURATION_S = 2.0;

// ── Camera mode geometry ─────────────────────────────────────────

const OVERHEAD_HEIGHT = 75;

const TRACKING_MIN_DISTANCE = 20;
const TRACKING_DISTANCE_SCALE = 2.5;
const TRACKING_ELEVATION_DEG = 45;
const TRACKING_ORBIT_SPEED_RAD = 0.08; // rad/sec — slow, cinematic

const CLOSEUP_DISTANCE = 10;
const CLOSEUP_HEIGHT = 4;

/** When <= this many alive, tighten tracking distance */
const FEW_ALIVE_THRESHOLD = 6;
const TIGHT_TRACKING_SCALE = 1.8;

// ── Types ─────────────────────────────────────────────────────────

export type CameraMode = 'overhead' | 'tracking' | 'closeup';

export interface CreatureInfo {
  idx: number;
  alive: boolean;
  position: THREE.Vector3;
}

// ── Spring-damper helper ─────────────────────────────────────────

class SpringVector3 {
  current = new THREE.Vector3();
  velocity = new THREE.Vector3();
  target = new THREE.Vector3();

  private _force = new THREE.Vector3();

  /**
   * Semi-implicit Euler integration with exponential (frame-rate independent) damping.
   * 1. Compute spring force: F = spring * (target - current)
   * 2. Integrate velocity: v += F * dt
   * 3. Dampen velocity: v *= exp(-damping * dt)   ← frame-rate independent
   * 4. Integrate position: p += v * dt
   */
  update(dt: number, spring: number, damping: number): void {
    this._force.subVectors(this.target, this.current).multiplyScalar(spring);
    this.velocity.addScaledVector(this._force, dt);
    this.velocity.multiplyScalar(Math.exp(-damping * dt));
    this.current.addScaledVector(this.velocity, dt);
  }

  /** Hard snap (for initialization, not transitions) */
  snapTo(v: THREE.Vector3): void {
    this.current.copy(v);
    this.target.copy(v);
    this.velocity.set(0, 0, 0);
  }
}

// ── Director state ────────────────────────────────────────────────

interface DirectorState {
  active: boolean;
  mode: CameraMode;
  position: SpringVector3;
  lookAt: SpringVector3;
  orbitAngle: number;

  /** Current spring stiffness (decays from cut → tracking over time) */
  currentSpring: number;
  currentDamping: number;
  lookAtSpring: number;
  lookAtDamping: number;

  /** When the current shot started (seconds since director start) */
  shotStartTime: number;
  /** When an event cut expires (0 = no active cut) */
  cutEndTime: number;
  /** Mode to return to after cut expires */
  postCutMode: CameraMode;
  /** Which creature the close-up focuses on (-1 = none) */
  focusCreatureIdx: number;

  /** Monotonic time tracking */
  directorTime: number;
}

const state: DirectorState = {
  active: false,
  mode: 'overhead',
  position: new SpringVector3(),
  lookAt: new SpringVector3(),
  orbitAngle: 0,
  currentSpring: SPRING_TRACKING,
  currentDamping: DAMPING_TRACKING,
  lookAtSpring: SPRING_LOOKAT,
  lookAtDamping: DAMPING_LOOKAT,
  shotStartTime: 0,
  cutEndTime: 0,
  postCutMode: 'tracking',
  focusCreatureIdx: -1,
  directorTime: 0,
};

// ── Public API ────────────────────────────────────────────────────

export function startDirector(): void {
  state.active = true;
  state.mode = 'overhead';
  state.orbitAngle = 0;
  state.directorTime = 0;
  state.shotStartTime = 0;
  state.cutEndTime = 0;
  state.focusCreatureIdx = -1;
  state.currentSpring = SPRING_TRACKING;
  state.currentDamping = DAMPING_TRACKING;
  state.lookAtSpring = SPRING_LOOKAT;
  state.lookAtDamping = DAMPING_LOOKAT;

  // Snap camera to initial overhead position
  state.position.snapTo(new THREE.Vector3(0, OVERHEAD_HEIGHT, 0.1));
  state.lookAt.snapTo(new THREE.Vector3(0, 0, 0));

  // Hold overhead for 3s before transitioning to tracking
  state.cutEndTime = MIN_SHOT_DURATION_S;
  state.postCutMode = 'tracking';
}

export function stopDirector(): void {
  state.active = false;
}

export function isDirectorActive(): boolean {
  return state.active;
}

/**
 * Notify the director of a combat event.
 * Events are IGNORED if the current shot hasn't met MIN_SHOT_DURATION.
 */
export function directorEvent(
  eventType: 'hit' | 'part_lost' | 'kill',
  creatureIdx: number,
  data?: { damage?: number; killerIdx?: number },
): void {
  if (!state.active) return;

  const shotAge = state.directorTime - state.shotStartTime;

  switch (eventType) {
    case 'hit':
      // Hits don't cause cuts — just slightly tighten the spring for responsiveness
      // No minimum duration check needed since we're not cutting
      bumpSpring(SPRING_TRACKING * 1.3, DAMPING_TRACKING * 0.8);
      break;

    case 'part_lost':
      // Only cut if we've held the current shot long enough
      if (shotAge < MIN_SHOT_DURATION_S) return;

      state.mode = 'closeup';
      state.focusCreatureIdx = creatureIdx;
      state.cutEndTime = state.directorTime + EVENT_CLOSEUP_HOLD_S;
      state.postCutMode = 'tracking';
      state.shotStartTime = state.directorTime;
      bumpSpring(SPRING_CUT, DAMPING_CUT);
      break;

    case 'kill':
      // Kills override minimum duration — they're the highest priority event
      if (data?.killerIdx !== undefined) {
        state.focusCreatureIdx = data.killerIdx;
      } else {
        state.focusCreatureIdx = creatureIdx;
      }
      state.mode = 'closeup';
      state.cutEndTime = state.directorTime + KILL_CLOSEUP_HOLD_S;
      state.postCutMode = 'tracking';
      state.shotStartTime = state.directorTime;
      bumpSpring(SPRING_CUT, DAMPING_CUT);
      break;
  }
}

/**
 * Main update — call each frame.
 */
export function updateDirector(
  dt: number,
  camera: THREE.PerspectiveCamera,
  creatures: CreatureInfo[],
): void {
  if (!state.active) return;

  state.directorTime += dt;
  const alive = creatures.filter(c => c.alive);

  // ── Shot lifecycle ────────────────────────────────────────────

  // Check if event cut has expired
  if (state.cutEndTime > 0 && state.directorTime > state.cutEndTime) {
    state.cutEndTime = 0;
    state.mode = state.postCutMode;
    state.focusCreatureIdx = -1;
    state.shotStartTime = state.directorTime;
    bumpSpring(SPRING_CUT * 0.7, DAMPING_CUT); // moderate spring for transition back
  }

  // Force cut if shot exceeds max duration (prevents stale shots)
  const shotAge = state.directorTime - state.shotStartTime;
  if (shotAge > MAX_SHOT_DURATION_S && state.mode === 'tracking') {
    // Cycle orbit angle to give a fresh perspective
    state.orbitAngle += Math.PI * 0.4;
    state.shotStartTime = state.directorTime;
  }

  // ── Spring decay ──────────────────────────────────────────────

  // Gradually relax spring stiffness back to tracking values
  const springT = Math.min(1, (state.directorTime - state.shotStartTime) / SPRING_DECAY_DURATION_S);
  state.currentSpring = SPRING_CUT + (SPRING_TRACKING - SPRING_CUT) * springT;
  state.currentDamping = DAMPING_CUT + (DAMPING_TRACKING - DAMPING_CUT) * springT;
  state.lookAtSpring = SPRING_CUT + (SPRING_LOOKAT - SPRING_CUT) * springT;
  state.lookAtDamping = DAMPING_CUT + (DAMPING_LOOKAT - DAMPING_CUT) * springT;

  // ── Orbit ─────────────────────────────────────────────────────

  state.orbitAngle += TRACKING_ORBIT_SPEED_RAD * dt;

  // ── Compute target based on mode ──────────────────────────────

  switch (state.mode) {
    case 'overhead':
      computeOverhead(alive);
      break;
    case 'tracking':
      computeTracking(alive);
      break;
    case 'closeup':
      computeCloseup(creatures, alive);
      break;
  }

  // Special: last creature alive = winner orbit
  if (alive.length === 1 && state.cutEndTime === 0) {
    state.focusCreatureIdx = alive[0].idx;
    if (state.mode !== 'closeup') {
      state.mode = 'closeup';
      state.shotStartTime = state.directorTime;
    }
  }

  // ── Apply spring-damper to camera ─────────────────────────────

  state.position.update(dt, state.currentSpring, state.currentDamping);
  state.lookAt.update(dt, state.lookAtSpring, state.lookAtDamping);

  camera.position.copy(state.position.current);
  camera.lookAt(state.lookAt.current);
}

// ── Mode target computations ─────────────────────────────────────

function computeOverhead(alive: CreatureInfo[]): void {
  const centroid = computeCentroid(alive);
  state.position.target.set(centroid.x, OVERHEAD_HEIGHT, centroid.z + 0.1);
  state.lookAt.target.copy(centroid);
}

function computeTracking(alive: CreatureInfo[]): void {
  const centroid = computeCentroid(alive);
  const boundingRadius = computeBoundingRadius(alive, centroid);

  const scale = alive.length <= FEW_ALIVE_THRESHOLD ? TIGHT_TRACKING_SCALE : TRACKING_DISTANCE_SCALE;
  const distance = boundingRadius * scale + TRACKING_MIN_DISTANCE;
  const elevRad = (TRACKING_ELEVATION_DEG * Math.PI) / 180;

  state.position.target.set(
    centroid.x + Math.sin(state.orbitAngle) * distance * Math.cos(elevRad),
    centroid.y + distance * Math.sin(elevRad),
    centroid.z + Math.cos(state.orbitAngle) * distance * Math.cos(elevRad),
  );
  state.lookAt.target.copy(centroid);
}

function computeCloseup(all: CreatureInfo[], alive: CreatureInfo[]): void {
  const focus = all.find(c => c.idx === state.focusCreatureIdx);
  if (!focus) {
    // Focused creature gone — fall back to tracking
    state.mode = 'tracking';
    state.shotStartTime = state.directorTime;
    computeTracking(alive);
    return;
  }

  state.position.target.set(
    focus.position.x + Math.sin(state.orbitAngle) * CLOSEUP_DISTANCE,
    focus.position.y + CLOSEUP_HEIGHT,
    focus.position.z + Math.cos(state.orbitAngle) * CLOSEUP_DISTANCE,
  );
  state.lookAt.target.set(focus.position.x, focus.position.y + 1.5, focus.position.z);
}

// ── Helpers ───────────────────────────────────────────────────────

function computeCentroid(creatures: CreatureInfo[]): THREE.Vector3 {
  if (creatures.length === 0) return new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (const c of creatures) sum.add(c.position);
  return sum.divideScalar(creatures.length);
}

function computeBoundingRadius(creatures: CreatureInfo[], centroid: THREE.Vector3): number {
  let maxDist = 0;
  for (const c of creatures) {
    const d = c.position.distanceTo(centroid);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

/** Temporarily increase spring stiffness for a snappier response */
function bumpSpring(spring: number, damping: number): void {
  state.currentSpring = spring;
  state.currentDamping = damping;
  state.lookAtSpring = spring * 0.9;
  state.lookAtDamping = damping;
}
