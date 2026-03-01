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

export const PART_PROMPTS: PartPrompt[] = [
  // ── Bodies ──
  {
    partId: 'body_small',
    prompt: 'small insect thorax, chitin exoskeleton, compact oval shape, segmented plates, dark glossy surface, game asset, isolated on white background',
    variants: ['smooth carapace', 'ridged segments', 'speckled pattern'],
    targetHeight: 1.7,
  },
  {
    partId: 'body_large',
    prompt: 'large beetle thorax, heavy armored exoskeleton, bulky round body, thick chitin plates, game asset, isolated on white background',
    variants: ['scarab-like', 'rhinoceros beetle style', 'stag beetle body'],
    targetHeight: 2.4,
  },
  {
    partId: 'body_centipede',
    prompt: 'elongated centipede body segment, many-segmented chitin tube, arthropod, side view, game asset, isolated on white background',
    variants: ['smooth segments', 'armored ridges', 'translucent joints'],
    targetHeight: 4.0,
  },

  // ── Legs ──
  {
    partId: 'leg_short',
    prompt: 'short insect leg segment, thick chitin, jointed arthropod limb, single segment, game asset, isolated on white background',
    variants: ['beetle leg', 'ant leg thick', 'armored leg segment'],
    targetHeight: 1.5,
  },
  {
    partId: 'leg_long',
    prompt: 'long thin insect leg, spider-like jointed limb, chitin, elongated, game asset, isolated on white background',
    variants: ['spider leg', 'crane fly leg', 'mantis leg thin'],
    targetHeight: 2.5,
  },

  // ── Wings ──
  {
    partId: 'wing',
    prompt: 'insect wing, translucent membrane, delicate veined pattern, dragonfly-like, game asset, isolated on white background',
    variants: ['dragonfly wing', 'wasp wing narrow', 'lacewing iridescent'],
    targetHeight: 1.5,
  },

  // ── Weapons ──
  {
    partId: 'claw_small',
    prompt: 'small insect pincer claw, curved sharp chitin, crab-like, game asset, isolated on white background',
    variants: ['scorpion chela small', 'crab nipper', 'ant mandible claw'],
    targetHeight: 1.12,
  },
  {
    partId: 'claw_large',
    prompt: 'large lobster claw, powerful chitin armor, crushing pincer, game asset, isolated on white background',
    variants: ['lobster crusher claw', 'fiddler crab large claw', 'scorpion chela heavy'],
    targetHeight: 1.68,
  },
  {
    partId: 'stinger',
    prompt: 'scorpion stinger tail tip, long tapered venomous barb, curved chitin, game asset, isolated on white background',
    variants: ['wasp stinger', 'scorpion tail barb', 'hornet sting needle'],
    targetHeight: 2.0,
  },
  {
    partId: 'mandible',
    prompt: 'insect mandible jaw, curved pincer, beetle mouthpart, chitin, game asset, isolated on white background',
    variants: ['stag beetle mandible', 'ant soldier mandible', 'earwig forcep'],
    targetHeight: 1.0,
  },
  {
    partId: 'spike',
    prompt: 'chitin defensive spike, short pointed thorn, arthropod body spine, game asset, isolated on white background',
    variants: ['conical spike', 'curved horn spine', 'barbed thorn'],
    targetHeight: 0.7,
  },

  // ── Defense ──
  {
    partId: 'armor_plate',
    prompt: 'insect armor plate, thick chitin shield segment, flat protective carapace piece, game asset, isolated on white background',
    variants: ['smooth plate', 'ridged plate', 'layered scale plate'],
    targetHeight: 1.0,
  },
  {
    partId: 'shell_dorsal',
    prompt: 'beetle elytra shell, domed protective wing case, iridescent chitin carapace, game asset, isolated on white background',
    variants: ['ladybug dome', 'scarab shell iridescent', 'tortoise beetle dome'],
    targetHeight: 1.2,
  },

  // ── Sensors ──
  {
    partId: 'sensor_eye',
    prompt: 'compound insect eye, faceted hemispherical dome, glossy dark surface, many hexagonal lenses, game asset, isolated on white background',
    variants: ['fly compound eye', 'dragonfly eye large', 'mantis eye rounded'],
    targetHeight: 0.4,
  },
  {
    partId: 'sensor_antenna',
    prompt: 'insect antenna, segmented flexible sensory organ, thin jointed feeler, game asset, isolated on white background',
    variants: ['moth feathered antenna', 'beetle clubbed antenna', 'cockroach filiform antenna'],
    targetHeight: 1.0,
  },
];

/** Subset of parts used for bake-off comparison */
export const BAKEOFF_PARTS = ['claw_small', 'body_small', 'leg_short'] as const;

export function getPrompt(partId: string): PartPrompt | undefined {
  return PART_PROMPTS.find(p => p.partId === partId);
}
