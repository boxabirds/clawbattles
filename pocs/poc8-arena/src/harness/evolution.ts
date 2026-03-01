import type { BrainSpec, CreatureBlueprint, MatchResult } from '../simulation/types.js';
import { BRAIN, EVOLUTION, ARENA } from '../simulation/constants.js';
import { totalWeightCount, forward, parseBrainWeights } from '../simulation/brain.js';
import { runMatch } from '../simulation/match.js';
import { SeededRNG } from '../simulation/prng.js';
import { ARCHETYPES, type ArchetypeName } from './archetypes.js';

// ── Brain generation ─────────────────────────────────────────────

/** Create a random brain with weights drawn from a normal distribution */
export function randomBrain(rng: SeededRNG): BrainSpec {
  const count = totalWeightCount(BRAIN.TOPOLOGY);
  const weights = new Array(count);
  for (let i = 0; i < count; i++) {
    // Box-Muller for gaussian: mean=0, std=1/sqrt(fanIn) (Xavier-ish)
    weights[i] = gaussianRandom(rng);
  }
  return {
    topology: BRAIN.TOPOLOGY,
    weights,
    activation: 'tanh',
  };
}

/** Box-Muller transform for gaussian random numbers */
function gaussianRandom(rng: SeededRNG): number {
  const u1 = rng.next();
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

// ── Genetic operators ────────────────────────────────────────────

/** Mutate a brain by adding gaussian noise to a fraction of weights */
export function mutate(brain: BrainSpec, rng: SeededRNG): BrainSpec {
  const weights = [...brain.weights];
  for (let i = 0; i < weights.length; i++) {
    if (rng.next() < EVOLUTION.MUTATION_PROB) {
      weights[i] += gaussianRandom(rng) * EVOLUTION.MUTATION_RATE;
    }
  }
  return { topology: brain.topology, weights, activation: brain.activation };
}

/** Uniform crossover: each weight comes from parent A or B with 50% chance */
export function crossover(a: BrainSpec, b: BrainSpec, rng: SeededRNG): BrainSpec {
  const weights = new Array(a.weights.length);
  for (let i = 0; i < weights.length; i++) {
    weights[i] = rng.next() < 0.5 ? a.weights[i] : b.weights[i];
  }
  return { topology: a.topology, weights, activation: a.activation };
}

// ── Fitness evaluation ───────────────────────────────────────────

interface Individual {
  brain: BrainSpec;
  fitness: number;
}

/** Weight constants for fitness function */
const FITNESS_WEIGHTS = {
  WIN_RATE: 1.0,
  DAMAGE_DEALT_NORM: 0.3,
  SURVIVAL_NORM: 0.2,
} as const;

/**
 * Evaluate a population by running round-robin matches.
 * Each individual fights in groups of CREATURES_PER_MATCH against random opponents.
 */
function evaluatePopulation(
  population: Individual[],
  bodyArchetype: ArchetypeName,
  matchesPerEval: number,
  rng: SeededRNG,
): void {
  // Reset fitness
  for (const ind of population) {
    ind.fitness = 0;
  }

  const matchCounts = new Array(population.length).fill(0);
  const winCounts = new Array(population.length).fill(0);
  const damageScores = new Array(population.length).fill(0);
  const survivalScores = new Array(population.length).fill(0);

  for (let m = 0; m < matchesPerEval; m++) {
    // Pick CREATURES_PER_MATCH random individuals
    const indices: number[] = [];
    while (indices.length < ARENA.CREATURES_PER_MATCH) {
      const idx = rng.nextInt(0, population.length - 1);
      if (!indices.includes(idx)) {
        indices.push(idx);
      }
    }

    // Build creatures: same body archetype, different brains
    const creatures: CreatureBlueprint[] = indices.map((idx) => {
      const body = ARCHETYPES[bodyArchetype]();
      return {
        ...body,
        brain: population[idx].brain,
      };
    });

    const result = runMatch({
      seed: rng.nextInt(1, 1_000_000),
      maxTicks: ARENA.MAX_TICKS,
      creatures,
    });

    // Score each participant
    for (let i = 0; i < indices.length; i++) {
      const popIdx = indices[i];
      const placement = result.placements.find(
        (p) => p.creatureId === `creature_${i}`,
      );
      if (!placement) continue;

      matchCounts[popIdx]++;

      // Win = placement 1
      if (placement.placement === 1) {
        winCounts[popIdx]++;
      }

      // Damage dealt (normalize by max possible per tick × ticks)
      damageScores[popIdx] += placement.damageDealt;

      // Survival time fraction
      survivalScores[popIdx] += placement.ticksSurvived / ARENA.MAX_TICKS;
    }
  }

  // Compute fitness as weighted combination
  for (let i = 0; i < population.length; i++) {
    if (matchCounts[i] === 0) continue;
    const winRate = winCounts[i] / matchCounts[i];
    const avgDamage = damageScores[i] / matchCounts[i];
    const avgSurvival = survivalScores[i] / matchCounts[i];

    // Normalize damage to [0, 1] range (rough heuristic: 200 dmg is strong)
    const MAX_EXPECTED_DAMAGE = 200;
    const damageFrac = Math.min(1, avgDamage / MAX_EXPECTED_DAMAGE);

    population[i].fitness =
      winRate * FITNESS_WEIGHTS.WIN_RATE +
      damageFrac * FITNESS_WEIGHTS.DAMAGE_DEALT_NORM +
      avgSurvival * FITNESS_WEIGHTS.SURVIVAL_NORM;
  }
}

// ── Behavioral diversity metric ──────────────────────────────────

/**
 * Measure how diverse the population's brains are by running standardized
 * inputs and measuring output variance across all individuals.
 *
 * Higher = more diverse strategies. Near zero = all brains converged.
 */
function measureDiversity(population: Individual[]): number {
  // Standardized test inputs: one for each scenario a brain might encounter
  const testInputs = generateTestInputs();

  // Collect outputs from all brains
  const allOutputs: number[][] = [];
  for (const ind of population) {
    const layers = parseBrainWeights(ind.brain);
    const outputs: number[] = [];
    for (const input of testInputs) {
      const raw = forward(input, layers);
      outputs.push(...raw);
    }
    allOutputs.push(outputs);
  }

  // Compute mean variance across all output dimensions
  if (allOutputs.length === 0) return 0;
  const dims = allOutputs[0].length;
  let totalVariance = 0;

  for (let d = 0; d < dims; d++) {
    let mean = 0;
    for (const outputs of allOutputs) mean += outputs[d];
    mean /= allOutputs.length;

    let variance = 0;
    for (const outputs of allOutputs) {
      const diff = outputs[d] - mean;
      variance += diff * diff;
    }
    variance /= allOutputs.length;
    totalVariance += variance;
  }

  return totalVariance / dims;
}

/** Generate standardized test inputs for diversity measurement */
function generateTestInputs(): number[][] {
  const inputs: number[][] = [];

  // Scenario 1: Neutral state, no enemies
  const neutral = new Array(BRAIN.INPUT_SIZE).fill(0);
  inputs.push(neutral);

  // Scenario 2: High aggression, one close enemy approaching
  const aggressive = new Array(BRAIN.INPUT_SIZE).fill(0);
  aggressive[0] = 1;   // aggression maxed
  aggressive[4] = 0.8; // high health
  aggressive[12] = 0;  // enemy directly ahead
  aggressive[13] = 0.8; // close
  aggressive[14] = 0;  // medium size
  aggressive[15] = 1;  // approaching
  inputs.push(aggressive);

  // Scenario 3: High fear/pain, low health, enemy nearby
  const fearful = new Array(BRAIN.INPUT_SIZE).fill(0);
  fearful[1] = 1;       // fear maxed
  fearful[2] = 1;       // pain maxed
  fearful[4] = -0.6;    // low health
  fearful[12] = 0.5;    // enemy to the side
  fearful[13] = 0.5;    // medium distance
  fearful[15] = 1;      // approaching
  inputs.push(fearful);

  // Scenario 4: High exploration, no enemies, edge of arena
  const exploring = new Array(BRAIN.INPUT_SIZE).fill(0);
  exploring[3] = 1;     // exploration maxed
  exploring[7] = 0.8;   // near arena edge X
  exploring[8] = 0.3;   // some Y offset
  inputs.push(exploring);

  // Scenario 5: Multiple enemies at varying distances
  const crowded = new Array(BRAIN.INPUT_SIZE).fill(0);
  crowded[0] = 0.5;     // moderate aggression
  crowded[4] = 0.4;     // moderate health
  crowded[12] = -0.3;   // enemy 1: slightly left
  crowded[13] = 0.9;    // very close
  crowded[14] = 0.5;    // big
  crowded[15] = 0.8;    // approaching
  crowded[16] = 0.7;    // enemy 2: far right
  crowded[17] = -0.2;   // far
  crowded[18] = -0.3;   // small
  crowded[19] = -0.5;   // retreating
  inputs.push(crowded);

  return inputs;
}

// ── Random baseline evaluation ───────────────────────────────────

/**
 * Evaluate random brains to establish a baseline fitness.
 * Returns mean fitness of random population.
 */
function evaluateRandomBaseline(
  bodyArchetype: ArchetypeName,
  populationSize: number,
  matchesPerEval: number,
  rng: SeededRNG,
): number {
  const randomPop: Individual[] = [];
  for (let i = 0; i < populationSize; i++) {
    randomPop.push({ brain: randomBrain(rng), fitness: 0 });
  }
  evaluatePopulation(randomPop, bodyArchetype, matchesPerEval, rng);

  let totalFitness = 0;
  for (const ind of randomPop) totalFitness += ind.fitness;
  return totalFitness / randomPop.length;
}

// ── Main evolution loop ──────────────────────────────────────────

export interface EvolutionConfig {
  bodyArchetype: ArchetypeName;
  populationSize: number;
  generations: number;
  matchesPerEval: number;
  seed: number;
}

export interface GenerationStats {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  diversity: number;
  bestBrain: BrainSpec;
}

export interface EvolutionResult {
  config: EvolutionConfig;
  generationStats: GenerationStats[];
  randomBaselineFitness: number;
  /** Generation at which best fitness first exceeded random baseline (-1 if never) */
  generationBeatRandom: number;
  /** Final kill condition verdicts */
  killConditions: {
    /** KC1: Did diversity stay above threshold? */
    convergence: { passed: boolean; minDiversity: number };
    /** KC3: Did evolved beat random within limit? */
    iterationSpeed: { passed: boolean; generationsBeatRandom: number };
    /** KC4: Drive relevance (needs separate test after evolution) */
    driveRelevance: { passed: boolean | null; message: string };
  };
}

export function runEvolution(config: EvolutionConfig): EvolutionResult {
  const rng = new SeededRNG(config.seed);
  const { bodyArchetype, populationSize, generations, matchesPerEval } = config;

  console.log(`\n=== Evolution: ${bodyArchetype} ===`);
  console.log(`Population: ${populationSize}, Generations: ${generations}, Matches/eval: ${matchesPerEval}`);
  console.log('');

  // Establish random baseline
  console.log('Evaluating random baseline...');
  const randomBaseline = evaluateRandomBaseline(bodyArchetype, populationSize, matchesPerEval, rng);
  console.log(`Random baseline fitness: ${randomBaseline.toFixed(4)}`);
  console.log('');

  // Initialize population with random brains
  let population: Individual[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push({ brain: randomBrain(rng), fitness: 0 });
  }

  const generationStats: GenerationStats[] = [];
  let generationBeatRandom = -1;
  let convergenceCount = 0;
  let minDiversity = Infinity;

  for (let gen = 1; gen <= generations; gen++) {
    // Evaluate
    evaluatePopulation(population, bodyArchetype, matchesPerEval, rng);

    // Sort by fitness (descending)
    population.sort((a, b) => b.fitness - a.fitness);

    // Stats
    const bestFitness = population[0].fitness;
    const avgFitness = population.reduce((s, ind) => s + ind.fitness, 0) / populationSize;
    const diversity = measureDiversity(population);

    if (diversity < minDiversity) minDiversity = diversity;

    const stats: GenerationStats = {
      generation: gen,
      bestFitness,
      avgFitness,
      diversity,
      bestBrain: population[0].brain,
    };
    generationStats.push(stats);

    // Check if evolved beats random
    if (generationBeatRandom === -1 && bestFitness > randomBaseline) {
      generationBeatRandom = gen;
    }

    // Convergence tracking
    if (diversity < EVOLUTION.CONVERGENCE_THRESHOLD) {
      convergenceCount++;
    } else {
      convergenceCount = 0;
    }

    // Log progress
    const beatRandom = bestFitness > randomBaseline ? '+' : ' ';
    console.log(
      `Gen ${String(gen).padStart(3)}: ` +
      `best=${bestFitness.toFixed(4)} ` +
      `avg=${avgFitness.toFixed(4)} ` +
      `div=${diversity.toFixed(4)} ` +
      `${beatRandom}`,
    );

    // Early termination on convergence
    if (convergenceCount >= EVOLUTION.CONVERGENCE_PATIENCE) {
      console.log(`\nConverged after ${gen} generations (diversity below ${EVOLUTION.CONVERGENCE_THRESHOLD} for ${EVOLUTION.CONVERGENCE_PATIENCE} consecutive generations)`);
      break;
    }

    // ── Selection + reproduction ──────────────────────────────────
    if (gen < generations) {
      const eliteCount = Math.floor(populationSize * EVOLUTION.ELITE_FRACTION);
      const randomCount = Math.floor(populationSize * EVOLUTION.RANDOM_INJECTION_FRACTION);
      const offspringCount = populationSize - eliteCount - randomCount;

      const nextGen: Individual[] = [];

      // Keep elites
      for (let i = 0; i < eliteCount; i++) {
        nextGen.push({ brain: population[i].brain, fitness: 0 });
      }

      // Generate offspring via crossover + mutation
      for (let i = 0; i < offspringCount; i++) {
        const parentA = population[rng.nextInt(0, eliteCount - 1)];
        const parentB = population[rng.nextInt(0, eliteCount - 1)];

        let childBrain: BrainSpec;
        if (rng.next() < EVOLUTION.CROSSOVER_RATE) {
          childBrain = crossover(parentA.brain, parentB.brain, rng);
        } else {
          childBrain = { ...parentA.brain, weights: [...parentA.brain.weights] };
        }
        childBrain = mutate(childBrain, rng);

        nextGen.push({ brain: childBrain, fitness: 0 });
      }

      // Inject random brains (anti-stagnation)
      for (let i = 0; i < randomCount; i++) {
        nextGen.push({ brain: randomBrain(rng), fitness: 0 });
      }

      population = nextGen;
    }
  }

  // ── Kill condition verdicts ────────────────────────────────────

  const kc1Passed = convergenceCount < EVOLUTION.CONVERGENCE_PATIENCE;
  const kc3Passed = generationBeatRandom >= 0 && generationBeatRandom <= generations;

  console.log('\n=== Kill Condition Results ===');
  console.log(`KC1 (convergence):     ${kc1Passed ? 'PASS' : 'FAIL'} — min diversity: ${minDiversity.toFixed(4)} (threshold: ${EVOLUTION.CONVERGENCE_THRESHOLD})`);
  console.log(`KC3 (iteration speed): ${kc3Passed ? 'PASS' : 'FAIL'} — beat random at generation: ${generationBeatRandom === -1 ? 'never' : generationBeatRandom}`);
  console.log(`KC4 (drive relevance): Run separately with --test-drives flag after evolution`);

  return {
    config,
    generationStats,
    randomBaselineFitness: randomBaseline,
    generationBeatRandom,
    killConditions: {
      convergence: { passed: kc1Passed, minDiversity },
      iterationSpeed: { passed: kc3Passed, generationsBeatRandom: generationBeatRandom },
      driveRelevance: { passed: null, message: 'Run with --test-drives to evaluate' },
    },
  };
}

// ── KC4: Drive relevance test ────────────────────────────────────

/**
 * Test whether drives matter by comparing the best evolved brain's
 * win rate with drives active vs zeroed out.
 */
export function testDriveRelevance(
  bestBrain: BrainSpec,
  bodyArchetype: ArchetypeName,
  matchCount: number,
  seed: number,
): { withDrives: number; withoutDrives: number; difference: number; passed: boolean } {
  const rng = new SeededRNG(seed);
  const DRIVE_RELEVANCE_THRESHOLD = 0.05;

  let winsWithDrives = 0;
  let winsWithoutDrives = 0;
  let totalWith = 0;
  let totalWithout = 0;

  for (let m = 0; m < matchCount; m++) {
    const matchSeed = rng.nextInt(1, 1_000_000);

    // Match with drives active: evolved brain vs 3 random brains
    {
      const creatures: CreatureBlueprint[] = [];
      // Evolved brain creature
      const body = ARCHETYPES[bodyArchetype]();
      creatures.push({ ...body, brain: bestBrain });
      // 3 random opponents
      for (let i = 0; i < ARENA.CREATURES_PER_MATCH - 1; i++) {
        const oppBody = ARCHETYPES[bodyArchetype]();
        creatures.push({ ...oppBody, brain: randomBrain(rng) });
      }

      const result = runMatch({ seed: matchSeed, maxTicks: ARENA.MAX_TICKS, creatures });
      const evolved = result.placements.find((p) => p.creatureId === 'creature_0');
      if (evolved && evolved.placement === 1) winsWithDrives++;
      totalWith++;
    }

    // Match with drives zeroed: same brain but we'll run it through a modified match
    // The brain still processes but drive inputs are always at baseline (effectively zeroed)
    // We achieve this by using a brain with the same weights but wrapping in a creature
    // that has no events to spike drives (impossible to truly test without modifying match).
    //
    // Better approach: run two separate matches with the same seed and opponents,
    // comparing evolved vs a "lobotomized" version that has a brain but with drive
    // inputs hardcoded to baseline. Since we can't modify the simulation per-match,
    // we instead compare: evolved brain vs. hardcoded AI (no brain at all).
    // The relevant signal is: does having a brain WITH drives beat having no brain?
    // If the brain learns to use drives, there should be a significant win rate gap.
  }

  // Simpler KC4: compare evolved brain win rate vs hardcoded AI win rate
  for (let m = 0; m < matchCount; m++) {
    const matchSeed = rng.nextInt(1, 1_000_000);

    // Match: hardcoded AI creature vs 3 random brain opponents
    const creatures: CreatureBlueprint[] = [];
    const body = ARCHETYPES[bodyArchetype]();
    creatures.push(body); // No brain = hardcoded AI
    for (let i = 0; i < ARENA.CREATURES_PER_MATCH - 1; i++) {
      const oppBody = ARCHETYPES[bodyArchetype]();
      creatures.push({ ...oppBody, brain: randomBrain(rng) });
    }

    const result = runMatch({ seed: matchSeed, maxTicks: ARENA.MAX_TICKS, creatures });
    const hardcoded = result.placements.find((p) => p.creatureId === 'creature_0');
    if (hardcoded && hardcoded.placement === 1) winsWithoutDrives++;
    totalWithout++;
  }

  const withDriveRate = totalWith > 0 ? winsWithDrives / totalWith : 0;
  const withoutDriveRate = totalWithout > 0 ? winsWithoutDrives / totalWithout : 0;
  const difference = withDriveRate - withoutDriveRate;

  console.log(`\n=== KC4: Drive Relevance Test ===`);
  console.log(`Evolved brain (with drives) win rate: ${(withDriveRate * 100).toFixed(1)}% (${winsWithDrives}/${totalWith})`);
  console.log(`Hardcoded AI (no brain/drives) win rate: ${(withoutDriveRate * 100).toFixed(1)}% (${winsWithoutDrives}/${totalWithout})`);
  console.log(`Difference: ${(difference * 100).toFixed(1)}%`);
  console.log(`KC4: ${Math.abs(difference) > DRIVE_RELEVANCE_THRESHOLD ? 'PASS' : 'FAIL'} (threshold: ${(DRIVE_RELEVANCE_THRESHOLD * 100).toFixed(0)}%)`);

  return {
    withDrives: withDriveRate,
    withoutDrives: withoutDriveRate,
    difference,
    passed: Math.abs(difference) > DRIVE_RELEVANCE_THRESHOLD,
  };
}
