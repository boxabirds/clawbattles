/**
 * creature-builder.ts
 *
 * Builds a Three.js Group from MatchPart rows, reflecting the actual
 * body tree of each creature. Each partId maps to distinct geometry.
 *
 * Archetype-distinct visuals: bodies have unique silhouettes, legs are
 * articulated 2-segment chains, parts scale with body, weapons/armor
 * are color-coded and properly sized.
 */

import * as THREE from 'three/webgpu';
import type { MatchPart } from './module_bindings/types';

// ── Body geometry constants ─────────────────────────────────────

const BODY_SMALL_RADIUS = 1.0;
const BODY_LARGE_RADIUS = 1.5;
const BODY_CENTIPEDE_RADIUS = 1.0;
const BODY_Y_OFFSET = 1.5;
const BODY_SPHERE_SEGMENTS_W = 16;
const BODY_SPHERE_SEGMENTS_H = 12;

// Body shape scale vectors (x, y, z) — each archetype reads differently
const BODY_SMALL_SCALE_X = 0.85;
const BODY_SMALL_SCALE_Y = 0.8;
const BODY_SMALL_SCALE_Z = 1.15;

const BODY_LARGE_SCALE_X = 1.2;
const BODY_LARGE_SCALE_Y = 0.9;
const BODY_LARGE_SCALE_Z = 1.0;

const BODY_CENTIPEDE_SCALE_X = 0.7;
const BODY_CENTIPEDE_SCALE_Y = 0.6;
const BODY_CENTIPEDE_SCALE_Z = 2.0;

// ── Leg geometry constants ──────────────────────────────────────

const LEG_SHORT_HEIGHT = 1.2;
const LEG_LONG_HEIGHT = 2.0;
const LEG_RADIUS = 0.12;
const LEG_TAPER = 0.7; // bottom radius multiplier
const LEG_SPLAY_ANGLE = 0.6; // radians outward tilt (increased from 0.4)
const LEG_SEGMENTS = 6;

// Articulation: 2-segment leg proportions
const LEG_THIGH_FRACTION = 0.6; // thigh is 60% of total height
const LEG_CALF_FRACTION = 0.4;  // calf is 40%
const LEG_SHORT_THICKNESS_MULT = 1.4; // short legs are thicker
const LEG_SHORT_KNEE_BEND = 0.15; // radians — planted look
const LEG_LONG_KNEE_BEND = 0.3;  // radians — extended look

// Leg placement around body
const LEG_PLACEMENT_RADIUS_FRACTION = 0.85; // place at 85% of body radius
const LEG_FRONT_HEIGHT_OFFSET = 0.1;  // front legs slightly higher
const LEG_REAR_HEIGHT_OFFSET = -0.15; // rear legs slightly lower

// ── Weapon constants ────────────────────────────────────────────

const CLAW_SMALL_HEIGHT = 1.12;  // 40% bigger than original 0.8
const CLAW_SMALL_RADIUS = 0.35;  // 40% bigger than original 0.25
const CLAW_LARGE_HEIGHT = 1.68;  // 40% bigger than original 1.2
const CLAW_LARGE_RADIUS = 0.56;  // 40% bigger than original 0.4

const SPIKE_HEIGHT = 0.6;
const SPIKE_RADIUS = 0.1;    // narrower tip for sharper look
const SPIKE_TIP_RATIO = 0.0; // true point (cone tip radius = 0)

const STINGER_LENGTH = 1.95;    // 30% longer than original 1.5
const STINGER_BASE_RADIUS = 0.18;
const STINGER_TIP_RADIUS = 0.03; // needle-sharp tip

const MANDIBLE_LENGTH = 1.1;     // longer pincers
const MANDIBLE_RADIUS = 0.1;
const MANDIBLE_TIP_TAPER = 0.4;
const MANDIBLE_SPREAD = 0.45;    // wider spread
const MANDIBLE_ROTATION_X = Math.PI / 3;
const MANDIBLE_ROTATION_Z = 0.35;

// ── Armor / shell constants ─────────────────────────────────────

const ARMOR_WIDTH = 1.2;    // 50% bigger than original 0.8
const ARMOR_HEIGHT = 0.45;  // 50% bigger than original 0.3
const ARMOR_DEPTH = 0.9;    // 50% bigger than original 0.6

const SHELL_RADIUS = 1.2;   // 50% bigger than original 0.8
const SHELL_PHI_START = 0;
const SHELL_PHI_LENGTH = Math.PI; // half-sphere dome

// ── Sensor constants ────────────────────────────────────────────

const SENSOR_EYE_RADIUS = 0.2;
const ANTENNA_STEM_HEIGHT = 0.5;
const ANTENNA_STEM_RADIUS = 0.04;
const ANTENNA_TIP_RADIUS = 0.1;

// ── Wing constants ──────────────────────────────────────────────

const WING_WIDTH = 1.5;
const WING_HEIGHT = 0.6;
const WING_OPACITY = 0.6;

// ── Name label constants ────────────────────────────────────────

const NAME_LABEL_Y = 4.0;
const NAME_LABEL_Y_OFFSET = 0.8;
const NAME_LABEL_CANVAS_WIDTH = 256;
const NAME_LABEL_CANVAS_HEIGHT = 64;
const NAME_LABEL_FONT_SIZE = 28;
const NAME_LABEL_SCALE_X = 4;
const NAME_LABEL_TEXT_Y_FRACTION = 0.625;

// ── Material constants ──────────────────────────────────────────

const EMISSIVE_INTENSITY = 0.6;
const BODY_ROUGHNESS = 0.4;
const BODY_METALNESS = 0.3;

// Color modifier multipliers
const WEAPON_BRIGHTNESS_MULT = 1.3;   // 30% brighter than base
const ARMOR_DARKNESS_MULT = 0.8;      // 20% darker than base
const LEG_DARKNESS_MULT = 0.7;        // legs are support, darker
const WEAPON_EMISSIVE_MULT = 0.15;

// Armor/shell material properties
const ARMOR_ROUGHNESS = 0.2;     // lower = shinier
const ARMOR_METALNESS = 0.8;     // higher = more metallic
const SHELL_ROUGHNESS = 0.15;
const SHELL_METALNESS = 0.85;
const SHELL_DARKNESS_MULT = 0.65; // shell is darkest

// Weapon material properties
const WEAPON_ROUGHNESS = 0.3;
const WEAPON_METALNESS = 0.4;
const SPIKE_ROUGHNESS = 0.2;
const SPIKE_METALNESS = 0.6;
const STINGER_ROUGHNESS = 0.2;
const STINGER_METALNESS = 0.5;
const STINGER_EMISSIVE_INTENSITY = 0.4;
const MANDIBLE_ROUGHNESS = 0.3;
const MANDIBLE_METALNESS = 0.5;

// Leg material properties
const LEG_ROUGHNESS = 0.6;

// Sensor material properties
const SENSOR_ROUGHNESS = 0.1;
const ANTENNA_STEM_ROUGHNESS = 0.5;
const WING_ROUGHNESS = 0.1;
const WING_METALNESS = 0.3;
const WING_EMISSIVE_INTENSITY = 0.1;
const WING_BRIGHTNESS_MULT = 1.2;

// ── Placement constants ─────────────────────────────────────────

const SENSOR_RADIAL_FRACTION = 0.5;  // how far from center
const SENSOR_HEIGHT_FRACTION = 0.8;  // how high above body center
const SENSOR_DEPTH_FRACTION = 0.3;   // forward offset

const ARMOR_RADIAL_FRACTION = 0.95;  // flush against body edge

const SHELL_HEIGHT_FRACTION = 0.7;   // sits on top/back of body

const DIRECT_WEAPON_RADIAL_MULT = 1.1;
const DIRECT_WEAPON_HEIGHT_FRACTION = -0.2;

const LEG_CHILD_WEAPON_OUTWARD_FRACTION = 0.3;
const LEG_CHILD_GENERIC_Y_FRACTION = 0.5;

const DEEP_CHILD_Y_OFFSET = 0.4;

const PLACEHOLDER_RADIUS = 0.5;
const FALLBACK_RADIUS = 0.2;

// Cylinder centering (position at half-height)
const HALF = 0.5;

// Leg articulation geometry
const LEG_LONG_RADIUS_MULT = 1.0; // long legs: no extra thickness
const LEG_KNEE_RETURN_MULT = 2;   // calf bends back at 2x knee angle

// Leg tip child attachment
const LEG_TIP_Y_FRACTION = 0.4;

// Wing placement
const WING_HEIGHT_OFFSET_FRACTION = 0.3;
const WING_TILT_ANGLE = 0.3; // radians

// Leg attachment at body
const LEG_BODY_HEIGHT_FRACTION = 0.3;

// Armor angle offset for even distribution
const ARMOR_ANGLE_OFFSET = 0.5;

// Shell positioning
const SHELL_BACK_OFFSET_FRACTION = 0.2;
const SHELL_TILT_ANGLE = -0.3; // radians — tilts to cover dorsal area

// Stinger emissive: use base color as-is
const STINGER_EMISSIVE_COLOR_MULT = 1.0;

// ── Types ─────────────────────────────────────────────────────────

/** Result of building a creature — includes the mesh map for runtime updates */
export interface CreatureMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  nameLabel: THREE.Sprite;
  /** instanceId → Three.js Object3D for part detachment */
  partMeshes: Map<string, THREE.Object3D>;
}

interface PartTreeNode {
  part: MatchPart;
  children: PartTreeNode[];
}

// ── Color helpers ─────────────────────────────────────────────────

/** Create a brighter version of a color (for weapons) */
function brightenColor(color: number, mult: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(mult);
}

/** Create a darker version of a color (for armor, legs) */
function darkenColor(color: number, mult: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(mult);
}

// ── Geometry factories ────────────────────────────────────────────

function makeBodyMesh(partId: string, color: number): THREE.Mesh {
  const isLarge = partId === 'body_large';
  const isCentipede = partId === 'body_centipede';
  const r = isLarge ? BODY_LARGE_RADIUS : BODY_SMALL_RADIUS;

  const geo = new THREE.SphereGeometry(
    isCentipede ? BODY_CENTIPEDE_RADIUS : r,
    BODY_SPHERE_SEGMENTS_W,
    BODY_SPHERE_SEGMENTS_H,
  );
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: BODY_ROUGHNESS,
    metalness: BODY_METALNESS,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Apply archetype-specific scale for silhouette differentiation
  if (isCentipede) {
    mesh.scale.set(BODY_CENTIPEDE_SCALE_X, BODY_CENTIPEDE_SCALE_Y, BODY_CENTIPEDE_SCALE_Z);
  } else if (isLarge) {
    mesh.scale.set(BODY_LARGE_SCALE_X, BODY_LARGE_SCALE_Y, BODY_LARGE_SCALE_Z);
  } else {
    mesh.scale.set(BODY_SMALL_SCALE_X, BODY_SMALL_SCALE_Y, BODY_SMALL_SCALE_Z);
  }

  mesh.castShadow = true;
  return mesh;
}

/**
 * Build a 2-segment articulated leg (thigh + calf with knee joint).
 * Short legs are thicker with less knee bend (planted).
 * Long legs are thinner with more knee bend (extended).
 */
function makeArticulatedLeg(
  long: boolean,
  color: number,
  partScale: number,
): THREE.Group {
  const legGroup = new THREE.Group();

  const totalHeight = long ? LEG_LONG_HEIGHT : LEG_SHORT_HEIGHT;
  const thighHeight = totalHeight * LEG_THIGH_FRACTION;
  const calfHeight = totalHeight * LEG_CALF_FRACTION;

  const radiusMult = long ? LEG_LONG_RADIUS_MULT : LEG_SHORT_THICKNESS_MULT;
  const thighRadius = LEG_RADIUS * radiusMult * partScale;
  const calfRadius = thighRadius * LEG_TAPER;

  const kneeBend = long ? LEG_LONG_KNEE_BEND : LEG_SHORT_KNEE_BEND;

  const legColor = darkenColor(color, LEG_DARKNESS_MULT);
  const mat = new THREE.MeshStandardMaterial({
    color: legColor,
    roughness: LEG_ROUGHNESS,
  });

  // Thigh: upper segment, angled slightly outward
  const thighGeo = new THREE.CylinderGeometry(
    thighRadius,
    thighRadius * LEG_TAPER,
    thighHeight * partScale,
    LEG_SEGMENTS,
  );
  const thigh = new THREE.Mesh(thighGeo, mat);
  thigh.position.y = -thighHeight * partScale * HALF;
  thigh.rotation.x = kneeBend; // angle outward at hip
  thigh.castShadow = true;

  // Knee joint pivot — positioned at the bottom of the thigh
  const kneeJoint = new THREE.Group();
  kneeJoint.position.y = -thighHeight * partScale;

  // Calf: lower segment, angled back inward
  const calfGeo = new THREE.CylinderGeometry(
    calfRadius,
    calfRadius * LEG_TAPER,
    calfHeight * partScale,
    LEG_SEGMENTS,
  );
  const calf = new THREE.Mesh(calfGeo, mat);
  calf.position.y = -calfHeight * partScale * HALF;
  calf.rotation.x = -kneeBend * LEG_KNEE_RETURN_MULT; // bend back inward at knee
  calf.castShadow = true;

  kneeJoint.add(calf);
  legGroup.add(thigh);
  thigh.add(kneeJoint);

  return legGroup;
}

function makeClawMesh(large: boolean, color: number, partScale: number): THREE.Mesh {
  const h = (large ? CLAW_LARGE_HEIGHT : CLAW_SMALL_HEIGHT) * partScale;
  const r = (large ? CLAW_LARGE_RADIUS : CLAW_SMALL_RADIUS) * partScale;
  const geo = new THREE.ConeGeometry(r, h, 8);
  const weaponColor = brightenColor(color, WEAPON_BRIGHTNESS_MULT);
  const mat = new THREE.MeshStandardMaterial({
    color: weaponColor,
    roughness: WEAPON_ROUGHNESS,
    metalness: WEAPON_METALNESS,
    emissive: new THREE.Color(color),
    emissiveIntensity: WEAPON_EMISSIVE_MULT,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.rotation.x = Math.PI / 2; // tip faces +Z
  return mesh;
}

function makeSpikeMesh(partScale: number): THREE.Mesh {
  // CylinderGeometry with 0 top radius creates a true sharp point
  const geo = new THREE.CylinderGeometry(
    SPIKE_TIP_RATIO,           // 0 = true sharp point
    SPIKE_RADIUS * partScale,
    SPIKE_HEIGHT * partScale,
    5,
  );
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: SPIKE_ROUGHNESS,
    metalness: SPIKE_METALNESS,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function makeArmorMesh(color: number, partScale: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(
    ARMOR_WIDTH * partScale,
    ARMOR_HEIGHT * partScale,
    ARMOR_DEPTH * partScale,
  );
  const armorColor = darkenColor(color, ARMOR_DARKNESS_MULT);
  const mat = new THREE.MeshStandardMaterial({
    color: armorColor,
    roughness: ARMOR_ROUGHNESS,
    metalness: ARMOR_METALNESS,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function makeShellMesh(color: number, partScale: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(
    SHELL_RADIUS * partScale,
    BODY_SPHERE_SEGMENTS_W,
    8,
    0,
    Math.PI * 2,
    SHELL_PHI_START,
    SHELL_PHI_LENGTH,
  );
  const shellColor = darkenColor(color, SHELL_DARKNESS_MULT);
  const mat = new THREE.MeshStandardMaterial({
    color: shellColor,
    roughness: SHELL_ROUGHNESS,
    metalness: SHELL_METALNESS,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function makeSensorEyeMesh(color: number, partScale: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SENSOR_EYE_RADIUS * partScale, 8, 6);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(color),
    emissiveIntensity: EMISSIVE_INTENSITY,
    roughness: SENSOR_ROUGHNESS,
  });
  return new THREE.Mesh(geo, mat);
}

function makeSensorAntennaMesh(color: number, partScale: number): THREE.Group {
  const group = new THREE.Group();

  const stemGeo = new THREE.CylinderGeometry(
    ANTENNA_STEM_RADIUS * partScale,
    ANTENNA_STEM_RADIUS * partScale,
    ANTENNA_STEM_HEIGHT * partScale,
    4,
  );
  const stemMat = new THREE.MeshStandardMaterial({
    color: darkenColor(color, LEG_DARKNESS_MULT),
    roughness: ANTENNA_STEM_ROUGHNESS,
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = ANTENNA_STEM_HEIGHT * partScale * HALF;
  group.add(stem);

  const tipGeo = new THREE.SphereGeometry(ANTENNA_TIP_RADIUS * partScale, 6, 4);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(color),
    emissiveIntensity: EMISSIVE_INTENSITY,
    roughness: SENSOR_ROUGHNESS,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.y = ANTENNA_STEM_HEIGHT * partScale;
  group.add(tip);

  return group;
}

function makeWingMesh(color: number, partScale: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WING_WIDTH * partScale, WING_HEIGHT * partScale);
  const mat = new THREE.MeshStandardMaterial({
    color: brightenColor(color, WING_BRIGHTNESS_MULT),
    transparent: true,
    opacity: WING_OPACITY,
    side: THREE.DoubleSide,
    roughness: WING_ROUGHNESS,
    metalness: WING_METALNESS,
    emissive: new THREE.Color(color),
    emissiveIntensity: WING_EMISSIVE_INTENSITY,
  });
  return new THREE.Mesh(geo, mat);
}

function makeStingerMesh(color: number, partScale: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(
    STINGER_TIP_RADIUS * partScale,  // needle-sharp tip
    STINGER_BASE_RADIUS * partScale,
    STINGER_LENGTH * partScale,
    8,
  );
  const weaponColor = brightenColor(color, WEAPON_BRIGHTNESS_MULT);
  const mat = new THREE.MeshStandardMaterial({
    color: weaponColor,
    emissive: brightenColor(color, STINGER_EMISSIVE_COLOR_MULT),
    emissiveIntensity: STINGER_EMISSIVE_INTENSITY,
    roughness: STINGER_ROUGHNESS,
    metalness: STINGER_METALNESS,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2; // point forward
  mesh.castShadow = true;
  return mesh;
}

function makeMandibleMesh(color: number, partScale: number): THREE.Group {
  const group = new THREE.Group();
  const weaponColor = brightenColor(color, WEAPON_BRIGHTNESS_MULT);
  const mat = new THREE.MeshStandardMaterial({
    color: weaponColor,
    roughness: MANDIBLE_ROUGHNESS,
    metalness: MANDIBLE_METALNESS,
  });

  for (const side of [-1, 1]) {
    const geo = new THREE.CylinderGeometry(
      MANDIBLE_RADIUS * partScale,
      MANDIBLE_RADIUS * MANDIBLE_TIP_TAPER * partScale,
      MANDIBLE_LENGTH * partScale,
      6,
    );
    const pincer = new THREE.Mesh(geo, mat);
    pincer.position.set(
      side * MANDIBLE_SPREAD * partScale,
      0,
      MANDIBLE_LENGTH * partScale * LEG_CHILD_WEAPON_OUTWARD_FRACTION,
    );
    pincer.rotation.x = MANDIBLE_ROTATION_X;
    pincer.rotation.z = side * MANDIBLE_ROTATION_Z;
    pincer.castShadow = true;
    group.add(pincer);
  }

  return group;
}

// ── Tree reconstruction ───────────────────────────────────────────

function buildPartTree(parts: MatchPart[]): PartTreeNode | null {
  const childMap = new Map<string, MatchPart[]>();

  for (const p of parts) {
    if (!childMap.has(p.parentInstanceId)) {
      childMap.set(p.parentInstanceId, []);
    }
    childMap.get(p.parentInstanceId)!.push(p);
  }

  const roots = childMap.get('') ?? [];
  if (roots.length === 0) return null;

  function buildNode(part: MatchPart): PartTreeNode {
    const children = (childMap.get(part.instanceId) ?? []).map(buildNode);
    return { part, children };
  }

  return buildNode(roots[0]);
}

// ── Part role classification ──────────────────────────────────────

type PartCategory = 'body' | 'leg' | 'weapon' | 'sensor' | 'armor' | 'shell';

function categorize(partId: string): PartCategory {
  if (partId.startsWith('body_')) return 'body';
  if (partId.startsWith('leg_') || partId === 'wing') return 'leg';
  if (partId.startsWith('claw_') || partId === 'spike' || partId === 'stinger' || partId === 'mandible') return 'weapon';
  if (partId.startsWith('sensor_')) return 'sensor';
  if (partId === 'shell_dorsal') return 'shell';
  if (partId === 'armor_plate') return 'armor';
  return 'body'; // fallback
}

// ── Part mesh factory (with scaling) ──────────────────────────────

function createPartMesh(
  partId: string,
  color: number,
  partScale: number,
): THREE.Object3D {
  switch (partId) {
    case 'body_small':
    case 'body_large':
    case 'body_centipede':
      return makeBodyMesh(partId, color);
    case 'leg_short':
      return makeArticulatedLeg(false, color, partScale);
    case 'leg_long':
      return makeArticulatedLeg(true, color, partScale);
    case 'wing':
      return makeWingMesh(color, partScale);
    case 'claw_small':
      return makeClawMesh(false, color, partScale);
    case 'claw_large':
      return makeClawMesh(true, color, partScale);
    case 'spike':
      return makeSpikeMesh(partScale);
    case 'stinger':
      return makeStingerMesh(color, partScale);
    case 'mandible':
      return makeMandibleMesh(color, partScale);
    case 'armor_plate':
      return makeArmorMesh(color, partScale);
    case 'shell_dorsal':
      return makeShellMesh(color, partScale);
    case 'sensor_eye':
      return makeSensorEyeMesh(color, partScale);
    case 'sensor_antenna':
      return makeSensorAntennaMesh(color, partScale);
    default: {
      const geo = new THREE.SphereGeometry(FALLBACK_RADIUS, 6, 4);
      const mat = new THREE.MeshStandardMaterial({ color: 0x666666 });
      return new THREE.Mesh(geo, mat);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function attachDeepChildren(
  parent: THREE.Object3D,
  children: PartTreeNode[],
  color: number,
  partScale: number,
  partMeshes: Map<string, THREE.Object3D>,
): void {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const mesh = createPartMesh(child.part.partId, color, partScale);
    mesh.position.y = DEEP_CHILD_Y_OFFSET * (i + 1);
    parent.add(mesh);
    partMeshes.set(child.part.instanceId, mesh);
    attachDeepChildren(mesh, child.children, color, partScale, partMeshes);
  }
}

/**
 * Compute a height offset per leg so front legs sit slightly higher
 * and rear legs slightly lower, giving a natural stance.
 * Angle 0 = right side, PI/2 = front, PI = left, 3PI/2 = rear.
 */
function legHeightOffset(angle: number): number {
  // cos(angle - PI/2) peaks at PI/2 (front) and troughs at 3PI/2 (rear)
  const frontRear = Math.cos(angle - Math.PI / 2);
  return frontRear > 0
    ? frontRear * LEG_FRONT_HEIGHT_OFFSET
    : frontRear * Math.abs(LEG_REAR_HEIGHT_OFFSET);
}

/**
 * Get the body radius for a given partId.
 */
function getBodyRadius(partId: string): number {
  if (partId === 'body_large') return BODY_LARGE_RADIUS;
  if (partId === 'body_centipede') return BODY_CENTIPEDE_RADIUS;
  return BODY_SMALL_RADIUS;
}

// ── Main builder ──────────────────────────────────────────────────

/**
 * Build a Three.js Group reflecting a creature's actual part tree.
 * Returns the group + a map from instanceId → mesh for runtime part updates.
 */
export function buildCreatureMesh(
  parts: MatchPart[],
  creatureIdx: number,
  color: number,
  cssColor: string,
  name: string,
): CreatureMesh {
  const group = new THREE.Group();
  const partMeshes = new Map<string, THREE.Object3D>();

  const tree = buildPartTree(parts);
  if (!tree) {
    const placeholder = new THREE.Mesh(
      new THREE.SphereGeometry(PLACEHOLDER_RADIUS),
      new THREE.MeshStandardMaterial({ color }),
    );
    placeholder.position.y = BODY_Y_OFFSET;
    group.add(placeholder);
    return {
      group,
      body: placeholder,
      nameLabel: new THREE.Sprite(),
      partMeshes,
    };
  }

  // Build root body with archetype-specific shape
  const bodyMesh = makeBodyMesh(tree.part.partId, color);
  bodyMesh.position.y = BODY_Y_OFFSET;
  group.add(bodyMesh);
  partMeshes.set(tree.part.instanceId, bodyMesh);

  const bodyRadius = getBodyRadius(tree.part.partId);

  // Part scale factor — larger bodies get proportionally larger parts
  const partScale = bodyRadius / BODY_SMALL_RADIUS;

  // Categorize children for positional placement
  const legs: PartTreeNode[] = [];
  const sensors: PartTreeNode[] = [];
  const armors: PartTreeNode[] = [];
  const shells: PartTreeNode[] = [];
  const otherWeapons: PartTreeNode[] = [];

  for (const child of tree.children) {
    const cat = categorize(child.part.partId);
    switch (cat) {
      case 'leg': legs.push(child); break;
      case 'sensor': sensors.push(child); break;
      case 'armor': armors.push(child); break;
      case 'shell': shells.push(child); break;
      case 'weapon': otherWeapons.push(child); break;
    }
  }

  // ── Attach legs with articulation ───────────────────────────────

  for (let i = 0; i < legs.length; i++) {
    const angle = (i / legs.length) * Math.PI * 2;
    const legNode = legs[i];
    const isWing = legNode.part.partId === 'wing';
    const isLong = legNode.part.partId === 'leg_long';
    const legHeight = isLong ? LEG_LONG_HEIGHT : LEG_SHORT_HEIGHT;

    const legMesh = createPartMesh(legNode.part.partId, color, partScale);

    if (isWing) {
      // Wings: position on sides of body, angled up
      legMesh.position.set(
        Math.cos(angle) * bodyRadius * LEG_PLACEMENT_RADIUS_FRACTION,
        BODY_Y_OFFSET + bodyRadius * WING_HEIGHT_OFFSET_FRACTION,
        Math.sin(angle) * bodyRadius * LEG_PLACEMENT_RADIUS_FRACTION,
      );
      legMesh.rotation.z = Math.cos(angle) * WING_TILT_ANGLE;
    } else {
      // Articulated legs: place at body edge with height variation
      const heightAdj = legHeightOffset(angle);
      legMesh.position.set(
        Math.cos(angle) * bodyRadius * LEG_PLACEMENT_RADIUS_FRACTION,
        BODY_Y_OFFSET - bodyRadius * LEG_BODY_HEIGHT_FRACTION + heightAdj,
        Math.sin(angle) * bodyRadius * LEG_PLACEMENT_RADIUS_FRACTION,
      );
      // Splay outward from body center
      legMesh.rotation.z = Math.cos(angle) * LEG_SPLAY_ANGLE;
      legMesh.rotation.x = -Math.sin(angle) * LEG_SPLAY_ANGLE;
    }

    group.add(legMesh);
    partMeshes.set(legNode.part.instanceId, legMesh);

    // Attach children at leg tip (weapons, sensors on legs)
    const legTipY = -legHeight * partScale * LEG_TIP_Y_FRACTION;
    const legTipOutward = bodyRadius * LEG_CHILD_WEAPON_OUTWARD_FRACTION;

    for (const legChild of legNode.children) {
      const childCat = categorize(legChild.part.partId);
      const childMesh = createPartMesh(legChild.part.partId, color, partScale);

      if (childCat === 'weapon') {
        childMesh.position.set(
          Math.cos(angle) * legTipOutward,
          legTipY,
          Math.sin(angle) * legTipOutward,
        );
      } else {
        childMesh.position.set(0, legTipY * LEG_CHILD_GENERIC_Y_FRACTION, 0);
      }

      legMesh.add(childMesh);
      partMeshes.set(legChild.part.instanceId, childMesh);
      attachDeepChildren(childMesh, legChild.children, color, partScale, partMeshes);
    }
  }

  // ── Attach sensors at top of body ───────────────────────────────

  for (let i = 0; i < sensors.length; i++) {
    const sensorNode = sensors[i];
    const sensorMesh = createPartMesh(sensorNode.part.partId, color, partScale);
    const sAngle = (i / Math.max(sensors.length, 1)) * Math.PI - Math.PI / 2;
    sensorMesh.position.set(
      Math.sin(sAngle) * bodyRadius * SENSOR_RADIAL_FRACTION,
      BODY_Y_OFFSET + bodyRadius * SENSOR_HEIGHT_FRACTION,
      Math.cos(sAngle) * bodyRadius * SENSOR_DEPTH_FRACTION,
    );
    group.add(sensorMesh);
    partMeshes.set(sensorNode.part.instanceId, sensorMesh);
  }

  // ── Attach armor plates flush to body ───────────────────────────

  for (let i = 0; i < armors.length; i++) {
    const armorNode = armors[i];
    const armorMesh = createPartMesh(armorNode.part.partId, color, partScale);
    const aAngle = ((i + ARMOR_ANGLE_OFFSET) / Math.max(armors.length, 1)) * Math.PI;
    armorMesh.position.set(
      Math.cos(aAngle) * bodyRadius * ARMOR_RADIAL_FRACTION,
      BODY_Y_OFFSET,
      Math.sin(aAngle) * bodyRadius * ARMOR_RADIAL_FRACTION,
    );
    armorMesh.lookAt(0, BODY_Y_OFFSET, 0); // face inward
    group.add(armorMesh);
    partMeshes.set(armorNode.part.instanceId, armorMesh);

    // Armor can have spike children
    attachDeepChildren(armorMesh, armorNode.children, color, partScale, partMeshes);
  }

  // ── Attach shells on top/back of body ───────────────────────────

  for (const shellNode of shells) {
    const shellMesh = createPartMesh(shellNode.part.partId, color, partScale);
    shellMesh.position.set(
      0,
      BODY_Y_OFFSET + bodyRadius * SHELL_HEIGHT_FRACTION,
      -bodyRadius * SHELL_BACK_OFFSET_FRACTION,
    );
    // Tilt to cover the dorsal area
    shellMesh.rotation.x = SHELL_TILT_ANGLE;
    group.add(shellMesh);
    partMeshes.set(shellNode.part.instanceId, shellMesh);
  }

  // ── Direct-attach weapons (not on legs) ─────────────────────────

  for (let i = 0; i < otherWeapons.length; i++) {
    const wNode = otherWeapons[i];
    const wMesh = createPartMesh(wNode.part.partId, color, partScale);
    const wAngle = ((i + legs.length) / (legs.length + otherWeapons.length)) * Math.PI * 2;
    wMesh.position.set(
      Math.cos(wAngle) * bodyRadius * DIRECT_WEAPON_RADIAL_MULT,
      BODY_Y_OFFSET + bodyRadius * DIRECT_WEAPON_HEIGHT_FRACTION,
      Math.sin(wAngle) * bodyRadius * DIRECT_WEAPON_RADIAL_MULT,
    );
    group.add(wMesh);
    partMeshes.set(wNode.part.instanceId, wMesh);
  }

  // ── Name label sprite ───────────────────────────────────────────

  const canvas = document.createElement('canvas');
  canvas.width = NAME_LABEL_CANVAS_WIDTH;
  canvas.height = NAME_LABEL_CANVAS_HEIGHT;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.font = `bold ${NAME_LABEL_FONT_SIZE}px Courier New`;
  ctx2d.fillStyle = cssColor;
  ctx2d.textAlign = 'center';
  ctx2d.fillText(name, NAME_LABEL_CANVAS_WIDTH / 2, NAME_LABEL_CANVAS_HEIGHT * NAME_LABEL_TEXT_Y_FRACTION);
  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const nameLabel = new THREE.Sprite(spriteMat);
  nameLabel.position.y = NAME_LABEL_Y + NAME_LABEL_Y_OFFSET;
  nameLabel.scale.set(NAME_LABEL_SCALE_X, 1, 1);
  group.add(nameLabel);

  return {
    group,
    body: bodyMesh,
    nameLabel,
    partMeshes,
  };
}
