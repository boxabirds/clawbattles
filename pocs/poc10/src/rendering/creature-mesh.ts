import * as THREE from 'three';
import type { PartInstance, PartDefinition, PartId } from '../simulation/types.js';
import { getPartDef } from '../simulation/catalog.js';

// ── Geometry constants ────────────────────────────────────────────

// Body
const BODY_SMALL_RADIUS = 0.85;
const BODY_SMALL_SCALE_Y = 0.8;
const BODY_SMALL_SCALE_Z = 1.15;
const BODY_LARGE_RADIUS = 1.2;
const BODY_LARGE_SCALE_Y = 0.9;
const BODY_LARGE_SCALE_Z = 1.0;
const BODY_SEGMENTS = 24;

// Legs
const LEG_RADIUS = 0.06;
const LEG_SHORT_HEIGHT_UPPER = 0.35;
const LEG_SHORT_HEIGHT_LOWER = 0.35;
const LEG_LONG_HEIGHT_UPPER = 0.5;
const LEG_LONG_HEIGHT_LOWER = 0.6;
const LEG_SPLAY_ANGLE = 0.6; // radians outward
const LEG_SHORT_KNEE_BEND = 0.15;
const LEG_LONG_KNEE_BEND = 0.3;
const KNEE_RADIUS = 0.04;

// Weapons
const CLAW_SMALL_RADIUS = 0.12;
const CLAW_SMALL_HEIGHT = 0.35;
const CLAW_LARGE_RADIUS = 0.18;
const CLAW_LARGE_HEIGHT = 0.5;
const SPIKE_RADIUS = 0.06;
const SPIKE_HEIGHT = 0.4;

// Sensors
const EYE_RADIUS = 0.1;
const ANTENNA_STEM_RADIUS = 0.02;
const ANTENNA_STEM_HEIGHT = 0.5;
const ANTENNA_TIP_RADIUS = 0.05;

// Armor & Shell
const ARMOR_PLATE_WIDTH = 0.5;
const ARMOR_PLATE_HEIGHT = 0.4;
const ARMOR_PLATE_DEPTH = 0.08;
const SHELL_RADIUS = 0.5;

// Materials
const PART_ROUGHNESS = 0.4;
const PART_METALNESS = 0.1;
const GHOST_OPACITY = 0.35;

// ── Color scheme ──────────────────────────────────────────────────

const BASE_HUE = 0.6; // cyan

interface PartColor {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
}

const CATEGORY_COLORS: Record<string, { hueShift: number; saturation: number; lightness: number }> = {
  core:          { hueShift: 0,     saturation: 0.45, lightness: 0.65 },
  locomotion:    { hueShift: 0.04,  saturation: 0.50, lightness: 0.60 },
  weapon:        { hueShift: -0.15, saturation: 0.60, lightness: 0.65 },
  armor:         { hueShift: 0.08,  saturation: 0.35, lightness: 0.55 },
  sensor:        { hueShift: -0.14, saturation: 0.65, lightness: 0.65 },
  passive_armor: { hueShift: 0.10,  saturation: 0.30, lightness: 0.50 },
};

function getPartColor(def: PartDefinition): PartColor {
  const cat = CATEGORY_COLORS[def.role] ?? CATEGORY_COLORS.core;
  const hue = (BASE_HUE + cat.hueShift + 1) % 1;
  const color = new THREE.Color().setHSL(hue, cat.saturation, cat.lightness);

  let emissive = new THREE.Color(0x000000);
  let emissiveIntensity = 0;

  if (def.role === 'sensor') {
    emissive = def.id === 'sensor_eye'
      ? new THREE.Color(0xff4444)
      : new THREE.Color(0x00e5ff);
    emissiveIntensity = 0.5;
  }

  return { color, emissive, emissiveIntensity };
}

// ── Mesh Builders ─────────────────────────────────────────────────

function createBodyMesh(partId: PartId): THREE.Mesh {
  const isLarge = partId === 'body_large';
  const radius = isLarge ? BODY_LARGE_RADIUS : BODY_SMALL_RADIUS;
  const geo = new THREE.SphereGeometry(radius, BODY_SEGMENTS, BODY_SEGMENTS);

  const scaleY = isLarge ? BODY_LARGE_SCALE_Y : BODY_SMALL_SCALE_Y;
  const scaleZ = isLarge ? BODY_LARGE_SCALE_Z : BODY_SMALL_SCALE_Z;
  geo.scale(1, scaleY, scaleZ);

  const pc = getPartColor(getPartDef(partId));
  const mat = new THREE.MeshStandardMaterial({
    color: pc.color,
    roughness: PART_ROUGHNESS,
    metalness: PART_METALNESS,
  });

  return new THREE.Mesh(geo, mat);
}

function createLegGroup(partId: PartId): THREE.Group {
  const isLong = partId === 'leg_long';
  const upperLen = isLong ? LEG_LONG_HEIGHT_UPPER : LEG_SHORT_HEIGHT_UPPER;
  const lowerLen = isLong ? LEG_LONG_HEIGHT_LOWER : LEG_SHORT_HEIGHT_LOWER;
  const kneeBend = isLong ? LEG_LONG_KNEE_BEND : LEG_SHORT_KNEE_BEND;
  const pc = getPartColor(getPartDef(partId));

  const legMat = new THREE.MeshStandardMaterial({
    color: pc.color,
    roughness: 0.6,
    metalness: PART_METALNESS,
  });

  const group = new THREE.Group();

  // Upper bone
  const upperGeo = new THREE.CylinderGeometry(LEG_RADIUS, LEG_RADIUS * 0.8, upperLen, 8);
  const upperMesh = new THREE.Mesh(upperGeo, legMat);
  upperMesh.position.y = -upperLen / 2;
  group.add(upperMesh);

  // Knee joint
  const kneeGeo = new THREE.SphereGeometry(KNEE_RADIUS, 8, 8);
  const kneeMesh = new THREE.Mesh(kneeGeo, legMat);
  kneeMesh.position.y = -upperLen;
  group.add(kneeMesh);

  // Lower bone (angled back)
  const lowerGeo = new THREE.CylinderGeometry(LEG_RADIUS * 0.8, LEG_RADIUS * 0.5, lowerLen, 8);
  const lowerMesh = new THREE.Mesh(lowerGeo, legMat);
  lowerMesh.position.y = -upperLen - lowerLen / 2;
  lowerMesh.rotation.x = kneeBend;
  group.add(lowerMesh);

  // Splay outward
  group.rotation.z = LEG_SPLAY_ANGLE;

  return group;
}

function createClawMesh(partId: PartId): THREE.Mesh {
  const isLarge = partId === 'claw_large';
  const radius = isLarge ? CLAW_LARGE_RADIUS : CLAW_SMALL_RADIUS;
  const height = isLarge ? CLAW_LARGE_HEIGHT : CLAW_SMALL_HEIGHT;
  const pc = getPartColor(getPartDef(partId));

  const geo = new THREE.ConeGeometry(radius, height, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: pc.color.clone().multiplyScalar(1.3),
    roughness: 0.3,
    metalness: 0.4,
    emissive: pc.emissive,
    emissiveIntensity: 0.2,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI; // point downward
  return mesh;
}

function createSpikeMesh(): THREE.Mesh {
  const pc = getPartColor(getPartDef('spike'));
  const geo = new THREE.ConeGeometry(SPIKE_RADIUS, SPIKE_HEIGHT, 6);
  const mat = new THREE.MeshStandardMaterial({
    color: pc.color.clone().multiplyScalar(1.2),
    roughness: 0.3,
    metalness: 0.5,
  });
  return new THREE.Mesh(geo, mat);
}

function createEyeMesh(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(EYE_RADIUS, 12, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xff4444),
    emissive: new THREE.Color(0xff4444),
    emissiveIntensity: 0.8,
    roughness: 0.2,
    metalness: 0.6,
  });
  return new THREE.Mesh(geo, mat);
}

function createAntennaMesh(): THREE.Group {
  const group = new THREE.Group();

  const stemGeo = new THREE.CylinderGeometry(ANTENNA_STEM_RADIUS, ANTENNA_STEM_RADIUS, ANTENNA_STEM_HEIGHT, 6);
  const stemMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x446688),
    roughness: 0.5,
    metalness: 0.3,
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = ANTENNA_STEM_HEIGHT / 2;
  group.add(stem);

  const tipGeo = new THREE.SphereGeometry(ANTENNA_TIP_RADIUS, 8, 8);
  const tipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x00e5ff),
    emissive: new THREE.Color(0x00e5ff),
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.y = ANTENNA_STEM_HEIGHT;
  group.add(tip);

  return group;
}

function createArmorPlateMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(ARMOR_PLATE_WIDTH, ARMOR_PLATE_HEIGHT, ARMOR_PLATE_DEPTH);
  const pc = getPartColor(getPartDef('armor_plate'));
  const mat = new THREE.MeshStandardMaterial({
    color: pc.color,
    roughness: 0.3,
    metalness: 0.6,
  });
  return new THREE.Mesh(geo, mat);
}

function createShellMesh(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SHELL_RADIUS, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const pc = getPartColor(getPartDef('shell_dorsal'));
  const mat = new THREE.MeshStandardMaterial({
    color: pc.color,
    roughness: 0.3,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

// ── Public API ────────────────────────────────────────────────────

/** Create a Three.js object for a given part type */
export function createPartObject(partId: PartId, isGhost = false): THREE.Object3D {
  let obj: THREE.Object3D;

  switch (partId) {
    case 'body_small':
    case 'body_large':
      obj = createBodyMesh(partId);
      break;
    case 'leg_short':
    case 'leg_long':
      obj = createLegGroup(partId);
      break;
    case 'claw_small':
    case 'claw_large':
      obj = createClawMesh(partId);
      break;
    case 'spike':
      obj = createSpikeMesh();
      break;
    case 'sensor_eye':
      obj = createEyeMesh();
      break;
    case 'sensor_antenna':
      obj = createAntennaMesh();
      break;
    case 'armor_plate':
      obj = createArmorPlateMesh();
      break;
    case 'shell_dorsal':
      obj = createShellMesh();
      break;
    default:
      obj = new THREE.Mesh(
        new THREE.SphereGeometry(0.2),
        new THREE.MeshStandardMaterial({ color: 0xff00ff })
      );
  }

  if (isGhost) {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = (child.material as THREE.MeshStandardMaterial).clone();
        mat.transparent = true;
        mat.opacity = GHOST_OPACITY;
        mat.depthWrite = false;
        child.material = mat;
      }
    });
  }

  return obj;
}

/** Orient a child part based on the parent port direction */
export function orientPartAtPort(
  partObj: THREE.Object3D,
  portPosition: [number, number, number],
  portDirection: string
): void {
  partObj.position.set(...portPosition);

  // Rotate part to face outward from the port direction
  switch (portDirection) {
    case 'left':
      partObj.rotation.z = Math.PI / 2;
      break;
    case 'right':
      partObj.rotation.z = -Math.PI / 2;
      break;
    case 'top':
      // Default orientation is up, no rotation needed
      break;
    case 'bottom':
      partObj.rotation.z = Math.PI;
      break;
    case 'front':
      partObj.rotation.x = -Math.PI / 2;
      break;
    case 'back':
      partObj.rotation.x = Math.PI / 2;
      break;
  }
}

export interface CreatureMeshResult {
  group: THREE.Group;
  partMeshes: Map<string, THREE.Object3D>;
}

/** Build a complete creature mesh hierarchy from a blueprint */
export function buildCreatureMesh(blueprint: PartInstance): CreatureMeshResult {
  const group = new THREE.Group();
  const partMeshes = new Map<string, THREE.Object3D>();

  function buildNode(instance: PartInstance, parentObj: THREE.Object3D, parentDef: PartDefinition | null): void {
    const def = getPartDef(instance.partId);
    const obj = createPartObject(instance.partId);
    partMeshes.set(instance.instanceId, obj);

    // Position at parent's port
    if (parentDef && instance.portIndex >= 0 && instance.portIndex < parentDef.portLayout.length) {
      const port = parentDef.portLayout[instance.portIndex];
      orientPartAtPort(obj, port.position, port.direction);
    }

    parentObj.add(obj);

    // Recurse into children
    for (const child of instance.children) {
      buildNode(child, obj, def);
    }
  }

  // Root body - no parent port
  const rootDef = getPartDef(blueprint.partId);
  const rootObj = createPartObject(blueprint.partId);
  partMeshes.set(blueprint.instanceId, rootObj);
  group.add(rootObj);

  for (const child of blueprint.children) {
    buildNode(child, rootObj, rootDef);
  }

  return { group, partMeshes };
}
