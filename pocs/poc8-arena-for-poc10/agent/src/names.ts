/**
 * Combinatorial creature name generator.
 * 30 prefixes × 20 suffixes = 600 unique names.
 * Deterministic: generateName(i) always returns the same name for the same index.
 */

const PREFIXES = [
  'Razor', 'Iron', 'Needle', 'Quick', 'Shadow',
  'Venom', 'Storm', 'Crimson', 'Bone', 'Rust',
  'Thorn', 'Fang', 'Dusk', 'Fury', 'Obsidian',
  'Scarlet', 'Frost', 'Ember', 'Dire', 'Savage',
  'Bitter', 'Hollow', 'Pale', 'Grim', 'Wild',
  'Stone', 'Steel', 'Ash', 'Blight', 'Ruin',
] as const;

const SUFFIXES = [
  'claw', 'shell', 'fang', 'wing', 'spike',
  'maw', 'sting', 'scale', 'horn', 'thorn',
  'jaw', 'blade', 'bite', 'pincer', 'snap',
  'tail', 'leg', 'eye', 'mantle', 'carapace',
] as const;

const TOTAL_NAMES = PREFIXES.length * SUFFIXES.length;

/** Generate a deterministic creature name from an index (0-599).
 *  Interleaves prefixes so consecutive indices get varied names
 *  (index 0 = Razor+claw, index 1 = Iron+shell, etc.) */
export function generateName(index: number): string {
  const wrappedIndex = index % TOTAL_NAMES;
  const prefixIdx = wrappedIndex % PREFIXES.length;
  const suffixIdx = wrappedIndex % SUFFIXES.length;
  return PREFIXES[prefixIdx] + SUFFIXES[suffixIdx];
}
