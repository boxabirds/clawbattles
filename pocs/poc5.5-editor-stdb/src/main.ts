/**
 * POC 5.5: Creature Editor + SpacetimeDB Persistence
 *
 * Full creature editor (from POC 5) with SpacetimeDB integration for
 * save, load, browse, and deploy creature designs.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DbConnection } from './module_bindings';
import type {
  CreatureDesign as CreatureDesignRow,
  Player,
} from './module_bindings/types';

// ===========================================================================
// CONSTANTS -- SpacetimeDB
// ===========================================================================

const STDB_URI = `ws://${window.location.hostname}:3000`;
const STDB_DATABASE = 'poc55';
const AUTH_TOKEN_KEY = 'poc55_auth_token';
const RECONNECT_DELAY_MS = 2000;

// ===========================================================================
// CONSTANTS -- Layout
// ===========================================================================

const BG_COLOR = 0x1a1a2e;

// -- Ground --
const GROUND_SIZE = 20;
const GROUND_DIVISIONS = 20;
const GROUND_GRID_COLOR = 0x3a3a5a;
const GROUND_COLOR = 0x2a2a4a;
const GROUND_Y = -2;

// -- Camera --
const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;
const CAMERA_INITIAL_POS: [number, number, number] = [2, 1.5, 3];
const ORBIT_DAMPING = 0.08;

// -- Lighting --
const AMBIENT_INTENSITY = 0.5;
const DIRECTIONAL_INTENSITY = 1.2;
const DIRECTIONAL_POS: [number, number, number] = [5, 8, 5];
const HEMISPHERE_SKY_COLOR = 0x4488cc;
const HEMISPHERE_GROUND_COLOR = 0x222244;
const HEMISPHERE_INTENSITY = 0.4;

// -- Port visualization --
const PORT_RADIUS = 0.06;
const PORT_SEGMENTS = 12;
const PORT_COLOR = 0x00e5ff;
const PORT_EMISSIVE_INTENSITY = 2.0;
const PORT_PULSE_SPEED = 3.0;
const PORT_PULSE_MIN_OPACITY = 0.4;
const PORT_PULSE_MAX_OPACITY = 1.0;
const PORT_HOVER_SCALE = 1.5;
const PORT_HOVER_COLOR = 0xffffff;

// -- Ghost preview --
const GHOST_OPACITY = 0.4;

// -- Snap animation --
const SNAP_DURATION_MS = 200;
const SNAP_SCALE_OVERSHOOT = 1.3;

// -- Player hue --
const PLAYER_HUE = 0.6;
const STRUCTURAL_SATURATION = 0.35;
const STRUCTURAL_LIGHTNESS = 0.5;
const LOCOMOTION_HUE_SHIFT = 15 / 360;
const SENSORY_HUE_SHIFT = -0.05;
const OFFENSIVE_HUE_SHIFT = -0.15;
const UTILITY_HUE_SHIFT = 0.12;
const CATEGORY_SATURATION = 0.6;
const CATEGORY_LIGHTNESS = 0.55;
const EMISSIVE_INTENSITY_SENSORY = 0.5;
const EMISSIVE_INTENSITY_OFFENSIVE = 0.3;

// -- Part geometry dimensions --
const CORE_RADIUS = 0.3;
const CORE_SEGMENTS = 24;
const SEGMENT_RADIUS = 0.25;
const SEGMENT_HEIGHT = 0.4;
const SEGMENT_RADIAL_SEGMENTS = 16;
const JOINT_RADIUS = 0.15;
const JOINT_SEGMENTS = 16;
const LEG_RADIUS = 0.03;
const LEG_UPPER_LEN = 0.35;
const LEG_LOWER_LEN = 0.3;
const LEG_SEGMENTS = 8;
const SHELL_RADIUS = 0.3;
const SHELL_SEGMENTS = 20;
const ANTENNA_RADIUS = 0.02;
const ANTENNA_LENGTH = 0.5;
const ANTENNA_TIP_RADIUS = 0.05;
const ANTENNA_SEGMENTS = 8;
const MANDIBLE_RADIUS = 0.08;
const MANDIBLE_HEIGHT = 0.25;
const MANDIBLE_SEGMENTS = 8;
const MANDIBLE_SPREAD = 0.12;
const EYE_RADIUS = 0.08;
const EYE_SEGMENTS = 12;
const WING_WIDTH = 0.5;
const WING_HEIGHT = 0.3;
const STINGER_RADIUS = 0.06;
const STINGER_HEIGHT = 0.35;
const STINGER_SEGMENTS = 8;
const CARRIER_SIZE = 0.3;
const CARRIER_BAR_RADIUS = 0.02;
const CARRIER_SEGMENTS = 4;

// -- Stats formulas --
const BASE_SPEED = 1.0;
const SPEED_PER_LEG = 1.0;
const SPEED_DIMINISHING_THRESHOLD = 6;
const SPEED_DIMINISHING_VALUE = 0.3;
const BASE_HP = 25;
const HP_PER_SEGMENT = 10;
const HP_PER_JOINT = 5;
const HP_PER_SHELL = 20;
const DPS_PER_MANDIBLE = 5;
const DPS_PER_STINGER = 12;
const VISION_PER_EYE = 5;
const VISION_PER_ANTENNA = 8;
const CARRY_PER_CARRIER = 10;

// -- Part costs --
const PART_COSTS: Record<string, number> = {
  core: 10, segment: 5, joint: 3, leg: 6, shell: 8,
  eye: 4, antenna: 5, mandible: 6, stinger: 8, wing: 12, carrier: 4
};

// -- Stat display max values (for bars) --
const STAT_MAX_SPEED = 12;
const STAT_MAX_HP = 120;
const STAT_MAX_DPS = 40;
const STAT_MAX_VISION = 30;
const STAT_MAX_CARRY = 40;
const STAT_MAX_COST = 100;

// -- Port directions (unit vectors) --
const PORT_DIRS: Record<string, [number, number, number]> = {
  top:    [0,  1,  0],
  bottom: [0, -1,  0],
  front:  [0,  0,  1],
  back:   [0,  0, -1],
  left:   [-1, 0,  0],
  right:  [1,  0,  0]
};

// -- Test Walk --
const TEST_WALK_DURATION_S = 5;
const TEST_WALK_CIRCLE_RADIUS = 1.5;
const TEST_WALK_SPEED = 1.5;
const TEST_WALK_GROUND_Y = -0.5;
const STEP_THRESHOLD = 0.35;
const STEP_HEIGHT = 0.15;
const STEP_DURATION_S = 0.15;
const STEP_PREDICT_FACTOR = 0.3;
const BOB_AMPLITUDE = 0.02;
const BOB_SPEED = 0.012;

// -- Raycaster --
const RAYCASTER_PORT_THRESHOLD = 0.15;

// -- Material properties --
const PART_ROUGHNESS = 0.4;
const PART_METALNESS = 0.1;
const SENSORY_EMISSIVE_SATURATION = 0.8;
const SENSORY_EMISSIVE_LIGHTNESS = 0.6;
const ANTENNA_TIP_EMISSIVE_INTENSITY = 0.6;
const EYE_EMISSIVE_INTENSITY = 0.8;
const WING_BASE_OPACITY = 0.6;
const PORT_INITIAL_OPACITY = 0.8;
const GROUND_GRID_OPACITY = 0.3;
const GROUND_WALK_ROUGHNESS = 0.9;

// -- Part orientation angles (radians as fractions of PI) --
const LEG_SPLAY_ANGLE = 0.15;
const LEG_TILT_ANGLE = 0.1;
const ANTENNA_FRONT_TILT = 0.25;
const ANTENNA_SIDE_TILT = 0.2;
const WING_TILT_ANGLE = 0.1;
const MANDIBLE_FORWARD_OFFSET_FRAC = 0.3;
const MANDIBLE_SPLAY_ANGLE = 0.2;

// -- Bezier control fractions for wing shape --
const WING_BEZ_X1 = 0.3;
const WING_BEZ_Y1 = 0.6;
const WING_BEZ_X2 = 0.8;
const WING_BEZ_Y2 = 0.8;
const WING_BEZ_X3 = 0.2;
const WING_BEZ_X4 = 0.7;
const WING_BEZ_Y4 = 0.3;
const WING_BEZ_X5 = 0.2;
const WING_BEZ_Y5 = 0.1;

// -- Raycaster / interaction --
const RIGHT_CLICK_DETACH_THRESHOLD = 0.6;

// -- Test walk creature offset --
const WALK_CREATURE_Y_OFFSET = 0.3;

// -- Segment port extra offset --
const SEGMENT_PORT_Y_EXTRA = 0.05;

// -- Toast display duration --
const TOAST_DURATION_MS = 1800;

// -- Snap animation initial scale --
const SNAP_INITIAL_SCALE = 0.01;

// -- Max animation delta time --
const MAX_DELTA_TIME_S = 0.05;

// -- Walk body height factor --
const WALK_BODY_HEIGHT_FACTOR = 0.7;

// -- Walk foot spread factor --
const WALK_FOOT_SPREAD_FACTOR = 0.15;

// -- Parabolic arc peak factor --
const PARABOLIC_PEAK_FACTOR = 4;

// ===========================================================================
// PART DEFINITIONS
// ===========================================================================

const PART_CATEGORIES: Record<string, string> = {
  core:     'structural',
  segment:  'structural',
  joint:    'structural',
  leg:      'locomotion',
  shell:    'structural',
  eye:      'sensory',
  antenna:  'sensory',
  mandible: 'offensive',
  stinger:  'offensive',
  wing:     'locomotion',
  carrier:  'utility'
};

const PART_PORT_DEFS: Record<string, string[]> = {
  core:     ['top', 'bottom', 'front', 'back', 'left', 'right'],
  segment:  ['top', 'bottom', 'front', 'back', 'left', 'right'],
  joint:    ['top', 'bottom', 'front', 'back', 'left', 'right'],
  leg:      ['top'],
  shell:    ['bottom'],
  eye:      ['back'],
  antenna:  ['bottom'],
  mandible: ['back'],
  stinger:  ['back'],
  wing:     ['right'],
  carrier:  ['top']
};

// Port offsets relative to part center
function getPortOffset(partType: string, portName: string): THREE.Vector3 {
  const v = new THREE.Vector3();
  const dir = PORT_DIRS[portName];
  if (!dir) return v;

  switch (partType) {
    case 'core':
      v.set(dir[0] * CORE_RADIUS, dir[1] * CORE_RADIUS, dir[2] * CORE_RADIUS);
      break;
    case 'segment':
      v.set(
        dir[0] * SEGMENT_RADIUS,
        dir[1] * (SEGMENT_HEIGHT * 0.5 + SEGMENT_PORT_Y_EXTRA),
        dir[2] * (SEGMENT_HEIGHT * 0.5)
      );
      break;
    case 'joint':
      v.set(dir[0] * JOINT_RADIUS, dir[1] * JOINT_RADIUS, dir[2] * JOINT_RADIUS);
      break;
    default:
      // leg, shell, eye, antenna, mandible, stinger, wing, carrier: top port at origin
      v.set(0, 0, 0);
      break;
  }
  return v;
}

// ===========================================================================
// PRESET DESIGNS
// ===========================================================================

interface PresetPart {
  t: string;
  id: number;
  p?: number;
  port?: string;
}

interface PresetDesign {
  name: string;
  parts: PresetPart[];
}

const PRESET_DESIGNS: PresetDesign[] = [
  {
    name: 'Ant Worker',
    parts: [
      { t: 'core', id: 0 },
      { t: 'segment', id: 1, p: 0, port: 'back' },
      { t: 'leg', id: 2, p: 0, port: 'left' },
      { t: 'leg', id: 3, p: 0, port: 'right' },
      { t: 'leg', id: 4, p: 1, port: 'left' },
      { t: 'leg', id: 5, p: 1, port: 'right' },
      { t: 'mandible', id: 6, p: 0, port: 'front' },
      { t: 'carrier', id: 7, p: 1, port: 'top' }
    ]
  },
  {
    name: 'War Wasp',
    parts: [
      { t: 'core', id: 0 },
      { t: 'wing', id: 1, p: 0, port: 'left' },
      { t: 'wing', id: 2, p: 0, port: 'right' },
      { t: 'stinger', id: 3, p: 0, port: 'back' },
      { t: 'eye', id: 4, p: 0, port: 'front' }
    ]
  },
  {
    name: 'Seer Spider',
    parts: [
      { t: 'core', id: 0 },
      { t: 'segment', id: 1, p: 0, port: 'back' },
      { t: 'segment', id: 2, p: 1, port: 'back' },
      { t: 'joint', id: 3, p: 0, port: 'front' },
      { t: 'leg', id: 4, p: 0, port: 'left' },
      { t: 'leg', id: 5, p: 0, port: 'right' },
      { t: 'leg', id: 6, p: 1, port: 'left' },
      { t: 'leg', id: 7, p: 1, port: 'right' },
      { t: 'leg', id: 8, p: 2, port: 'left' },
      { t: 'leg', id: 9, p: 2, port: 'right' },
      { t: 'leg', id: 10, p: 2, port: 'bottom' },
      { t: 'leg', id: 11, p: 3, port: 'bottom' },
      { t: 'antenna', id: 12, p: 3, port: 'top' },
      { t: 'eye', id: 13, p: 3, port: 'front' }
    ]
  }
];

// ===========================================================================
// UTILITY
// ===========================================================================

function showToast(msg: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), TOAST_DURATION_MS);
}

function getPartColor(partType: string): { color: THREE.Color; emissive: THREE.Color | null; category: string } {
  const cat = PART_CATEGORIES[partType];
  let hue = PLAYER_HUE;
  let sat = CATEGORY_SATURATION;
  let lit = CATEGORY_LIGHTNESS;
  let emissive: THREE.Color | null = null;

  switch (cat) {
    case 'structural':
      sat = STRUCTURAL_SATURATION;
      lit = STRUCTURAL_LIGHTNESS;
      break;
    case 'locomotion':
      hue += LOCOMOTION_HUE_SHIFT;
      break;
    case 'sensory':
      hue += SENSORY_HUE_SHIFT;
      emissive = new THREE.Color().setHSL(hue + SENSORY_HUE_SHIFT, SENSORY_EMISSIVE_SATURATION, SENSORY_EMISSIVE_LIGHTNESS);
      break;
    case 'offensive':
      hue += OFFENSIVE_HUE_SHIFT;
      break;
    case 'utility':
      hue += UTILITY_HUE_SHIFT;
      break;
  }
  hue = ((hue % 1) + 1) % 1;
  const color = new THREE.Color().setHSL(hue, sat, lit);
  return { color, emissive, category: cat };
}

function getPartDotColor(partType: string): string {
  const { color } = getPartColor(partType);
  return '#' + color.getHexString();
}

// Opposite port for connection
const OPPOSITE_PORT: Record<string, string> = {
  top: 'bottom', bottom: 'top',
  front: 'back', back: 'front',
  left: 'right', right: 'left'
};

// Mirror port for bilateral symmetry
const MIRROR_PORT: Record<string, string> = {
  left: 'right', right: 'left',
  top: 'top', bottom: 'bottom',
  front: 'front', back: 'back'
};

// ===========================================================================
// CREATE PART MESH
// ===========================================================================

function createPartMesh(partType: string, isGhost = false): THREE.Group {
  const { color, emissive, category } = getPartColor(partType);
  const group = new THREE.Group();
  group.userData.partType = partType;

  const matOpts: any = {
    color: color,
    roughness: PART_ROUGHNESS,
    metalness: PART_METALNESS
  };
  if (emissive) {
    matOpts.emissive = emissive;
    matOpts.emissiveIntensity = category === 'sensory' ? EMISSIVE_INTENSITY_SENSORY : EMISSIVE_INTENSITY_OFFENSIVE;
  }
  if (isGhost) {
    matOpts.transparent = true;
    matOpts.opacity = GHOST_OPACITY;
  }
  const mat = new THREE.MeshStandardMaterial(matOpts);

  switch (partType) {
    case 'core': {
      const geo = new THREE.SphereGeometry(CORE_RADIUS, CORE_SEGMENTS, CORE_SEGMENTS);
      group.add(new THREE.Mesh(geo, mat));
      break;
    }
    case 'segment': {
      const geo = new THREE.CylinderGeometry(SEGMENT_RADIUS, SEGMENT_RADIUS, SEGMENT_HEIGHT, SEGMENT_RADIAL_SEGMENTS);
      group.add(new THREE.Mesh(geo, mat));
      break;
    }
    case 'joint': {
      const geo = new THREE.SphereGeometry(JOINT_RADIUS, JOINT_SEGMENTS, JOINT_SEGMENTS);
      group.add(new THREE.Mesh(geo, mat));
      break;
    }
    case 'leg': {
      const upper = new THREE.CylinderGeometry(LEG_RADIUS, LEG_RADIUS, LEG_UPPER_LEN, LEG_SEGMENTS);
      const lower = new THREE.CylinderGeometry(LEG_RADIUS, LEG_RADIUS * 0.7, LEG_LOWER_LEN, LEG_SEGMENTS);
      const knee = new THREE.SphereGeometry(LEG_RADIUS * 2, LEG_SEGMENTS, LEG_SEGMENTS);

      const upperBone = new THREE.Object3D();
      const upperMesh = new THREE.Mesh(upper, mat);
      upperMesh.position.y = -LEG_UPPER_LEN * 0.5;
      upperBone.add(upperMesh);

      const kneePivot = new THREE.Object3D();
      kneePivot.position.y = -LEG_UPPER_LEN;
      const kneeMesh = new THREE.Mesh(knee, mat);
      kneePivot.add(kneeMesh);
      const lowerMesh = new THREE.Mesh(lower, mat);
      lowerMesh.position.y = -LEG_LOWER_LEN * 0.5;
      kneePivot.add(lowerMesh);

      upperBone.add(kneePivot);
      group.add(upperBone);

      group.userData.upperBone = upperBone;
      group.userData.kneePivot = kneePivot;
      break;
    }
    case 'shell': {
      const geo = new THREE.SphereGeometry(SHELL_RADIUS, SHELL_SEGMENTS, SHELL_SEGMENTS, 0, Math.PI * 2, 0, Math.PI * 0.5);
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      break;
    }
    case 'antenna': {
      const stem = new THREE.CylinderGeometry(ANTENNA_RADIUS, ANTENNA_RADIUS, ANTENNA_LENGTH, ANTENNA_SEGMENTS);
      const tip = new THREE.SphereGeometry(ANTENNA_TIP_RADIUS, ANTENNA_SEGMENTS, ANTENNA_SEGMENTS);
      const stemMesh = new THREE.Mesh(stem, mat);
      stemMesh.position.y = ANTENNA_LENGTH * 0.5;
      const tipMat = mat.clone();
      if (!isGhost) {
        tipMat.emissive = new THREE.Color(0x00e5ff);
        tipMat.emissiveIntensity = ANTENNA_TIP_EMISSIVE_INTENSITY;
      }
      const tipMesh = new THREE.Mesh(tip, tipMat);
      tipMesh.position.y = ANTENNA_LENGTH;
      group.add(stemMesh, tipMesh);
      break;
    }
    case 'mandible': {
      const geo = new THREE.ConeGeometry(MANDIBLE_RADIUS, MANDIBLE_HEIGHT, MANDIBLE_SEGMENTS);
      const left = new THREE.Mesh(geo, mat);
      left.position.set(-MANDIBLE_SPREAD, 0, MANDIBLE_HEIGHT * MANDIBLE_FORWARD_OFFSET_FRAC);
      left.rotation.x = Math.PI * 0.5;
      left.rotation.z = MANDIBLE_SPLAY_ANGLE;
      const right = new THREE.Mesh(geo.clone(), mat);
      right.position.set(MANDIBLE_SPREAD, 0, MANDIBLE_HEIGHT * MANDIBLE_FORWARD_OFFSET_FRAC);
      right.rotation.x = Math.PI * 0.5;
      right.rotation.z = -MANDIBLE_SPLAY_ANGLE;
      group.add(left, right);
      break;
    }
    case 'eye': {
      const geo = new THREE.SphereGeometry(EYE_RADIUS, EYE_SEGMENTS, EYE_SEGMENTS);
      const eyeMat = mat.clone();
      if (!isGhost) {
        eyeMat.emissive = new THREE.Color(0xff4444);
        eyeMat.emissiveIntensity = EYE_EMISSIVE_INTENSITY;
      }
      group.add(new THREE.Mesh(geo, eyeMat));
      break;
    }
    case 'wing': {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(WING_WIDTH * WING_BEZ_X1, WING_HEIGHT * WING_BEZ_Y1, WING_WIDTH * WING_BEZ_X2, WING_HEIGHT * WING_BEZ_Y2, WING_WIDTH, WING_HEIGHT * WING_BEZ_X3);
      shape.bezierCurveTo(WING_WIDTH * WING_BEZ_X4, -WING_HEIGHT * WING_BEZ_Y4, WING_WIDTH * WING_BEZ_X5, -WING_HEIGHT * WING_BEZ_Y5, 0, 0);
      const geo = new THREE.ShapeGeometry(shape);
      const wingMat = mat.clone();
      wingMat.transparent = true;
      wingMat.opacity = isGhost ? GHOST_OPACITY * 0.5 : WING_BASE_OPACITY;
      wingMat.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(geo, wingMat);
      mesh.rotation.y = Math.PI * 0.5;
      group.add(mesh);
      break;
    }
    case 'stinger': {
      const geo = new THREE.ConeGeometry(STINGER_RADIUS, STINGER_HEIGHT, STINGER_SEGMENTS);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI * 0.5;
      mesh.position.z = -STINGER_HEIGHT * 0.5;
      group.add(mesh);
      break;
    }
    case 'carrier': {
      const barGeo = new THREE.CylinderGeometry(CARRIER_BAR_RADIUS, CARRIER_BAR_RADIUS, CARRIER_SIZE, CARRIER_SEGMENTS);
      const positions = [
        { p: [0, -CARRIER_SIZE * 0.5, -CARRIER_SIZE * 0.5] as const, r: [0, 0, Math.PI * 0.5] as const },
        { p: [0, -CARRIER_SIZE * 0.5, CARRIER_SIZE * 0.5] as const, r: [0, 0, Math.PI * 0.5] as const },
        { p: [-CARRIER_SIZE * 0.5, -CARRIER_SIZE * 0.5, 0] as const, r: [Math.PI * 0.5, 0, 0] as const },
        { p: [CARRIER_SIZE * 0.5, -CARRIER_SIZE * 0.5, 0] as const, r: [Math.PI * 0.5, 0, 0] as const },
        { p: [-CARRIER_SIZE * 0.5, 0, -CARRIER_SIZE * 0.5] as const, r: [0, 0, 0] as const },
        { p: [CARRIER_SIZE * 0.5, 0, -CARRIER_SIZE * 0.5] as const, r: [0, 0, 0] as const },
        { p: [-CARRIER_SIZE * 0.5, 0, CARRIER_SIZE * 0.5] as const, r: [0, 0, 0] as const },
        { p: [CARRIER_SIZE * 0.5, 0, CARRIER_SIZE * 0.5] as const, r: [0, 0, 0] as const },
      ];
      for (const def of positions) {
        const bar = new THREE.Mesh(barGeo.clone(), mat);
        bar.position.set(def.p[0], def.p[1], def.p[2]);
        bar.rotation.set(def.r[0], def.r[1], def.r[2]);
        group.add(bar);
      }
      break;
    }
  }

  return group;
}

// ===========================================================================
// EDITOR STATE
// ===========================================================================

interface PortState {
  occupied: boolean;
  childId: number | null;
}

interface EditorPart {
  id: number;
  type: string;
  mesh: THREE.Group;
  parentId: number | null;
  parentPort: string | null;
  ports: Record<string, PortState>;
  worldPos: THREE.Vector3;
}

interface PortMeshRef {
  mesh: THREE.Mesh;
  partId: number;
  portName: string;
}

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGPURenderer;
let controls: OrbitControls;
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
let hoveredPort: PortMeshRef | null = null;
let hoveredPart: EditorPart | null = null;

class EditorState {
  parts: EditorPart[] = [];
  nextId = 0;
  history: number[] = [];
  symmetryOn = false;
  selectedPartType: string | null = null;
  ghostMesh: THREE.Group | null = null;
  timerStart = performance.now();
  portMeshes: PortMeshRef[] = [];
  testWalkActive = false;

  reset(): void {
    for (const part of this.parts) {
      if (part.mesh) scene.remove(part.mesh);
    }
    for (const pm of this.portMeshes) {
      scene.remove(pm.mesh);
    }
    this.parts = [];
    this.nextId = 0;
    this.history = [];
    this.portMeshes = [];
    if (this.ghostMesh) {
      scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
    this.timerStart = performance.now();
  }

  getPartById(id: number): EditorPart | undefined {
    return this.parts.find(p => p.id === id);
  }

  addPart(type: string, parentId: number | null = null, parentPort: string | null = null): EditorPart {
    const id = this.nextId++;
    const mesh = createPartMesh(type);
    scene.add(mesh);

    const ports: Record<string, PortState> = {};
    for (const pn of PART_PORT_DEFS[type]) {
      ports[pn] = { occupied: false, childId: null };
    }

    const part: EditorPart = {
      id, type, mesh, parentId, parentPort, ports,
      worldPos: new THREE.Vector3()
    };

    if (parentId !== null && parentPort !== null) {
      const parent = this.getPartById(parentId);
      if (parent) {
        parent.ports[parentPort].occupied = true;
        parent.ports[parentPort].childId = id;

        const childPort = OPPOSITE_PORT[parentPort];
        if (part.ports[childPort]) {
          part.ports[childPort].occupied = true;
          part.ports[childPort].childId = parentId;
        }

        const parentOffset = getPortOffset(parent.type, parentPort);
        const childOffset = getPortOffset(type, childPort);
        const worldPos = parent.mesh.position.clone()
          .add(parentOffset)
          .sub(childOffset);
        mesh.position.copy(worldPos);
        part.worldPos.copy(worldPos);

        this._orientPart(part, parentPort);
      }
    } else {
      mesh.position.set(0, 0, 0);
      part.worldPos.set(0, 0, 0);
    }

    this.parts.push(part);
    this.history.push(id);
    this._rebuildPorts();
    updateStatsDisplay();

    this._animateSnap(mesh);
    return part;
  }

  _orientPart(part: EditorPart, parentPort: string): void {
    const mesh = part.mesh;
    switch (part.type) {
      case 'leg':
        if (parentPort === 'left') mesh.rotation.z = Math.PI * LEG_SPLAY_ANGLE;
        else if (parentPort === 'right') mesh.rotation.z = -Math.PI * LEG_SPLAY_ANGLE;
        else if (parentPort === 'front') mesh.rotation.x = -Math.PI * LEG_TILT_ANGLE;
        else if (parentPort === 'back') mesh.rotation.x = Math.PI * LEG_TILT_ANGLE;
        break;
      case 'antenna':
        if (parentPort === 'front') mesh.rotation.x = -Math.PI * ANTENNA_FRONT_TILT;
        else if (parentPort === 'left') mesh.rotation.z = Math.PI * ANTENNA_SIDE_TILT;
        else if (parentPort === 'right') mesh.rotation.z = -Math.PI * ANTENNA_SIDE_TILT;
        break;
      case 'wing':
        if (parentPort === 'left') {
          mesh.scale.x = -1;
          mesh.rotation.z = Math.PI * WING_TILT_ANGLE;
        } else if (parentPort === 'right') {
          mesh.rotation.z = -Math.PI * WING_TILT_ANGLE;
        }
        break;
      case 'stinger':
        if (parentPort === 'bottom') mesh.rotation.x = Math.PI * 0.5;
        break;
      case 'mandible':
        if (parentPort === 'back') mesh.rotation.y = Math.PI;
        break;
    }
  }

  _animateSnap(mesh: THREE.Group): void {
    const startTime = performance.now();
    mesh.scale.setScalar(SNAP_INITIAL_SCALE);

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / SNAP_DURATION_MS, 1);
      const eased = t < 0.5
        ? 2 * t * t
        : 1 + (SNAP_SCALE_OVERSHOOT - 1) * Math.sin(t * Math.PI) * (1 - t);
      const s = SNAP_INITIAL_SCALE + (1 - SNAP_INITIAL_SCALE) * Math.min(eased, SNAP_SCALE_OVERSHOOT);
      mesh.scale.setScalar(s);
      if (t < 1) requestAnimationFrame(animate);
      else mesh.scale.setScalar(1);
    };
    requestAnimationFrame(animate);
  }

  removePart(id: number): void {
    const part = this.getPartById(id);
    if (!part || part.type === 'core') return;

    const toRemove = this._collectDescendants(id);
    toRemove.push(id);

    for (const removeId of toRemove) {
      const p = this.getPartById(removeId);
      if (!p) continue;

      if (p.parentId !== null) {
        const parent = this.getPartById(p.parentId);
        if (parent && p.parentPort && parent.ports[p.parentPort]) {
          parent.ports[p.parentPort].occupied = false;
          parent.ports[p.parentPort].childId = null;
        }
      }

      scene.remove(p.mesh);
      this.parts = this.parts.filter(x => x.id !== removeId);
      this.history = this.history.filter(x => x !== removeId);
    }

    this._rebuildPorts();
    updateStatsDisplay();
  }

  _collectDescendants(parentId: number): number[] {
    const children = this.parts.filter(p => p.parentId === parentId).map(p => p.id);
    const all = [...children];
    for (const cid of children) {
      all.push(...this._collectDescendants(cid));
    }
    return all;
  }

  undo(): void {
    if (this.history.length <= 1) return;
    const lastId = this.history[this.history.length - 1];
    this.removePart(lastId);
  }

  _rebuildPorts(): void {
    for (const pm of this.portMeshes) {
      scene.remove(pm.mesh);
    }
    this.portMeshes = [];

    const portGeo = new THREE.SphereGeometry(PORT_RADIUS, PORT_SEGMENTS, PORT_SEGMENTS);
    const portMat = new THREE.MeshStandardMaterial({
      color: PORT_COLOR,
      emissive: new THREE.Color(PORT_COLOR),
      emissiveIntensity: PORT_EMISSIVE_INTENSITY,
      transparent: true,
      opacity: PORT_INITIAL_OPACITY
    });

    for (const part of this.parts) {
      for (const [portName, portState] of Object.entries(part.ports)) {
        if (portState.occupied) continue;

        const mesh = new THREE.Mesh(portGeo, portMat.clone());
        const offset = getPortOffset(part.type, portName);
        mesh.position.copy(part.mesh.position).add(offset);
        scene.add(mesh);

        this.portMeshes.push({ mesh, partId: part.id, portName });
      }
    }
  }

  findNearestPort(worldPos: THREE.Vector3): PortMeshRef | null {
    let best: PortMeshRef | null = null;
    let bestDist = RAYCASTER_PORT_THRESHOLD;

    for (const pm of this.portMeshes) {
      const d = pm.mesh.position.distanceTo(worldPos);
      if (d < bestDist) {
        bestDist = d;
        best = pm;
      }
    }
    return best;
  }

  loadPreset(preset: PresetDesign): void {
    this.reset();
    for (const pd of preset.parts) {
      if (pd.t === 'core') {
        this.addPart('core');
      } else {
        this.addPart(pd.t, pd.p!, pd.port!);
      }
    }
  }

  loadBlueprint(blueprintJson: string): void {
    try {
      const data = JSON.parse(blueprintJson);
      if (!data || !data.parts) return;
      this.reset();
      for (const pd of data.parts) {
        if (pd.t === 'core') {
          this.addPart('core');
        } else {
          this.addPart(pd.t, pd.p, pd.port);
        }
      }
    } catch (e) {
      console.error('Failed to load blueprint:', e);
      showToast('Failed to load creature blueprint');
    }
  }

  exportJSON(): string {
    const result = {
      v: 1,
      name: 'Unnamed',
      parts: this.parts.map(p => {
        const entry: any = { t: p.type, id: p.id };
        if (p.parentId !== null) {
          entry.p = p.parentId;
          entry.port = p.parentPort;
          entry.c = 'ball_joint';
        }
        return entry;
      })
    };
    return JSON.stringify(result, null, 2);
  }
}

// ===========================================================================
// STATS COMPUTATION
// ===========================================================================

interface CreatureStats {
  speed: number;
  hp: number;
  dps: number;
  vision: number;
  carry: number;
  cost: number;
  legCount: number;
}

function computeStats(es: EditorState): CreatureStats {
  const counts: Record<string, number> = {};
  for (const p of es.parts) {
    counts[p.type] = (counts[p.type] || 0) + 1;
  }

  const legCount = counts.leg || 0;
  let speed = BASE_SPEED;
  for (let i = 0; i < legCount; i++) {
    speed += i < SPEED_DIMINISHING_THRESHOLD ? SPEED_PER_LEG : SPEED_DIMINISHING_VALUE;
  }

  const hp = BASE_HP
    + (counts.segment || 0) * HP_PER_SEGMENT
    + (counts.joint || 0) * HP_PER_JOINT
    + (counts.shell || 0) * HP_PER_SHELL;

  const dps = (counts.mandible || 0) * DPS_PER_MANDIBLE
    + (counts.stinger || 0) * DPS_PER_STINGER;

  const vision = (counts.eye || 0) * VISION_PER_EYE
    + (counts.antenna || 0) * VISION_PER_ANTENNA;

  const carry = (counts.carrier || 0) * CARRY_PER_CARRIER;

  let cost = 0;
  for (const p of es.parts) {
    cost += PART_COSTS[p.type] || 0;
  }

  return { speed, hp, dps, vision, carry, cost, legCount };
}

function statsToJson(stats: CreatureStats): string {
  return JSON.stringify({
    speed: stats.speed,
    hp: stats.hp,
    dps: stats.dps,
    vision: stats.vision,
    carry: stats.carry,
    cost: stats.cost,
  });
}

// ===========================================================================
// GLOBAL STATE
// ===========================================================================

let editorState: EditorState;
let conn: DbConnection | null = null;
let myIdentity: string | null = null;

/** The SpacetimeDB ID of the creature currently loaded in the editor (for updates) */
let loadedCreatureId: bigint | null = null;

/** Local mirror of creature designs from SpacetimeDB */
const designRows = new Map<bigint, CreatureDesignRow>();
const playerMap = new Map<string, Player>();

// ===========================================================================
// SPACETIMEDB CONNECTION
// ===========================================================================

const connStatusEl = document.getElementById('conn-status')!;
const deployBtn = document.getElementById('deploy-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;
const updateBtn = document.getElementById('btn-update') as HTMLButtonElement;

function connectToSTDB(token?: string): void {
  conn = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DATABASE)
    .withToken(token)
    .onConnect((connection, identity, newToken) => {
      myIdentity = identity.toHexString();
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
      connStatusEl.textContent = 'Connected';
      connStatusEl.style.color = '#4ade80';
      saveBtn.disabled = false;

      connection.subscriptionBuilder()
        .onApplied(() => {
          console.info('[stdb] Subscriptions active');
          rebuildMyCreaturesList();
          rebuildCommunityList();

          // Auto-load last deployed creature
          autoLoadDeployed();
        })
        .onError((_ctx: unknown, err: unknown) => console.error(`Sub error: ${err}`))
        .subscribe([
          'SELECT * FROM player',
          'SELECT * FROM creature_design',
        ]);
    })
    .onConnectError((_ctx: unknown, err: unknown) => {
      connStatusEl.textContent = 'Reconnecting...';
      connStatusEl.style.color = '#f87171';
      console.error(`Connection error: ${err}`);

      if (token) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
      } else {
        setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
      }
    })
    .onDisconnect(() => {
      connStatusEl.textContent = 'Disconnected';
      connStatusEl.style.color = '#f87171';
      saveBtn.disabled = true;
      setTimeout(() => connectToSTDB(localStorage.getItem(AUTH_TOKEN_KEY) || undefined), RECONNECT_DELAY_MS);
    })
    .build();

  // Player callbacks
  conn.db.player.onInsert((_ctx: unknown, row: Player) => {
    playerMap.set(row.identity.toHexString(), row);
    rebuildCommunityList();
  });
  conn.db.player.onUpdate((_ctx: unknown, _old: Player, row: Player) => {
    playerMap.set(row.identity.toHexString(), row);
    rebuildCommunityList();
  });
  conn.db.player.onDelete((_ctx: unknown, row: Player) => {
    playerMap.delete(row.identity.toHexString());
    rebuildCommunityList();
  });

  // CreatureDesign callbacks
  conn.db.creatureDesign.onInsert((_ctx: unknown, row: CreatureDesignRow) => {
    designRows.set(row.id, row);
    rebuildMyCreaturesList();
    rebuildCommunityList();
  });
  conn.db.creatureDesign.onUpdate((_ctx: unknown, _old: CreatureDesignRow, row: CreatureDesignRow) => {
    designRows.set(row.id, row);
    rebuildMyCreaturesList();
    rebuildCommunityList();
  });
  conn.db.creatureDesign.onDelete((_ctx: unknown, row: CreatureDesignRow) => {
    designRows.delete(row.id);
    if (loadedCreatureId === row.id) {
      loadedCreatureId = null;
      updateBtn.style.display = 'none';
    }
    rebuildMyCreaturesList();
    rebuildCommunityList();
  });
}

/**
 * After subscription is applied, load the player's deployed creature (if any)
 * into the editor. This is the kill condition: reload tab -> creature loaded.
 */
function autoLoadDeployed(): void {
  if (!myIdentity) return;

  for (const row of designRows.values()) {
    if (row.owner.toHexString() === myIdentity && row.deployed) {
      editorState.loadBlueprint(row.blueprint);
      loadedCreatureId = row.id;

      const nameInput = document.getElementById('creature-name-input') as HTMLInputElement;
      nameInput.value = row.name;

      updateBtn.style.display = 'block';
      deployBtn.disabled = false;
      showToast(`Loaded deployed creature: ${row.name}`);
      return;
    }
  }
}

// ===========================================================================
// SPACETIMEDB ACTIONS
// ===========================================================================

function saveCreature(): void {
  if (!conn) return;

  const nameInput = document.getElementById('creature-name-input') as HTMLInputElement;
  const name = nameInput.value.trim() || 'Unnamed';
  const blueprint = editorState.exportJSON();
  const stats = computeStats(editorState);
  const sJson = statsToJson(stats);

  conn.reducers.saveCreature({ name, blueprint, statsJson: sJson });
  showToast(`Saving "${name}"...`);

  // After save, we'll pick up the new ID from the onInsert callback.
  // For now, clear the loaded ID so the user can save again as a new design.
  loadedCreatureId = null;
  updateBtn.style.display = 'none';
}

function updateCreature(): void {
  if (!conn || loadedCreatureId === null) return;

  const nameInput = document.getElementById('creature-name-input') as HTMLInputElement;
  const name = nameInput.value.trim() || 'Unnamed';
  const blueprint = editorState.exportJSON();
  const stats = computeStats(editorState);
  const sJson = statsToJson(stats);

  conn.reducers.updateCreature({ id: loadedCreatureId, name, blueprint, statsJson: sJson });
  showToast(`Updating "${name}"...`);
}

function deleteCreature(id: bigint): void {
  if (!conn) return;
  conn.reducers.deleteCreature({ id });
  showToast('Deleting creature...');
}

function deployCreature(id: bigint): void {
  if (!conn) return;
  conn.reducers.deployCreature({ id });
  showToast('Deploying creature...');
}

function loadCreatureIntoEditor(row: CreatureDesignRow): void {
  editorState.loadBlueprint(row.blueprint);
  loadedCreatureId = row.id;

  const nameInput = document.getElementById('creature-name-input') as HTMLInputElement;
  nameInput.value = row.name;

  updateBtn.style.display = 'block';
  deployBtn.disabled = false;
  showToast(`Loaded: ${row.name}`);
}

// ===========================================================================
// UI: MY CREATURES LIST
// ===========================================================================

function rebuildMyCreaturesList(): void {
  const container = document.getElementById('my-creatures-list')!;
  container.innerHTML = '';

  if (!myIdentity) return;

  const myDesigns: CreatureDesignRow[] = [];
  for (const row of designRows.values()) {
    if (row.owner.toHexString() === myIdentity) {
      myDesigns.push(row);
    }
  }

  // Sort by updated_at descending
  myDesigns.sort((a, b) => Number(b.updatedAt - a.updatedAt));

  if (myDesigns.length === 0) {
    container.innerHTML = '<div style="font-size:11px;color:#555;padding:4px 0;">No saved creatures yet</div>';
    return;
  }

  for (const row of myDesigns) {
    const card = document.createElement('div');
    card.className = 'creature-card' + (row.deployed ? ' deployed' : '');

    let statsInfo = '';
    try {
      const s = JSON.parse(row.statsJson);
      statsInfo = `Spd:${s.speed?.toFixed?.(0) || '?'} HP:${s.hp || '?'} Cost:${s.cost || '?'}`;
    } catch { statsInfo = ''; }

    card.innerHTML = `
      <div class="card-name">${escapeHtml(row.name)}</div>
      <div class="card-meta">
        ${statsInfo}
        ${row.deployed ? '<span class="deploy-badge">Deployed</span>' : ''}
      </div>
      <div class="card-actions">
        <button class="load-btn">Load</button>
        <button class="deploy-card-btn">${row.deployed ? 'Deployed' : 'Deploy'}</button>
        <button class="delete-btn">Del</button>
      </div>
    `;

    const loadBtn = card.querySelector('.load-btn')!;
    loadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadCreatureIntoEditor(row);
    });

    const deployCardBtn = card.querySelector('.deploy-card-btn')!;
    deployCardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deployCreature(row.id);
    });

    const deleteBtn = card.querySelector('.delete-btn')!;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCreature(row.id);
    });

    card.addEventListener('click', () => loadCreatureIntoEditor(row));
    container.appendChild(card);
  }
}

// ===========================================================================
// UI: COMMUNITY LIST
// ===========================================================================

function rebuildCommunityList(): void {
  const container = document.getElementById('community-list')!;
  container.innerHTML = '';

  const communityDesigns: Array<{ row: CreatureDesignRow; playerName: string }> = [];
  for (const row of designRows.values()) {
    const ownerHex = row.owner.toHexString();
    if (ownerHex === myIdentity) continue;
    if (!row.deployed) continue;

    const player = playerMap.get(ownerHex);
    const playerName = player?.name || ownerHex.slice(0, 8);
    communityDesigns.push({ row, playerName });
  }

  if (communityDesigns.length === 0) {
    container.innerHTML = '<div style="font-size:11px;color:#555;padding:4px 0;">No community creatures yet</div>';
    return;
  }

  for (const { row, playerName } of communityDesigns) {
    const card = document.createElement('div');
    card.className = 'community-card';

    let statsInfo = '';
    try {
      const s = JSON.parse(row.statsJson);
      statsInfo = `Spd:${s.speed?.toFixed?.(0) || '?'} HP:${s.hp || '?'}`;
    } catch { statsInfo = ''; }

    card.innerHTML = `
      <div class="card-name">${escapeHtml(row.name)}</div>
      <div class="card-meta">by ${escapeHtml(playerName)} ${statsInfo}</div>
    `;

    card.addEventListener('click', () => {
      // Load a copy into editor (read-only source, but user can edit freely)
      editorState.loadBlueprint(row.blueprint);
      loadedCreatureId = null; // Not owned, can't update
      updateBtn.style.display = 'none';

      const nameInput = document.getElementById('creature-name-input') as HTMLInputElement;
      nameInput.value = row.name + ' (copy)';
      deployBtn.disabled = false;
      showToast(`Loaded community creature: ${row.name} (copy)`);
    });

    container.appendChild(card);
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===========================================================================
// UI: STATS & PARTS PANELS
// ===========================================================================

function updateStatsDisplay(): void {
  if (!editorState) return;
  const stats = computeStats(editorState);

  const statsSection = document.getElementById('stats-section')!;
  statsSection.innerHTML = '<h3>Stats</h3>';

  const statDefs = [
    { label: 'Speed', value: stats.speed.toFixed(1), max: STAT_MAX_SPEED, color: '#4fc3f7' },
    { label: 'HP', value: String(stats.hp), max: STAT_MAX_HP, color: '#66bb6a' },
    { label: 'DPS', value: stats.dps.toFixed(1), max: STAT_MAX_DPS, color: '#ef5350' },
    { label: 'Vision', value: String(stats.vision), max: STAT_MAX_VISION, color: '#ab47bc' },
    { label: 'Carry', value: String(stats.carry), max: STAT_MAX_CARRY, color: '#ffa726' },
    { label: 'Cost', value: String(stats.cost), max: STAT_MAX_COST, color: '#78909c' }
  ];

  for (const sd of statDefs) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML = `<label>${sd.label}</label><span class="value">${sd.value}</span>`;
    statsSection.appendChild(row);

    const bar = document.createElement('div');
    bar.className = 'stat-bar-bg';
    const pct = Math.min(100, (parseFloat(sd.value) / sd.max) * 100);
    bar.innerHTML = `<div class="stat-bar-fill" style="width:${pct}%;background:${sd.color}"></div>`;
    statsSection.appendChild(bar);
  }

  // Locomotion section
  const locoSection = document.getElementById('locomotion-section')!;
  locoSection.innerHTML = '<h3>Locomotion</h3>';
  const legRow = document.createElement('div');
  legRow.className = 'stat-row';
  legRow.innerHTML = `<label>Legs</label><span class="value">${stats.legCount}</span>`;
  locoSection.appendChild(legRow);
  const groundRow = document.createElement('div');
  groundRow.className = 'stat-row';
  groundRow.innerHTML = `<label>Ground Speed</label><span class="value">${stats.speed.toFixed(1)}</span>`;
  locoSection.appendChild(groundRow);
  const partCountRow = document.createElement('div');
  partCountRow.className = 'stat-row';
  partCountRow.innerHTML = `<label>Parts</label><span class="value">${editorState.parts.length}</span>`;
  locoSection.appendChild(partCountRow);
}

function buildPartsPanel(): void {
  const section = document.getElementById('parts-section')!;
  const partTypes = ['core', 'segment', 'joint', 'leg', 'shell', 'antenna', 'mandible', 'eye', 'wing', 'stinger', 'carrier'];

  for (const pt of partTypes) {
    const btn = document.createElement('button');
    btn.className = 'part-btn';
    btn.dataset.partType = pt;

    const dot = document.createElement('span');
    dot.className = 'part-dot';
    dot.style.background = getPartDotColor(pt);

    const label = document.createElement('span');
    label.textContent = pt.charAt(0).toUpperCase() + pt.slice(1);

    const cost = document.createElement('span');
    cost.className = 'cost-badge';
    cost.textContent = String(PART_COSTS[pt]);

    btn.appendChild(dot);
    btn.appendChild(label);
    btn.appendChild(cost);

    btn.addEventListener('click', () => selectPartType(pt));
    section.appendChild(btn);
  }
}

function buildDesignsPanel(): void {
  const section = document.getElementById('designs-section')!;
  for (const preset of PRESET_DESIGNS) {
    const btn = document.createElement('button');
    btn.className = 'design-btn';
    btn.textContent = preset.name;
    btn.addEventListener('click', () => {
      editorState.loadPreset(preset);
      loadedCreatureId = null;
      updateBtn.style.display = 'none';
      showToast(`Loaded: ${preset.name}`);
    });
    section.appendChild(btn);
  }
}

function selectPartType(type: string): void {
  if (editorState.selectedPartType === type) {
    editorState.selectedPartType = null;
    clearGhost();
    updatePartButtons();
    return;
  }

  if (type === 'core') {
    showToast('Only one core per creature');
    return;
  }

  editorState.selectedPartType = type;
  updatePartButtons();

  clearGhost();
  editorState.ghostMesh = createPartMesh(type, true);
  editorState.ghostMesh.visible = false;
  scene.add(editorState.ghostMesh);
}

function clearGhost(): void {
  if (editorState.ghostMesh) {
    scene.remove(editorState.ghostMesh);
    editorState.ghostMesh = null;
  }
}

function updatePartButtons(): void {
  const btns = document.querySelectorAll('.part-btn');
  btns.forEach(btn => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.partType === editorState.selectedPartType);
  });
}

// ===========================================================================
// INPUT HANDLING
// ===========================================================================

function onMouseMove(e: MouseEvent): void {
  if (editorState.testWalkActive) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseNDC, camera);

  if (hoveredPort) {
    (hoveredPort.mesh.material as THREE.MeshStandardMaterial).color.setHex(PORT_COLOR);
    (hoveredPort.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(PORT_COLOR);
    hoveredPort.mesh.scale.setScalar(1);
    hoveredPort = null;
  }

  hoveredPart = null;
  let hoveredPartDist = Infinity;
  for (const part of editorState.parts) {
    if (part.type === 'core') continue;
    const dist = raycaster.ray.distanceToPoint(part.mesh.position);
    if (dist < RIGHT_CLICK_DETACH_THRESHOLD && dist < hoveredPartDist) {
      hoveredPartDist = dist;
      hoveredPart = part;
    }
  }

  if (!editorState.selectedPartType) {
    if (editorState.ghostMesh) editorState.ghostMesh.visible = false;
    return;
  }

  let bestPort: PortMeshRef | null = null;
  let bestDist = Infinity;

  for (const pm of editorState.portMeshes) {
    const part = editorState.getPartById(pm.partId);
    if (!part || part.ports[pm.portName].occupied) continue;

    const dist = raycaster.ray.distanceToPoint(pm.mesh.position);
    if (dist < RAYCASTER_PORT_THRESHOLD && dist < bestDist) {
      bestDist = dist;
      bestPort = pm;
    }
  }

  if (bestPort) {
    hoveredPort = bestPort;
    (hoveredPort.mesh.material as THREE.MeshStandardMaterial).color.setHex(PORT_HOVER_COLOR);
    (hoveredPort.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(PORT_HOVER_COLOR);
    hoveredPort.mesh.scale.setScalar(PORT_HOVER_SCALE);

    if (editorState.ghostMesh) {
      const parentPart = editorState.getPartById(bestPort.partId);
      if (parentPart) {
        const parentOffset = getPortOffset(parentPart.type, bestPort.portName);
        const childPort = OPPOSITE_PORT[bestPort.portName];
        const childOffset = getPortOffset(editorState.selectedPartType!, childPort);
        editorState.ghostMesh.position.copy(parentPart.mesh.position)
          .add(parentOffset).sub(childOffset);
        editorState.ghostMesh.visible = true;
      }
    }
  } else {
    if (editorState.ghostMesh) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersection)) {
        editorState.ghostMesh.position.copy(intersection);
        editorState.ghostMesh.visible = true;
      } else {
        editorState.ghostMesh.visible = false;
      }
    }
  }
}

function onViewportClick(_e: MouseEvent): void {
  if (editorState.testWalkActive) return;
  if (!editorState.selectedPartType) return;
  if (!hoveredPort) return;

  const parentId = hoveredPort.partId;
  const parentPort = hoveredPort.portName;
  const partType = editorState.selectedPartType;

  editorState.addPart(partType, parentId, parentPort);

  if (editorState.symmetryOn) {
    const mirrorPort = MIRROR_PORT[parentPort];
    if (mirrorPort !== parentPort) {
      const parent = editorState.getPartById(parentId);
      if (parent && parent.ports[mirrorPort] && !parent.ports[mirrorPort].occupied) {
        editorState.addPart(partType, parentId, mirrorPort);
      }
    }
  }

  hoveredPort = null;
}

function onRightClick(e: MouseEvent): void {
  e.preventDefault();
  if (editorState.testWalkActive) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseNDC, camera);

  let bestPart: EditorPart | null = null;
  let bestDist = Infinity;

  for (const part of editorState.parts) {
    if (part.type === 'core') continue;
    const dist = raycaster.ray.distanceToPoint(part.mesh.position);
    if (dist < RIGHT_CLICK_DETACH_THRESHOLD && dist < bestDist) {
      bestDist = dist;
      bestPart = part;
    }
  }

  if (bestPart) {
    editorState.removePart(bestPart.id);
    showToast(`Removed ${bestPart.type}`);
  }
}

function onKeyDown(e: KeyboardEvent): void {
  // Don't capture when typing in the name input
  if ((e.target as HTMLElement).tagName === 'INPUT') return;

  if (e.key === 's' || e.key === 'S') {
    editorState.symmetryOn = !editorState.symmetryOn;
    const badge = document.getElementById('symmetry-badge')!;
    badge.textContent = `Symmetry: ${editorState.symmetryOn ? 'ON' : 'OFF'} \u00B7 [S]`;
    badge.classList.toggle('on', editorState.symmetryOn);
  }
  if (e.key === 'Escape') {
    editorState.selectedPartType = null;
    clearGhost();
    updatePartButtons();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (editorState.testWalkActive) return;
    e.preventDefault();
    if (hoveredPart) {
      editorState.removePart(hoveredPart.id);
      showToast(`Removed ${hoveredPart.type}`);
      hoveredPart = null;
    } else {
      editorState.undo();
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    editorState.undo();
  }
}

function onResize(): void {
  const viewport = document.getElementById('viewport')!;
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// ===========================================================================
// 2-BONE ANALYTICAL IK
// ===========================================================================

function solve2BoneIK(hip: THREE.Vector3, foot: THREE.Vector3, upperLen: number, lowerLen: number, poleDir: THREE.Vector3): THREE.Vector3 {
  const hipToFoot = new THREE.Vector3().subVectors(foot, hip);
  const dist = hipToFoot.length();
  const reach = upperLen + lowerLen;

  if (dist >= reach - 0.001) {
    const dir = hipToFoot.clone().normalize();
    return hip.clone().add(dir.multiplyScalar(upperLen));
  }

  if (dist < 0.01) {
    return hip.clone().add(poleDir.clone().normalize().multiplyScalar(upperLen));
  }

  const cosA = (upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * dist);
  const hipAngle = Math.acos(Math.max(-1, Math.min(1, cosA)));

  const fwd = hipToFoot.clone().normalize();

  let bendAxis = new THREE.Vector3().crossVectors(fwd, poleDir).normalize();
  if (bendAxis.lengthSq() < 0.0001) {
    const fallback = Math.abs(fwd.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    bendAxis.crossVectors(fwd, fallback).normalize();
  }

  const upperDir = fwd.clone().applyAxisAngle(bendAxis, hipAngle);
  return hip.clone().add(upperDir.multiplyScalar(upperLen));
}

// ===========================================================================
// TEST WALK
// ===========================================================================

interface LegIKState {
  part: EditorPart;
  parentPart: EditorPart;
  parentPort: string;
  footPos: THREE.Vector3;
  plantedPos: THREE.Vector3;
  stepping: boolean;
  stepStart: number;
  stepFrom: THREE.Vector3;
  stepTo: THREE.Vector3;
  gaitGroup: number;
  _hipWorld?: THREE.Vector3;
  _idealFoot?: THREE.Vector3;
}

interface WalkState {
  bodyGroup: THREE.Group;
  ground: THREE.Mesh;
  legIK: LegIKState[];
  originalPositions: THREE.Vector3[];
  originalRotations: THREE.Euler[];
  startTime: number;
  angle: number;
}

let walkState: WalkState | null = null;

function startTestWalk(): void {
  if (editorState.testWalkActive) return;

  const legs = editorState.parts.filter(p => p.type === 'leg');
  if (legs.length === 0) {
    showToast('No legs to walk with!');
    return;
  }

  editorState.testWalkActive = true;

  for (const pm of editorState.portMeshes) pm.mesh.visible = false;
  clearGhost();
  editorState.selectedPartType = null;
  updatePartButtons();

  const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
  const groundMat = new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: GROUND_WALK_ROUGHNESS });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.y = TEST_WALK_GROUND_Y;
  scene.add(ground);

  const originalPositions: THREE.Vector3[] = [];
  const originalRotations: THREE.Euler[] = [];
  for (const part of editorState.parts) {
    originalPositions.push(part.mesh.position.clone());
    originalRotations.push(part.mesh.rotation.clone());
  }

  const bodyGroup = new THREE.Group();
  scene.add(bodyGroup);

  for (const part of editorState.parts) {
    if (part.type !== 'leg') {
      bodyGroup.add(part.mesh);
    }
  }

  const LEG_REACH = LEG_UPPER_LEN + LEG_LOWER_LEN;
  bodyGroup.position.y = TEST_WALK_GROUND_Y + LEG_REACH * WALK_BODY_HEIGHT_FACTOR;
  bodyGroup.updateMatrixWorld(true);

  const legIK: LegIKState[] = legs.map((leg, i) => {
    const parentPart = editorState.getPartById(leg.parentId!)!;
    const portOffset = getPortOffset(parentPart.type, leg.parentPort!);
    const hipWorld = parentPart.mesh.localToWorld(portOffset.clone());

    const portDir = new THREE.Vector3(PORT_DIRS[leg.parentPort!][0], PORT_DIRS[leg.parentPort!][1], PORT_DIRS[leg.parentPort!][2]);
    const spreadDir = portDir.clone();
    spreadDir.y = 0;
    if (spreadDir.lengthSq() < 0.001) {
      const outward = hipWorld.clone();
      outward.y = 0;
      outward.sub(new THREE.Vector3(bodyGroup.position.x, 0, bodyGroup.position.z));
      if (outward.lengthSq() > 0.001) spreadDir.copy(outward.normalize());
      else spreadDir.set(0, 0, 1);
    } else {
      spreadDir.normalize();
      spreadDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), bodyGroup.rotation.y);
    }

    const footWorld = hipWorld.clone();
    footWorld.y = TEST_WALK_GROUND_Y;
    footWorld.addScaledVector(spreadDir, (LEG_UPPER_LEN + LEG_LOWER_LEN) * WALK_FOOT_SPREAD_FACTOR);

    leg.mesh.position.copy(hipWorld);
    leg.mesh.rotation.set(0, 0, 0);
    leg.mesh.updateMatrixWorld(true);

    return {
      part: leg,
      parentPart,
      parentPort: leg.parentPort!,
      footPos: footWorld.clone(),
      plantedPos: footWorld.clone(),
      stepping: false,
      stepStart: 0,
      stepFrom: new THREE.Vector3(),
      stepTo: new THREE.Vector3(),
      gaitGroup: i % 2,
    };
  });

  walkState = {
    bodyGroup,
    ground,
    legIK,
    originalPositions,
    originalRotations,
    startTime: performance.now(),
    angle: 0,
  };

  showToast('Test walk! (5 seconds)');
}

function updateTestWalk(dt: number): void {
  if (!walkState) return;

  const elapsed = (performance.now() - walkState.startTime) / 1000;
  if (elapsed > TEST_WALK_DURATION_S) {
    endTestWalk();
    return;
  }

  walkState.angle += TEST_WALK_SPEED * dt;
  const bx = Math.sin(walkState.angle) * TEST_WALK_CIRCLE_RADIUS;
  const bz = Math.cos(walkState.angle) * TEST_WALK_CIRCLE_RADIUS;

  const steppingCount = walkState.legIK.filter(l => l.stepping).length;
  const bob = steppingCount > 0
    ? Math.sin(performance.now() * BOB_SPEED) * BOB_AMPLITUDE
    : 0;

  walkState.bodyGroup.position.x = bx;
  walkState.bodyGroup.position.z = bz;
  const LEG_REACH = LEG_UPPER_LEN + LEG_LOWER_LEN;
  walkState.bodyGroup.position.y = TEST_WALK_GROUND_Y + LEG_REACH * WALK_BODY_HEIGHT_FACTOR + bob;
  walkState.bodyGroup.rotation.y = walkState.angle + Math.PI;
  walkState.bodyGroup.updateMatrixWorld(true);

  const creatureFwd = new THREE.Vector3(
    Math.cos(walkState.angle), 0, -Math.sin(walkState.angle)
  ).normalize();

  const now = performance.now() / 1000;

  for (const leg of walkState.legIK) {
    const portOffset = getPortOffset(leg.parentPart.type, leg.parentPort);
    leg._hipWorld = leg.parentPart.mesh.localToWorld(portOffset.clone());

    const outward = leg._hipWorld.clone();
    outward.y = 0;
    outward.sub(new THREE.Vector3(bx, 0, bz));
    if (outward.lengthSq() > 0.001) outward.normalize();
    else outward.set(0, 0, 1);

    leg._idealFoot = leg._hipWorld.clone();
    leg._idealFoot.y = TEST_WALK_GROUND_Y;
    leg._idealFoot.addScaledVector(outward, (LEG_UPPER_LEN + LEG_LOWER_LEN) * WALK_FOOT_SPREAD_FACTOR);
    leg._idealFoot.addScaledVector(creatureFwd, STEP_THRESHOLD * STEP_PREDICT_FACTOR);
  }

  let anyGroupStepping = false;
  for (const leg of walkState.legIK) {
    if (leg.stepping) { anyGroupStepping = true; break; }
  }

  if (!anyGroupStepping) {
    let worstDist = 0;
    let worstGroup = -1;
    for (const leg of walkState.legIK) {
      const dist = leg.plantedPos.distanceTo(leg._idealFoot!);
      if (dist > STEP_THRESHOLD && dist > worstDist) {
        worstDist = dist;
        worstGroup = leg.gaitGroup;
      }
    }
    if (worstGroup >= 0) {
      for (const leg of walkState.legIK) {
        if (leg.gaitGroup === worstGroup) {
          leg.stepping = true;
          leg.stepStart = now;
          leg.stepFrom.copy(leg.plantedPos);
          leg.stepTo.copy(leg._idealFoot!);
        }
      }
    }
  }

  for (const leg of walkState.legIK) {
    if (leg.stepping) {
      const t = Math.min((now - leg.stepStart) / STEP_DURATION_S, 1);
      leg.footPos.lerpVectors(leg.stepFrom, leg.stepTo, t);
      leg.footPos.y = TEST_WALK_GROUND_Y + STEP_HEIGHT * PARABOLIC_PEAK_FACTOR * t * (1 - t);
      if (t >= 1) {
        leg.stepping = false;
        leg.footPos.copy(leg.stepTo);
        leg.plantedPos.copy(leg.stepTo);
      }
    } else {
      leg.footPos.copy(leg.plantedPos);
    }

    const hipWorld = leg._hipWorld!;

    leg.part.mesh.position.copy(hipWorld);
    leg.part.mesh.rotation.set(0, 0, 0);
    leg.part.mesh.updateMatrixWorld(true);

    const { upperBone, kneePivot } = leg.part.mesh.userData;
    if (!upperBone || !kneePivot) continue;

    const localFoot = leg.footPos.clone().sub(hipWorld);

    const kneePos = solve2BoneIK(
      new THREE.Vector3(0, 0, 0), localFoot,
      LEG_UPPER_LEN, LEG_LOWER_LEN,
      creatureFwd
    );

    const hipToKnee = kneePos.clone().normalize();
    if (hipToKnee.lengthSq() > 0.0001) {
      upperBone.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, -1, 0), hipToKnee
      );
    }

    const kneeToFoot = localFoot.clone().sub(kneePos);
    if (kneeToFoot.lengthSq() > 0.0001) {
      const invUpperQ = upperBone.quaternion.clone().invert();
      const localFootDir = kneeToFoot.normalize().applyQuaternion(invUpperQ);
      kneePivot.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, -1, 0), localFootDir
      );
    }
  }
}

function endTestWalk(): void {
  if (!walkState) return;

  for (const leg of walkState.legIK) {
    const { upperBone, kneePivot } = leg.part.mesh.userData;
    if (upperBone) upperBone.quaternion.identity();
    if (kneePivot) kneePivot.quaternion.identity();
  }

  for (let i = 0; i < editorState.parts.length; i++) {
    const part = editorState.parts[i];
    scene.add(part.mesh);
    part.mesh.position.copy(walkState.originalPositions[i]);
    part.mesh.rotation.copy(walkState.originalRotations[i]);
  }

  scene.remove(walkState.bodyGroup);
  scene.remove(walkState.ground);

  for (const pm of editorState.portMeshes) pm.mesh.visible = true;

  walkState = null;
  editorState.testWalkActive = false;
  showToast('Walk test complete');
}

// ===========================================================================
// ANIMATION LOOP
// ===========================================================================

let lastTime = performance.now();

function animate(): void {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, MAX_DELTA_TIME_S);
  lastTime = now;

  controls.update();

  // Pulse ports
  if (!editorState.testWalkActive) {
    const pulse = Math.sin(now * 0.001 * PORT_PULSE_SPEED);
    const opacity = PORT_PULSE_MIN_OPACITY + (PORT_PULSE_MAX_OPACITY - PORT_PULSE_MIN_OPACITY) * (pulse * 0.5 + 0.5);
    for (const pm of editorState.portMeshes) {
      if (pm !== hoveredPort) {
        (pm.mesh.material as THREE.MeshStandardMaterial).opacity = opacity;
      }
    }
  }

  // Update timer
  if (!editorState.testWalkActive) {
    const elapsed = (now - editorState.timerStart) / 1000;
    document.getElementById('timer-display')!.textContent = elapsed.toFixed(1) + 's';
  }

  // Test walk
  if (editorState.testWalkActive) {
    updateTestWalk(dt);
  }

  renderer.renderAsync(scene, camera);
}

// ===========================================================================
// INIT
// ===========================================================================

async function init(): Promise<void> {
  const viewport = document.getElementById('viewport')!;
  renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.setClearColor(BG_COLOR);
  viewport.appendChild(renderer.domElement);

  await renderer.init();

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    viewport.clientWidth / viewport.clientHeight,
    CAMERA_NEAR, CAMERA_FAR
  );
  camera.position.set(...CAMERA_INITIAL_POS);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = ORBIT_DAMPING;
  controls.target.set(0, 0, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, DIRECTIONAL_INTENSITY);
  dirLight.position.set(...DIRECTIONAL_POS);
  dirLight.castShadow = false;
  scene.add(dirLight);

  const hemiLight = new THREE.HemisphereLight(
    HEMISPHERE_SKY_COLOR, HEMISPHERE_GROUND_COLOR, HEMISPHERE_INTENSITY
  );
  scene.add(hemiLight);

  // Ground grid
  const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_DIVISIONS, GROUND_GRID_COLOR, GROUND_GRID_COLOR);
  grid.position.y = GROUND_Y;
  (grid.material as THREE.Material).opacity = GROUND_GRID_OPACITY;
  (grid.material as THREE.Material).transparent = true;
  scene.add(grid);

  // Editor state
  editorState = new EditorState();
  editorState.addPart('core');

  // Build UI
  buildPartsPanel();
  buildDesignsPanel();
  updateStatsDisplay();

  // Events
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onViewportClick);
  renderer.domElement.addEventListener('contextmenu', onRightClick);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  document.getElementById('btn-test-walk')!.addEventListener('click', startTestWalk);
  document.getElementById('btn-undo')!.addEventListener('click', () => editorState.undo());
  document.getElementById('btn-clear')!.addEventListener('click', () => {
    editorState.reset();
    editorState.addPart('core');
    loadedCreatureId = null;
    updateBtn.style.display = 'none';
    updateStatsDisplay();
    showToast('Cleared. Timer reset.');
  });
  document.getElementById('btn-export')!.addEventListener('click', () => {
    const json = editorState.exportJSON();
    navigator.clipboard.writeText(json).then(() => {
      showToast('JSON copied to clipboard!');
    }).catch(() => {
      console.log(json);
      showToast('JSON logged to console');
    });
  });

  // Save / Update / Deploy buttons
  saveBtn.addEventListener('click', () => saveCreature());
  updateBtn.addEventListener('click', () => updateCreature());
  deployBtn.addEventListener('click', () => {
    if (loadedCreatureId !== null) {
      // Deploy the currently loaded creature
      deployCreature(loadedCreatureId);
    } else {
      // Save first, then user can deploy from the list
      showToast('Save the creature first, then deploy from the list');
    }
  });

  // Connect to SpacetimeDB
  connectToSTDB(localStorage.getItem(AUTH_TOKEN_KEY) || undefined);

  // Start render loop
  animate();
}

// ===========================================================================
// BOOT
// ===========================================================================

init().catch(err => {
  console.error('Failed to initialize:', err);
  document.body.innerHTML = `<div style="color:red;padding:40px;font-size:18px;">
    Failed to initialize WebGPU renderer. Make sure you are using a WebGPU-capable browser.<br>
    Error: ${(err as Error).message}
  </div>`;
});
