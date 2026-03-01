/**
 * Brain generation and genetic operators for evolution.
 * Adapted from src/harness/evolution.ts for use in the agent.
 */

/** Simple seeded PRNG (xoshiro128) for reproducible evolution */
export class SimpleRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    // Mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  gaussian(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  }
}

/** Brain topology — must match server's BRAIN constants */
const BRAIN_TOPOLOGY = [24, 16, 8, 4] as const;

/** Calculate total weight count for the given topology */
export function totalWeightCount(topology: readonly number[]): number {
  let count = 0;
  for (let i = 0; i < topology.length - 1; i++) {
    count += topology[i] * topology[i + 1] + topology[i + 1]; // weights + biases
  }
  return count;
}

const TOTAL_WEIGHTS = totalWeightCount(BRAIN_TOPOLOGY);

/** Evolution hyperparameters */
export const EVOLUTION = {
  MUTATION_RATE: 0.1,
  MUTATION_PROB: 0.1,
  CROSSOVER_RATE: 0.7,
  ELITE_FRACTION: 0.25,
  RANDOM_INJECTION_FRACTION: 0.1,
} as const;

export interface BrainData {
  topology: readonly number[];
  weights: number[];
}

/** Create a random brain with gaussian-distributed weights */
export function randomBrain(rng: SimpleRNG): BrainData {
  const weights = new Array(TOTAL_WEIGHTS);
  for (let i = 0; i < TOTAL_WEIGHTS; i++) {
    weights[i] = rng.gaussian();
  }
  return { topology: BRAIN_TOPOLOGY, weights };
}

/** Mutate a brain by adding gaussian noise to a fraction of weights */
export function mutate(brain: BrainData, rng: SimpleRNG): BrainData {
  const weights = [...brain.weights];
  for (let i = 0; i < weights.length; i++) {
    if (rng.next() < EVOLUTION.MUTATION_PROB) {
      weights[i] += rng.gaussian() * EVOLUTION.MUTATION_RATE;
    }
  }
  return { topology: brain.topology, weights };
}

/** Uniform crossover: each weight from parent A or B with 50% chance */
export function crossover(a: BrainData, b: BrainData, rng: SimpleRNG): BrainData {
  const weights = new Array(a.weights.length);
  for (let i = 0; i < weights.length; i++) {
    weights[i] = rng.next() < 0.5 ? a.weights[i] : b.weights[i];
  }
  return { topology: a.topology, weights };
}
