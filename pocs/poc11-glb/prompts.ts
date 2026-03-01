/**
 * Part type → text prompt mappings for AI 3D generation.
 *
 * Each part has a base prompt and optional variant suffixes.
 * Prompts are tuned for isolated creature parts (not full creatures),
 * with emphasis on chitin/exoskeleton aesthetic and game-ready proportions.
 */

export interface PartPrompt {
  /** Part ID matching schema.ts PartId */
  partId: string;
  /** Base text prompt sent to the API */
  prompt: string;
  /** Variant suffixes appended to base prompt for visual variety */
  variants: string[];
  /** Target height in scene units for normalization */
  targetHeight: number;
}

/**
 * PROMPT STRATEGY: These models generate complete objects, not "parts of" things.
 * If you say "insect claw" you get a whole insect with claws.
 * Instead describe the part AS the object: "a crab pincer" not "an insect's claw".
 * Emphasize: single object, no body, no legs, detached piece, prop.
 */
export const PART_PROMPTS: PartPrompt[] = [
  // ── Bodies ──
  {
    partId: 'body_small',
    prompt: 'single oval chitin shell, small glossy segmented carapace, no legs no head, just the torso piece, dark armored surface, 3D game prop, white background',
    variants: ['smooth carapace', 'ridged segments', 'speckled pattern'],
    targetHeight: 1.7,
  },
  {
    partId: 'body_large',
    prompt: 'single large armored torso shell, thick chitin plates, bulky round carapace piece, no legs no head, detached body segment, 3D game prop, white background',
    variants: ['scarab-like', 'rhinoceros beetle style', 'stag beetle body'],
    targetHeight: 2.4,
  },
  {
    partId: 'body_centipede',
    prompt: 'elongated segmented chitin tube, long armored cylinder with ridged segments, no legs, single detached body piece, 3D game prop, white background',
    variants: ['smooth segments', 'armored ridges', 'translucent joints'],
    targetHeight: 4.0,
  },

  // ── Legs ──
  {
    partId: 'leg_short',
    prompt: 'single detached crab leg, short thick chitin limb with one joint, standalone severed appendage, no body attached, 3D game prop, white background',
    variants: ['thick armored', 'smooth jointed', 'spiny segment'],
    targetHeight: 1.5,
  },
  {
    partId: 'leg_long',
    prompt: 'single detached spider leg, long thin jointed chitin limb, standalone severed appendage, no body attached, 3D game prop, white background',
    variants: ['thin smooth', 'barbed hairy', 'segmented armored'],
    targetHeight: 2.5,
  },

  // ── Wings ──
  {
    partId: 'wing',
    prompt: 'single detached dragonfly wing, translucent veined membrane, one flat wing piece, no body attached, 3D game prop, white background',
    variants: ['dragonfly wing', 'wasp wing narrow', 'lacewing iridescent'],
    targetHeight: 1.5,
  },

  // ── Weapons ──
  {
    partId: 'claw_small',
    prompt: 'single detached crab pincer, small curved chitin claw, one severed crushing appendage, no body no legs, standalone prop, 3D game asset, white background',
    variants: ['small nipper', 'curved hook claw', 'serrated pincer'],
    targetHeight: 1.12,
  },
  {
    partId: 'claw_large',
    prompt: 'single detached lobster claw, large powerful chitin crushing pincer, one severed appendage, no body no legs, standalone prop, 3D game asset, white background',
    variants: ['lobster crusher', 'fiddler crab oversized', 'heavy armored pincer'],
    targetHeight: 1.68,
  },
  {
    partId: 'stinger',
    prompt: 'single detached scorpion stinger, curved venomous barb on tail segment, one severed tail tip, no body, standalone prop, 3D game asset, white background',
    variants: ['sharp needle point', 'thick barbed hook', 'curved venom fang'],
    targetHeight: 2.0,
  },
  {
    partId: 'mandible',
    prompt: 'single detached jaw piece, curved chitin mandible, one severed mouthpart, no head no body, standalone prop, 3D game asset, white background',
    variants: ['stag beetle jaw', 'ant soldier mandible', 'earwig forcep'],
    targetHeight: 1.0,
  },
  {
    partId: 'spike',
    prompt: 'single pointed chitin thorn, short conical spike, one detached horn piece, standalone prop, 3D game asset, white background',
    variants: ['conical spike', 'curved horn', 'barbed thorn'],
    targetHeight: 0.7,
  },

  // ── Defense ──
  {
    partId: 'armor_plate',
    prompt: 'single flat chitin shield piece, thick armored plate, one detached scale segment, no body, standalone prop, 3D game asset, white background',
    variants: ['smooth plate', 'ridged plate', 'layered scale'],
    targetHeight: 1.0,
  },
  {
    partId: 'shell_dorsal',
    prompt: 'single domed shell piece, iridescent chitin dome, one detached wing case, no body no legs, standalone prop, 3D game asset, white background',
    variants: ['ladybug dome', 'scarab shell', 'tortoise beetle dome'],
    targetHeight: 1.2,
  },

  // ── Sensors ──
  {
    partId: 'sensor_eye',
    prompt: 'single compound eye dome, faceted hemispherical lens, one detached glossy orb with hexagonal facets, no head, standalone prop, 3D game asset, white background',
    variants: ['large dome eye', 'small beady eye', 'oval bulging eye'],
    targetHeight: 0.4,
  },
  {
    partId: 'sensor_antenna',
    prompt: 'single detached antenna, thin segmented feeler rod, one standalone sensory appendage, no head no body, 3D game prop, white background',
    variants: ['feathered moth antenna', 'clubbed antenna', 'long whip filament'],
    targetHeight: 1.0,
  },
];

/** Subset of parts used for bake-off comparison */
export const BAKEOFF_PARTS = ['claw_small'] as const;

export function getPrompt(partId: string): PartPrompt | undefined {
  return PART_PROMPTS.find(p => p.partId === partId);
}
