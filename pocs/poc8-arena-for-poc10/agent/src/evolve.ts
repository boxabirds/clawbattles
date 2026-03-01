#!/usr/bin/env bun
/**
 * POC 8 Arena: Evolution Agent
 *
 * Evolves neural net brains for creatures against the live SpacetimeDB server.
 *
 * Modes:
 *   --mode server    Connect to SpacetimeDB, submit designs, run matches (default)
 *   --mode headless  Use in-process headless simulation (100x faster)
 *
 * Usage:
 *   bun run agent/src/evolve.ts --mode server --generations 5 --population 8
 *   bun run agent/src/evolve.ts --mode headless --generations 100 --population 32
 */

import { StdbClient, type MatchCreatureResult } from './stdb-client';
import {
  SimpleRNG,
  randomBrain,
  mutate,
  crossover,
  EVOLUTION,
  type BrainData,
} from './brain-utils';
import { getBodyJson, type ArchetypeName } from './archetypes';

// ── Configuration ─────────────────────────────────────────────────

interface Config {
  mode: 'server' | 'headless';
  generations: number;
  population: number;
  body: ArchetypeName;
  seed: number;
  host: string;
  database: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    mode: 'server',
    generations: 5,
    population: 8,
    body: 'berserker',
    seed: 42,
    host: 'http://127.0.0.1:3000',
    database: 'poc8arena',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mode':
        config.mode = args[++i] as 'server' | 'headless';
        break;
      case '--generations':
        config.generations = parseInt(args[++i]);
        break;
      case '--population':
        config.population = parseInt(args[++i]);
        break;
      case '--body':
        config.body = args[++i] as ArchetypeName;
        break;
      case '--seed':
        config.seed = parseInt(args[++i]);
        break;
      case '--host':
        config.host = args[++i];
        break;
      case '--database':
        config.database = args[++i];
        break;
    }
  }

  return config;
}

// ── Fitness scoring ───────────────────────────────────────────────

const FITNESS_WEIGHTS = {
  /** Placement-based: 1st=1.0, 2nd=0.66, 3rd=0.33, 4th=0.0 */
  PLACEMENT: 1.0,
  /** Damage dealt normalized to [0,1] */
  DAMAGE: 0.3,
  /** Survival bonus (alive at end = 1.0) */
  SURVIVAL: 0.2,
} as const;

const MAX_EXPECTED_DAMAGE = 200;
const CREATURES_PER_MATCH = 16;
const CREATURES_PER_TEAM = 4;

function fitnessFromResult(result: MatchCreatureResult): number {
  // Placement score: linearly maps [1,4] to [1.0,0.0]
  const placementScore = 1 - (result.placement - 1) / (CREATURES_PER_MATCH - 1);

  // Damage score: normalized to [0,1]
  const damageScore = Math.min(1, result.damageDealt / MAX_EXPECTED_DAMAGE);

  // Survival bonus
  const survivalScore = result.alive ? 1.0 : 0.0;

  return (
    placementScore * FITNESS_WEIGHTS.PLACEMENT +
    damageScore * FITNESS_WEIGHTS.DAMAGE +
    survivalScore * FITNESS_WEIGHTS.SURVIVAL
  );
}

// ── Individual ────────────────────────────────────────────────────

interface Individual {
  brain: BrainData;
  fitness: number;
  matchCount: number;
}

// ── Server-mode evolution ─────────────────────────────────────────

async function runServerEvolution(config: Config): Promise<void> {
  const rng = new SimpleRNG(config.seed);
  const client = new StdbClient({ host: config.host, database: config.database });

  console.log('Connecting to SpacetimeDB...');
  await client.init();
  console.log('Connected.\n');

  const bodyJson = getBodyJson(config.body);
  const topologyJson = JSON.stringify(Array.from([24, 16, 8, 4]));

  // Initialize population
  let population: Individual[] = [];
  for (let i = 0; i < config.population; i++) {
    population.push({ brain: randomBrain(rng), fitness: 0, matchCount: 0 });
  }

  console.log(`=== Server Evolution: ${config.body} ===`);
  console.log(`Population: ${config.population}, Generations: ${config.generations}`);
  console.log(`Matches per generation: ${Math.ceil(config.population / CREATURES_PER_MATCH)}`);
  console.log('');

  for (let gen = 1; gen <= config.generations; gen++) {
    const genStart = Date.now();

    // Reset fitness
    for (const ind of population) {
      ind.fitness = 0;
      ind.matchCount = 0;
    }

    // Shuffle population indices for random grouping
    const indices = Array.from({ length: config.population }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Run matches in groups of 4
    const matchesThisGen = Math.ceil(config.population / CREATURES_PER_MATCH);

    for (let m = 0; m < matchesThisGen; m++) {
      const groupStart = m * CREATURES_PER_MATCH;
      const groupIndices = indices.slice(groupStart, groupStart + CREATURES_PER_MATCH);

      // If we don't have a full group of 4, pad with random individuals
      while (groupIndices.length < CREATURES_PER_MATCH) {
        groupIndices.push(rng.nextInt(0, config.population - 1));
      }

      // Submit creature designs for this group
      const names: string[] = [];
      for (let i = 0; i < groupIndices.length; i++) {
        const popIdx = groupIndices[i];
        const name = `g${gen}_m${m}_${i}_pop${popIdx}`;
        names.push(name);

        await client.submitCreature(
          name,
          bodyJson,
          topologyJson,
          JSON.stringify(population[popIdx].brain.weights),
        );
      }

      // Get the design IDs we just created
      const designIds = await client.getLatestDesignIds(CREATURES_PER_MATCH);

      // Track previous match ID so we wait for the NEW match to finish
      const prevMatchId = await client.getLatestMatchId();

      // Start match — assign teams round-robin
      const entries = designIds.map((id, i) => ({
        designId: Number(id),
        teamIdx: Math.floor(i / CREATURES_PER_TEAM),
      }));
      await client.startMatch(entries);

      // Wait for match to finish (only matches after prevMatchId)
      const matchId = await client.waitForMatchFinish(prevMatchId);

      // Get results
      const results = await client.getMatchResults(matchId);

      // Score each creature
      for (let i = 0; i < groupIndices.length; i++) {
        const popIdx = groupIndices[i];
        const name = names[i];
        const result = results.find((r) => r.name === name);
        if (result) {
          const score = fitnessFromResult(result);
          population[popIdx].fitness += score;
          population[popIdx].matchCount++;
        }
      }

      process.stdout.write(`  Match ${m + 1}/${matchesThisGen} complete\r`);
    }

    // Average fitness across matches played
    for (const ind of population) {
      if (ind.matchCount > 0) {
        ind.fitness /= ind.matchCount;
      }
    }

    // Sort by fitness descending
    population.sort((a, b) => b.fitness - a.fitness);

    const bestFitness = population[0].fitness;
    const avgFitness = population.reduce((s, ind) => s + ind.fitness, 0) / config.population;
    const genMs = Date.now() - genStart;

    console.log(
      `Gen ${String(gen).padStart(3)}: ` +
      `best=${bestFitness.toFixed(4)} ` +
      `avg=${avgFitness.toFixed(4)} ` +
      `(${(genMs / 1000).toFixed(1)}s)`,
    );

    // Selection + reproduction (skip on last generation)
    if (gen < config.generations) {
      const eliteCount = Math.max(2, Math.floor(config.population * EVOLUTION.ELITE_FRACTION));
      const randomCount = Math.max(1, Math.floor(config.population * EVOLUTION.RANDOM_INJECTION_FRACTION));
      const offspringCount = config.population - eliteCount - randomCount;

      const nextGen: Individual[] = [];

      // Keep elites
      for (let i = 0; i < eliteCount; i++) {
        nextGen.push({ brain: population[i].brain, fitness: 0, matchCount: 0 });
      }

      // Generate offspring
      for (let i = 0; i < offspringCount; i++) {
        const parentA = population[rng.nextInt(0, eliteCount - 1)];
        const parentB = population[rng.nextInt(0, eliteCount - 1)];

        let child: BrainData;
        if (rng.next() < EVOLUTION.CROSSOVER_RATE) {
          child = crossover(parentA.brain, parentB.brain, rng);
        } else {
          child = { topology: parentA.brain.topology, weights: [...parentA.brain.weights] };
        }
        child = mutate(child, rng);

        nextGen.push({ brain: child, fitness: 0, matchCount: 0 });
      }

      // Inject random brains
      for (let i = 0; i < randomCount; i++) {
        nextGen.push({ brain: randomBrain(rng), fitness: 0, matchCount: 0 });
      }

      population = nextGen;
    }
  }

  // Final results
  console.log('\n=== Evolution Complete ===');
  console.log(`Best fitness: ${population[0].fitness.toFixed(4)}`);
  console.log(`Best brain weights (first 10): [${population[0].brain.weights.slice(0, 10).map((w) => w.toFixed(3)).join(', ')}...]`);
}

// ── Headless-mode evolution ───────────────────────────────────────

async function runHeadlessEvolution(config: Config): Promise<void> {
  // Delegate to the existing headless evolution harness
  const { runEvolution, testDriveRelevance } = await import(
    '../../src/harness/evolution.js'
  );

  const result = runEvolution({
    bodyArchetype: config.body,
    populationSize: config.population,
    generations: config.generations,
    matchesPerEval: 10,
    seed: config.seed,
  });

  // Save results
  const outPath = `evolution-result-${config.body}-${Date.now()}.json`;
  await Bun.write(outPath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  console.log(`POC 8 Arena: Evolution Agent`);
  console.log(`Mode: ${config.mode} | Body: ${config.body} | Pop: ${config.population} | Gens: ${config.generations}\n`);

  if (config.mode === 'server') {
    await runServerEvolution(config);
  } else {
    await runHeadlessEvolution(config);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
