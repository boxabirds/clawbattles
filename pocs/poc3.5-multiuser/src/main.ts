/**
 * POC 3.5: Multi-User Creatures with Procedural IK Locomotion
 *
 * Combines SpacetimeDB (POC 2) multiplayer with FABRIK IK (POC 3) walking.
 * Each creature is server-authoritative for position, client-animated for gait.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DbConnection } from './module_bindings';
import type { Creature as CreatureRow, Player, EventCombat } from './module_bindings/types';

// ---------------------------------------------------------------------------
// Constants -- SpacetimeDB
// ---------------------------------------------------------------------------
const STDB_URI = `ws://${window.location.hostname}:3000`;
const STDB_DATABASE = 'poc35';
const AUTH_TOKEN_KEY = 'poc35_token';
const MAX_LOG_ENTRIES = 50;
const RECONNECT_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Constants -- Coordinate mapping
// ---------------------------------------------------------------------------
/** SpacetimeDB world boundary size (0 to WORLD_BOUND) */
const DB_WORLD_SIZE = 500;

/** Three.js ground plane size centered at origin */
const GROUND_SIZE = 100;

/** Scale factor: DB units to Three.js units */
const WORLD_SCALE = GROUND_SIZE / DB_WORLD_SIZE;

/** Offset to center the world at origin */
const WORLD_OFFSET = GROUND_SIZE / 2;

// ---------------------------------------------------------------------------
// Constants -- Locomotion (from POC 3)
// ---------------------------------------------------------------------------
const STEP_THRESHOLD = 0.6;
const STEP_HEIGHT = 0.3;
const STEP_DURATION = 0.15;
const IK_ITERATIONS = 5;
const LEG_UPPER_LENGTH = 0.4;
const LEG_LOWER_LENGTH = 0.35;
const LEG_SEGMENT_COUNT = 3;
const BONE_COUNT_PER_LEG = 2;
const BODY_RADIUS = 0.3;
const BODY_HEIGHT = 0.5;
const BOB_AMPLITUDE = 0.05;
const TILT_FACTOR = 0.15;

/** Speed used for client-side interpolation toward server position */
/** Lerp factor per frame for smoothing toward server position (0-1, higher = snappier) */
const CLIENT_INTERP_FACTOR = 0.25;

// ---------------------------------------------------------------------------
// Constants -- Rendering
// ---------------------------------------------------------------------------
const GROUND_DIVISIONS = 40;
const GROUND_COLOR = 0x2a2a4a;
const GROUND_GRID_COLOR = 0x3a3a5a;
const GROUND_Y = 0;
const GROUND_SHININESS = 10;
const BACKGROUND_COLOR = 0x1a1a2e;
const FOG_NEAR = 60;
const FOG_FAR = 120;

const LEG_CYLINDER_RADIUS = 0.025;
const LEG_CYLINDER_SEGMENTS = 6;
const JOINT_SPHERE_RADIUS = 0.04;
const JOINT_SPHERE_SEGMENTS = 8;
const FOOT_PLANT_RADIUS = 0.06;
const FOOT_PLANT_INNER_RATIO = 0.4;
const FOOT_PLANT_SEGMENTS = 16;
const FOOT_PLANT_Y_OFFSET = 0.005;
const Z_FIGHT_OFFSET = 0.001;
const GRID_OPACITY = 0.15;

const BODY_SPHERE_SEGMENTS_W = 16;
const BODY_SPHERE_SEGMENTS_H = 12;
const LEG_COLOR_DARKEN_FACTOR = 0.7;

const BODY_SATURATION = 0.65;
const BODY_LIGHTNESS = 0.55;
const LEG_SATURATION = 0.55;
const JOINT_SATURATION = 0.5;
const JOINT_LIGHTNESS = 0.45;

// ---------------------------------------------------------------------------
// Constants -- Camera & Lighting
// ---------------------------------------------------------------------------
const CAMERA_FOV = 45;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;
const CAMERA_START_X = 15;
const CAMERA_START_Y = 12;
const CAMERA_START_Z = 15;
const CAMERA_MAX_POLAR = Math.PI / 2.2;
const ORBIT_DAMPING = 0.1;

const AMBIENT_LIGHT_COLOR = 0x8888cc;
const AMBIENT_LIGHT_INTENSITY = 0.6;
const DIR_LIGHT_COLOR = 0xffffff;
const DIR_LIGHT_INTENSITY = 1.2;
const DIR_LIGHT_X = 30;
const DIR_LIGHT_Y = 50;
const DIR_LIGHT_Z = 20;

// ---------------------------------------------------------------------------
// Constants -- FPS
// ---------------------------------------------------------------------------
const FPS_SAMPLE_MS = 250;
const FPS_GOOD_THRESHOLD = 50;
const FPS_OK_THRESHOLD = 30;
const FPS_COLOR_GOOD = '#4ade80';
const FPS_COLOR_OK = '#facc15';
const FPS_COLOR_BAD = '#f87171';

// ---------------------------------------------------------------------------
// Constants -- Status colors
// ---------------------------------------------------------------------------
const STATUS_CONNECTED_COLOR = '#4ade80';
const STATUS_ERROR_COLOR = '#f87171';

// ---------------------------------------------------------------------------
// Constants -- Gait stepping (from POC 3)
// ---------------------------------------------------------------------------
const STEP_PREDICT_FACTOR = 0.5;
const BODY_SETTLE_LERP = 0.1;
const PARABOLIC_PEAK_FACTOR = 4;
const HIP_OUTWARD_FACTOR = 0.3;
const HIP_INIT_OUTWARD_FACTOR = 0.5;
const KNEE_HEIGHT_FACTOR = 0.3;
const KNEE_MIDPOINT_DROP_FACTOR = 0.5;
const FORWARD_TURN_LERP = 0.15;
const MAX_DELTA_TIME = 0.05;
const TILT_SPEED_SCALE = 0.1;
const BOB_PHASE_SPEED = 0.01;
const WANDER_ARRIVAL_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Constants -- Leg configuration geometry (from POC 3)
// ---------------------------------------------------------------------------
const BIPED_LATERAL_OFFSET_FACTOR = 0.6;
const LEG_LATERAL_OFFSET_FACTOR = 0.9;
const LEG_FRONT_BACK_EXTENT = 0.8;
const LEG_FRONT_BACK_RANGE = 1.6;

// ---------------------------------------------------------------------------
// Constants -- Input
// ---------------------------------------------------------------------------
const CLICK_DRAG_THRESHOLD_PX = 5;

// ---------------------------------------------------------------------------
// Constants -- Color preset labels (for UI)
// ---------------------------------------------------------------------------
const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Leg configurations (from POC 3)
// ---------------------------------------------------------------------------
interface LegConfig {
  offset: THREE.Vector3;
  direction: THREE.Vector3;
  group: number;
}

const LEG_CONFIGS: Record<number, LegConfig[]> = {
  2: buildLegConfig(2),
  4: buildLegConfig(4),
  6: buildLegConfig(6),
  8: buildLegConfig(8),
};

function buildLegConfig(legCount: number): LegConfig[] {
  const legs: LegConfig[] = [];
  const halfCount = legCount / 2;

  if (legCount === 2) {
    const lateralOffset = BODY_RADIUS * BIPED_LATERAL_OFFSET_FACTOR;
    legs.push({ offset: new THREE.Vector3(-lateralOffset, 0, 0), direction: new THREE.Vector3(-1, 0, 0), group: 0 });
    legs.push({ offset: new THREE.Vector3( lateralOffset, 0, 0), direction: new THREE.Vector3( 1, 0, 0), group: 1 });
    return legs;
  }

  for (let i = 0; i < halfCount; i++) {
    const t = halfCount === 1 ? 0 : i / (halfCount - 1);
    const zOffset = BODY_RADIUS * (LEG_FRONT_BACK_EXTENT - t * LEG_FRONT_BACK_RANGE);
    const xOffset = BODY_RADIUS * LEG_LATERAL_OFFSET_FACTOR;

    const groupLeft = assignGaitGroup(i, legCount, 'left');
    const groupRight = assignGaitGroup(i, legCount, 'right');

    legs.push({
      offset: new THREE.Vector3(-xOffset, 0, zOffset),
      direction: new THREE.Vector3(-1, 0, 0).normalize(),
      group: groupLeft,
    });
    legs.push({
      offset: new THREE.Vector3(xOffset, 0, zOffset),
      direction: new THREE.Vector3(1, 0, 0).normalize(),
      group: groupRight,
    });
  }

  return legs;
}

function assignGaitGroup(pairIndex: number, legCount: number, side: 'left' | 'right'): number {
  if (legCount === 4) {
    if (pairIndex === 0) return side === 'left' ? 0 : 1;
    return side === 'left' ? 1 : 0;
  }

  if (legCount === 6) {
    const evenPair = pairIndex % 2 === 0;
    if (side === 'left') return evenPair ? 0 : 1;
    return evenPair ? 1 : 0;
  }

  const halfCount = legCount / 2;
  return halfCount - 1 - pairIndex;
}

// ---------------------------------------------------------------------------
// FABRIK IK Solver (from POC 3)
// ---------------------------------------------------------------------------
function fabrikSolve(joints: THREE.Vector3[], target: THREE.Vector3, iterations: number): void {
  const numJoints = joints.length;
  if (numJoints < 2) return;

  const boneLengths: number[] = [];
  for (let i = 0; i < numJoints - 1; i++) {
    boneLengths.push(joints[i].distanceTo(joints[i + 1]));
  }

  const rootPos = joints[0].clone();

  for (let iter = 0; iter < iterations; iter++) {
    joints[numJoints - 1].copy(target);
    for (let i = numJoints - 2; i >= 0; i--) {
      const dir = joints[i].clone().sub(joints[i + 1]).normalize();
      joints[i].copy(joints[i + 1]).add(dir.multiplyScalar(boneLengths[i]));
    }

    joints[0].copy(rootPos);
    for (let i = 0; i < numJoints - 1; i++) {
      const dir = joints[i + 1].clone().sub(joints[i]).normalize();
      joints[i + 1].copy(joints[i]).add(dir.multiplyScalar(boneLengths[i]));
    }
  }
}

// ---------------------------------------------------------------------------
// IK Creature class (adapted from POC 3 for server-driven movement)
// ---------------------------------------------------------------------------
interface LegState {
  joints: THREE.Vector3[];
  plantedPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  stepping: boolean;
  stepProgress: number;
  stepStartPos: THREE.Vector3;
  stepEndPos: THREE.Vector3;
  group: number;
  configIndex: number;
}

interface LegMeshes {
  bones: THREE.Mesh[];
  joints: THREE.Mesh[];
  plantMarker: THREE.Mesh;
}

class IKCreature {
  scene: THREE.Scene;
  legCount: number;
  hue: number;
  bodyColor: THREE.Color;
  legColor: THREE.Color;
  jointColor: THREE.Color;

  position: THREE.Vector3;
  serverPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  forward: THREE.Vector3;
  isMoving: boolean;

  bodyMesh: THREE.Mesh | null;
  legMeshGroups: LegMeshes[];
  group: THREE.Group;

  legs: LegState[];
  config: LegConfig[];
  gaitGroupCount: number;
  activeGaitGroup: number;
  anyGroupStepping: boolean;

  dbId: bigint;

  constructor(scene: THREE.Scene, position: THREE.Vector3, legCount: number, hue: number, dbId: bigint) {
    this.scene = scene;
    this.legCount = legCount;
    this.hue = hue;
    this.dbId = dbId;
    this.bodyColor = new THREE.Color().setHSL(hue, BODY_SATURATION, BODY_LIGHTNESS);
    this.legColor = new THREE.Color().setHSL(hue, LEG_SATURATION, BODY_LIGHTNESS * LEG_COLOR_DARKEN_FACTOR);
    this.jointColor = new THREE.Color().setHSL(hue, JOINT_SATURATION, JOINT_LIGHTNESS);

    this.position = position.clone();
    this.position.y = BODY_HEIGHT;
    this.serverPosition = this.position.clone();
    this.serverPosition.y = GROUND_Y;
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.isMoving = false;

    this.bodyMesh = null;
    this.legMeshGroups = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    this.legs = [];
    this.config = LEG_CONFIGS[legCount] || LEG_CONFIGS[4];
    this.gaitGroupCount = this._countGaitGroups();
    this.activeGaitGroup = 0;
    this.anyGroupStepping = false;

    this._buildVisuals();
    this._initLegs();
  }

  _countGaitGroups(): number {
    const groups = new Set<number>();
    for (const leg of this.config) {
      groups.add(leg.group);
    }
    return groups.size;
  }

  _buildVisuals(): void {
    const bodyGeo = new THREE.SphereGeometry(BODY_RADIUS, BODY_SPHERE_SEGMENTS_W, BODY_SPHERE_SEGMENTS_H);
    const bodyMat = new THREE.MeshPhongMaterial({ color: this.bodyColor, flatShading: true, shininess: 20 });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(this.bodyMesh);

    const boneGeo = new THREE.CylinderGeometry(LEG_CYLINDER_RADIUS, LEG_CYLINDER_RADIUS, 1, LEG_CYLINDER_SEGMENTS);
    const jointGeo = new THREE.SphereGeometry(JOINT_SPHERE_RADIUS, JOINT_SPHERE_SEGMENTS, JOINT_SPHERE_SEGMENTS);
    const plantGeo = new THREE.RingGeometry(FOOT_PLANT_RADIUS * FOOT_PLANT_INNER_RATIO, FOOT_PLANT_RADIUS, FOOT_PLANT_SEGMENTS);

    const legMat = new THREE.MeshPhongMaterial({ color: this.legColor, flatShading: true, shininess: 10 });
    const jointMat = new THREE.MeshPhongMaterial({ color: this.jointColor, flatShading: true, shininess: 10 });
    const plantMat = new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.4, side: THREE.DoubleSide });

    for (let i = 0; i < this.config.length; i++) {
      const bones: THREE.Mesh[] = [];
      const joints: THREE.Mesh[] = [];

      for (let b = 0; b < BONE_COUNT_PER_LEG; b++) {
        const bone = new THREE.Mesh(boneGeo, legMat);
        this.group.add(bone);
        bones.push(bone);
      }

      for (let j = 0; j < LEG_SEGMENT_COUNT; j++) {
        const joint = new THREE.Mesh(jointGeo, jointMat);
        this.group.add(joint);
        joints.push(joint);
      }

      const plantMarker = new THREE.Mesh(plantGeo, plantMat.clone());
      plantMarker.rotation.x = -Math.PI / 2;
      this.scene.add(plantMarker);

      this.legMeshGroups.push({ bones, joints, plantMarker });
    }
  }

  _initLegs(): void {
    for (let i = 0; i < this.config.length; i++) {
      const cfg = this.config[i];
      const hipWorld = this.position.clone().add(cfg.offset);

      const footPos = hipWorld.clone().add(cfg.direction.clone().multiplyScalar(LEG_UPPER_LENGTH * HIP_INIT_OUTWARD_FACTOR));
      footPos.y = GROUND_Y;

      const knee = hipWorld.clone().lerp(footPos, 0.5);
      knee.y = hipWorld.y - LEG_UPPER_LENGTH * KNEE_HEIGHT_FACTOR;

      this.legs.push({
        joints: [hipWorld.clone(), knee.clone(), footPos.clone()],
        plantedPos: footPos.clone(),
        targetPos: footPos.clone(),
        stepping: false,
        stepProgress: 0,
        stepStartPos: footPos.clone(),
        stepEndPos: footPos.clone(),
        group: cfg.group,
        configIndex: i,
      });
    }
  }

  /**
   * Called when the server reports a new position/target for this creature.
   * We set the server position and let client-side interpolation handle movement.
   */
  setServerTarget(x: number, z: number): void {
    this.serverPosition.set(x, GROUND_Y, z);
  }

  /**
   * Snap creature directly to a position (for initial placement).
   */
  snapTo(x: number, z: number): void {
    this.position.set(x, BODY_HEIGHT, z);
    this.serverPosition.set(x, GROUND_Y, z);
    // Re-init legs at new position
    for (let i = 0; i < this.config.length; i++) {
      const cfg = this.config[i];
      const hipWorld = this.position.clone().add(cfg.offset);
      const footPos = hipWorld.clone().add(cfg.direction.clone().multiplyScalar(LEG_UPPER_LENGTH * HIP_INIT_OUTWARD_FACTOR));
      footPos.y = GROUND_Y;

      const knee = hipWorld.clone().lerp(footPos, 0.5);
      knee.y = hipWorld.y - LEG_UPPER_LENGTH * KNEE_HEIGHT_FACTOR;

      this.legs[i].joints[0].copy(hipWorld);
      this.legs[i].joints[1].copy(knee);
      this.legs[i].joints[2].copy(footPos);
      this.legs[i].plantedPos.copy(footPos);
      this.legs[i].targetPos.copy(footPos);
      this.legs[i].stepStartPos.copy(footPos);
      this.legs[i].stepEndPos.copy(footPos);
      this.legs[i].stepping = false;
      this.legs[i].stepProgress = 0;
    }
  }

  update(dt: number): void {
    this._updateMovement(dt);
    this._updateGait(dt);
    this._solveAllIK();
    this._updateVisuals();
  }

  _updateMovement(_dt: number): void {
    // Lerp toward server position — can never overshoot
    const target = new THREE.Vector3(this.serverPosition.x, BODY_HEIGHT, this.serverPosition.z);
    const prev = this.position.clone();

    this.position.lerp(target, CLIENT_INTERP_FACTOR);

    // Derive velocity and facing from actual movement
    this.velocity.subVectors(this.position, prev);
    const speed = this.velocity.length();
    this.isMoving = speed > WANDER_ARRIVAL_THRESHOLD * 0.01;

    if (this.isMoving) {
      const dir = this.velocity.clone().normalize();
      this.forward.lerp(dir, FORWARD_TURN_LERP).normalize();
    }

    // Body bob
    const steppingCount = this.legs.filter(l => l.stepping).length;
    if (steppingCount > 0 || this.isMoving) {
      const bobPhase = performance.now() * BOB_PHASE_SPEED;
      this.position.y = BODY_HEIGHT + Math.sin(bobPhase) * BOB_AMPLITUDE;
    }
  }

  _updateGait(dt: number): void {
    this.anyGroupStepping = false;
    for (const leg of this.legs) {
      if (leg.stepping) {
        this.anyGroupStepping = true;
        leg.stepProgress += dt / STEP_DURATION;
        if (leg.stepProgress >= 1) {
          leg.stepProgress = 1;
          leg.stepping = false;
          leg.plantedPos.copy(leg.stepEndPos);
          leg.targetPos.copy(leg.stepEndPos);
        } else {
          const t = leg.stepProgress;
          const x = leg.stepStartPos.x + (leg.stepEndPos.x - leg.stepStartPos.x) * t;
          const z = leg.stepStartPos.z + (leg.stepEndPos.z - leg.stepStartPos.z) * t;
          const y = GROUND_Y + STEP_HEIGHT * PARABOLIC_PEAK_FACTOR * t * (1 - t);
          leg.targetPos.set(x, y, z);
        }
      }
    }

    if (!this.anyGroupStepping) {
      let worstGroup = -1;
      let worstDist = 0;

      for (const leg of this.legs) {
        const hipWorld = this._getHipWorldPos(leg.configIndex);
        const cfg = this.config[leg.configIndex];
        const desiredFoot = hipWorld.clone().add(cfg.direction.clone().multiplyScalar(LEG_UPPER_LENGTH * HIP_OUTWARD_FACTOR));
        desiredFoot.y = GROUND_Y;

        if (this.isMoving) {
          const prediction = this.velocity.clone().multiplyScalar(STEP_PREDICT_FACTOR * STEP_DURATION);
          desiredFoot.add(prediction);
        }

        const dist = desiredFoot.distanceTo(leg.plantedPos);
        if (dist > STEP_THRESHOLD && dist > worstDist) {
          worstDist = dist;
          worstGroup = leg.group;
        }
      }

      if (worstGroup >= 0) {
        for (const leg of this.legs) {
          if (leg.group === worstGroup) {
            const hipWorld = this._getHipWorldPos(leg.configIndex);
            const cfg = this.config[leg.configIndex];
            const desiredFoot = hipWorld.clone().add(cfg.direction.clone().multiplyScalar(LEG_UPPER_LENGTH * HIP_OUTWARD_FACTOR));
            desiredFoot.y = GROUND_Y;

            if (this.isMoving) {
              const prediction = this.velocity.clone().multiplyScalar(STEP_PREDICT_FACTOR * STEP_DURATION);
              desiredFoot.add(prediction);
            }

            leg.stepping = true;
            leg.stepProgress = 0;
            leg.stepStartPos.copy(leg.plantedPos);
            leg.stepEndPos.copy(desiredFoot);
          }
        }
      }
    }
  }

  _getHipWorldPos(configIndex: number): THREE.Vector3 {
    const cfg = this.config[configIndex];
    return new THREE.Vector3(
      this.position.x + cfg.offset.x,
      this.position.y + cfg.offset.y,
      this.position.z + cfg.offset.z,
    );
  }

  _solveAllIK(): void {
    for (const leg of this.legs) {
      const hipWorld = this._getHipWorldPos(leg.configIndex);

      leg.joints[0].copy(hipWorld);

      const midpoint = hipWorld.clone().lerp(leg.targetPos, 0.5);
      midpoint.y = hipWorld.y - LEG_UPPER_LENGTH * KNEE_MIDPOINT_DROP_FACTOR;
      leg.joints[1].copy(midpoint);

      leg.joints[2].copy(leg.targetPos);

      const totalReach = LEG_UPPER_LENGTH + LEG_LOWER_LENGTH;
      const hipToTarget = hipWorld.distanceTo(leg.targetPos);

      if (hipToTarget > totalReach) {
        const dir = leg.targetPos.clone().sub(hipWorld).normalize();
        leg.joints[1].copy(hipWorld).add(dir.clone().multiplyScalar(LEG_UPPER_LENGTH));
        leg.joints[2].copy(hipWorld).add(dir.multiplyScalar(totalReach));
      } else {
        const dir01 = leg.joints[1].clone().sub(leg.joints[0]).normalize();
        leg.joints[1].copy(leg.joints[0]).add(dir01.multiplyScalar(LEG_UPPER_LENGTH));

        const dir12 = leg.joints[2].clone().sub(leg.joints[1]).normalize();
        leg.joints[2].copy(leg.joints[1]).add(dir12.multiplyScalar(LEG_LOWER_LENGTH));

        fabrikSolve(leg.joints, leg.targetPos, IK_ITERATIONS);
      }
    }
  }

  _updateVisuals(): void {
    this.group.position.set(0, 0, 0);
    this.bodyMesh!.position.copy(this.position);

    const yawAngle = Math.atan2(this.forward.x, this.forward.z);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawAngle);

    if (this.isMoving) {
      const speed = this.velocity.length();
      const tiltAngle = Math.min(speed * TILT_FACTOR * TILT_SPEED_SCALE, TILT_FACTOR);
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.forward).normalize();
      const tiltQuat = new THREE.Quaternion().setFromAxisAngle(right, tiltAngle);
      this.bodyMesh!.quaternion.copy(tiltQuat).multiply(yawQuat);
    } else {
      this.bodyMesh!.quaternion.copy(yawQuat);
    }

    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      const meshes = this.legMeshGroups[i];

      for (let j = 0; j < LEG_SEGMENT_COUNT; j++) {
        meshes.joints[j].position.copy(leg.joints[j]);
      }

      for (let b = 0; b < BONE_COUNT_PER_LEG; b++) {
        const start = leg.joints[b];
        const end = leg.joints[b + 1];
        const mid = start.clone().add(end).multiplyScalar(0.5);
        const boneLength = start.distanceTo(end);

        meshes.bones[b].position.copy(mid);
        meshes.bones[b].scale.set(1, boneLength, 1);

        const dir = end.clone().sub(start).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
        meshes.bones[b].quaternion.copy(quat);
      }

      meshes.plantMarker.position.set(leg.plantedPos.x, GROUND_Y + FOOT_PLANT_Y_OFFSET, leg.plantedPos.z);
    }
  }

  dispose(): void {
    for (const lm of this.legMeshGroups) {
      for (const b of lm.bones) this.group.remove(b);
      for (const j of lm.joints) this.group.remove(j);
      this.scene.remove(lm.plantMarker);

      lm.plantMarker.geometry.dispose();
      (lm.plantMarker.material as THREE.Material).dispose();
    }
    if (this.bodyMesh) {
      this.bodyMesh.geometry.dispose();
      (this.bodyMesh.material as THREE.Material).dispose();
    }
    this.scene.remove(this.group);
  }
}

// ---------------------------------------------------------------------------
// DOM Refs
// ---------------------------------------------------------------------------
const connStatusEl = document.getElementById('conn-status')!;
const playerCountEl = document.getElementById('player-count')!;
const creatureCountEl = document.getElementById('creature-count')!;
const fpsEl = document.getElementById('fps-display')!;
const logEl = document.getElementById('event-log')!;
const legButtons = document.querySelectorAll('#leg-buttons button');
const colorButtons = document.querySelectorAll('#color-buttons .color-btn');
const previewDot = document.getElementById('preview-dot')! as HTMLElement;
const previewLabel = document.getElementById('preview-label')!;
const speedSlider = document.getElementById('speed-slider')! as HTMLInputElement;
const speedValue = document.getElementById('speed-value')!;
const resetBtn = document.getElementById('reset-btn')!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let selectedLegCount = 4;
let selectedHue = 0;
let selectedSpeed = 2.0;
let selectedColorIndex = 0;

const creatureInstances = new Map<bigint, IKCreature>();
const creatureRows = new Map<bigint, CreatureRow>();
const playerMap = new Map<string, Player>();
let selectedCreatureId: bigint | null = null;
let myIdentity: string | null = null;
let conn: DbConnection | null = null;

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------
function log(msg: string): void {
  const div = document.createElement('div');
  const ts = new Date().toLocaleTimeString();
  div.textContent = `[${ts}] ${msg}`;
  logEl.prepend(div);
  while (logEl.children.length > MAX_LOG_ENTRIES) {
    logEl.removeChild(logEl.lastChild!);
  }
}

// ---------------------------------------------------------------------------
// Three.js Setup
// ---------------------------------------------------------------------------
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
const dirLight = new THREE.DirectionalLight(DIR_LIGHT_COLOR, DIR_LIGHT_INTENSITY);
dirLight.position.set(DIR_LIGHT_X, DIR_LIGHT_Y, DIR_LIGHT_Z);
scene.add(dirLight);

// Ground plane
const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMat = new THREE.MeshPhongMaterial({ color: GROUND_COLOR, shininess: GROUND_SHININESS, flatShading: true });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
ground.name = 'ground';
scene.add(ground);

// Grid
const gridHelper = new THREE.GridHelper(GROUND_SIZE, GROUND_DIVISIONS, GROUND_GRID_COLOR, GROUND_GRID_COLOR);
gridHelper.position.y = GROUND_Y + Z_FIGHT_OFFSET;
(gridHelper.material as THREE.Material).opacity = GRID_OPACITY;
(gridHelper.material as THREE.Material).transparent = true;
scene.add(gridHelper);

// Arena boundary ring
const DB_ARENA_RADIUS = 200;
const ARENA_VISUAL_RADIUS = DB_ARENA_RADIUS * WORLD_SCALE;
const ARENA_SEGMENTS = 96;
const ARENA_COLOR = 0x5577ff;
const arenaGeo = new THREE.RingGeometry(ARENA_VISUAL_RADIUS - 0.1, ARENA_VISUAL_RADIUS, ARENA_SEGMENTS);
const arenaMat = new THREE.MeshBasicMaterial({ color: ARENA_COLOR, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
const arenaRing = new THREE.Mesh(arenaGeo, arenaMat);
arenaRing.rotation.x = -Math.PI / 2;
arenaRing.position.y = GROUND_Y + Z_FIGHT_OFFSET * 2;
scene.add(arenaRing);

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
let renderer: THREE.WebGPURenderer | THREE.WebGLRenderer;
let controls: OrbitControls;

async function initRenderer(): Promise<void> {
  try {
    const { WebGPURenderer } = await import('three/webgpu');
    renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    await renderer.init();
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

// ---------------------------------------------------------------------------
// SpacetimeDB Connection
// ---------------------------------------------------------------------------
function connectToSTDB(token?: string): void {
  conn = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DATABASE)
    .withToken(token)
    .onConnect((connection, identity, newToken) => {
      myIdentity = identity.toHexString();
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
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
      connStatusEl.textContent = 'Reconnecting...';
      connStatusEl.style.color = STATUS_ERROR_COLOR;
      log(`Connection error: ${err}`);

      // If we had a stored token, it's probably stale — retry without it
      if (token) {
        log('Clearing stale token and reconnecting...');
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
      } else {
        // Fresh token also failed — server might be down, retry
        setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
      }
    })
    .onDisconnect(() => {
      connStatusEl.textContent = 'Disconnected';
      connStatusEl.style.color = STATUS_ERROR_COLOR;
      log('Disconnected — reconnecting...');
      setTimeout(() => connectToSTDB(localStorage.getItem(AUTH_TOKEN_KEY) || undefined), RECONNECT_DELAY_MS);
    })
    .build();

  // Player callbacks
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

  // Creature callbacks -- this is where IK creatures are created/updated/destroyed
  conn.db.creature.onInsert((_ctx: unknown, row: CreatureRow) => {
    creatureRows.set(row.id, row);

    const threeX = dbToThreeX(row.x);
    const threeZ = dbToThreeZ(row.y);
    const legCount = row.legCount;
    const hue = row.hue;

    const creature = new IKCreature(
      scene,
      new THREE.Vector3(threeX, GROUND_Y, threeZ),
      legCount,
      hue,
      row.id,
    );
    creature.snapTo(threeX, threeZ);
    creatureInstances.set(row.id, creature);

    log(`Creature ${row.id} spawned (${legCount} legs)`);
    updateStats();
  });

  conn.db.creature.onUpdate((_ctx: unknown, _old: CreatureRow, row: CreatureRow) => {
    creatureRows.set(row.id, row);

    const creature = creatureInstances.get(row.id);
    if (creature) {
      // Track the server's authoritative position —
      // at 10 ticks/sec the client smoothly interpolates between updates
      const threeX = dbToThreeX(row.x);
      const threeZ = dbToThreeZ(row.y);
      creature.setServerTarget(threeX, threeZ);
    }
    updateStats();
  });

  conn.db.creature.onDelete((_ctx: unknown, row: CreatureRow) => {
    creatureRows.delete(row.id);

    const creature = creatureInstances.get(row.id);
    if (creature) {
      creature.dispose();
      creatureInstances.delete(row.id);
    }
    if (selectedCreatureId === row.id) {
      selectedCreatureId = null;
    }

    log(`Creature ${row.id} removed`);
    updateStats();
  });

  // Combat events
  conn.db.eventCombat.onInsert((_ctx: unknown, row: EventCombat) => {
    log(`Combat! ${row.attackerId} vs ${row.defenderId} (${row.damage} dmg)`);
  });
}

function updateStats(): void {
  playerCountEl.textContent = String(playerMap.size);
  creatureCountEl.textContent = String(creatureInstances.size);
}

// ---------------------------------------------------------------------------
// Raycasting / Input
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };

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

function isOverHUD(event: MouseEvent): boolean {
  return !!(event.target as HTMLElement).closest('#hud, #event-log, #controls-hint');
}

/**
 * Find which creature body (sphere) was clicked by checking
 * proximity of the click's ground intersection to each creature's position.
 */
const CREATURE_CLICK_RADIUS = BODY_RADIUS * 2;

function getClickedCreatureId(event: MouseEvent): bigint | null {
  screenToNDC(event);
  raycaster.setFromCamera(mouseNDC, camera);

  // Collect all body meshes for raycast
  const bodyMeshes: THREE.Mesh[] = [];
  const meshToId = new Map<THREE.Mesh, bigint>();

  for (const [id, creature] of creatureInstances) {
    if (creature.bodyMesh) {
      bodyMeshes.push(creature.bodyMesh);
      meshToId.set(creature.bodyMesh, id);
    }
  }

  const hits = raycaster.intersectObjects(bodyMeshes);
  if (hits.length > 0) {
    return meshToId.get(hits[0].object as THREE.Mesh) ?? null;
  }
  return null;
}

// Pointer down/up for drag detection
function onPointerDown(event: MouseEvent): void {
  pointerDownPos.x = event.clientX;
  pointerDownPos.y = event.clientY;
}

function wasDrag(event: MouseEvent): boolean {
  const dx = event.clientX - pointerDownPos.x;
  const dy = event.clientY - pointerDownPos.y;
  return (dx * dx + dy * dy) > (CLICK_DRAG_THRESHOLD_PX * CLICK_DRAG_THRESHOLD_PX);
}

// Left-click: spawn creature
function onLeftClick(event: MouseEvent): void {
  if (!conn || isOverHUD(event) || wasDrag(event)) return;

  const point = getGroundIntersection(event);
  if (!point) return;

  const dbX = threeToDbX(point.x);
  const dbY = threeToDbY(point.z);

  conn.reducers.spawnCreature({ x: dbX, y: dbY, legCount: selectedLegCount, hue: selectedHue, speed: selectedSpeed });
  log(`Spawning ${selectedLegCount}-leg creature (speed ${selectedSpeed.toFixed(1)}) at (${dbX.toFixed(0)}, ${dbY.toFixed(0)})`);
}

// Right-click: select creature or move selected creature
function onRightClick(event: MouseEvent): void {
  event.preventDefault();
  if (!conn || wasDrag(event)) return;

  // Check for creature hit first
  const creatureId = getClickedCreatureId(event);
  if (creatureId !== null) {
    selectedCreatureId = creatureId;
    log(`Selected creature ${creatureId}`);
    return;
  }

  // Move selected creature
  if (selectedCreatureId !== null) {
    const point = getGroundIntersection(event);
    if (!point) return;

    const dbX = threeToDbX(point.x);
    const dbY = threeToDbY(point.z);

    conn.reducers.moveCreature({
      creatureId: selectedCreatureId,
      targetX: dbX,
      targetY: dbY,
    });
    log(`Moving creature ${selectedCreatureId} to (${dbX.toFixed(0)}, ${dbY.toFixed(0)})`);
  }
}

// ---------------------------------------------------------------------------
// HUD controls
// ---------------------------------------------------------------------------
legButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    legButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLegCount = parseInt((btn as HTMLElement).dataset.legs!, 10);
    updatePreview();
  });
});

colorButtons.forEach((btn, index) => {
  btn.addEventListener('click', () => {
    colorButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedHue = parseFloat((btn as HTMLElement).dataset.hue!);
    selectedColorIndex = index;
    updatePreview();
  });
});

speedSlider.addEventListener('input', () => {
  selectedSpeed = parseFloat(speedSlider.value);
  speedValue.textContent = selectedSpeed.toFixed(1);
});

resetBtn.addEventListener('click', () => {
  if (!conn) return;
  conn.reducers.reset({});
  log('Reset: deleting all creatures');
});

function updatePreview(): void {
  const hslDeg = Math.round(selectedHue * 360);
  previewDot.style.background = `hsl(${hslDeg}, 65%, 55%)`;
  previewLabel.textContent = `${selectedLegCount} legs, ${COLOR_NAMES[selectedColorIndex]}`;
}

// ---------------------------------------------------------------------------
// Selection ring
// ---------------------------------------------------------------------------
const selectRingGeo = new THREE.RingGeometry(BODY_RADIUS * 1.5, BODY_RADIUS * 1.8, 32);
const selectRingMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.6,
});
let selectionRing: THREE.Mesh | null = null;

function updateSelectionRing(): void {
  if (selectedCreatureId !== null && creatureInstances.has(selectedCreatureId)) {
    if (!selectionRing) {
      selectionRing = new THREE.Mesh(selectRingGeo, selectRingMat);
      selectionRing.rotation.x = -Math.PI / 2;
      scene.add(selectionRing);
    }
    const creature = creatureInstances.get(selectedCreatureId)!;
    selectionRing.position.set(
      creature.position.x,
      GROUND_Y + 0.02,
      creature.position.z,
    );
    selectionRing.visible = true;
  } else if (selectionRing) {
    selectionRing.visible = false;
  }
}

// ---------------------------------------------------------------------------
// FPS
// ---------------------------------------------------------------------------
let frameCount = 0;
let lastFpsTime = 0;

function updateFps(now: number): void {
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

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await initRenderer();

  // Input listeners
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('click', onLeftClick);
  renderer.domElement.addEventListener('contextmenu', onRightClick);

  connectToSTDB(localStorage.getItem(AUTH_TOKEN_KEY) || undefined);
  lastFpsTime = performance.now();

  const clock = new THREE.Clock();

  function animate(): void {
    const dt = Math.min(clock.getDelta(), MAX_DELTA_TIME);
    const now = performance.now();

    // Update all IK creatures
    for (const creature of creatureInstances.values()) {
      creature.update(dt);
    }

    updateSelectionRing();
    updateFps(now);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

main().catch(console.error);
