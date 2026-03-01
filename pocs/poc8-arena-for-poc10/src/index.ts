import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runMatch } from './simulation/match.js';
import { validateCreature } from './simulation/validator.js';
import { ARENA, TOURNAMENT, EVOLUTION } from './simulation/constants.js';
import { buildAllArchetypes, getArchetypeNames, type ArchetypeName } from './harness/archetypes.js';
import { runTournament } from './harness/tournament.js';
import { printBalanceReport } from './harness/balance-report.js';
import { runEvolution, testDriveRelevance } from './harness/evolution.js';

const DEFAULT_SEED = 42;
const RESULTS_DIR = join(dirname(new URL(import.meta.url).pathname), '..', 'results');

interface ParsedArgs {
  command: string;
  seed: number;
  matches: number;
  generations: number;
  population: number;
  body: ArchetypeName;
  testDrives: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'balance';
  let seed = DEFAULT_SEED;
  let matches = TOURNAMENT.DEFAULT_MATCHES_PER_COMBO;
  let generations = EVOLUTION.DEFAULT_GENERATIONS;
  let population = EVOLUTION.DEFAULT_POPULATION_SIZE;
  let body: ArchetypeName = 'berserker';
  let testDrives = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      seed = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--matches' && args[i + 1]) {
      matches = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--generations' && args[i + 1]) {
      generations = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--population' && args[i + 1]) {
      population = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--body' && args[i + 1]) {
      const validNames = getArchetypeNames();
      if (!validNames.includes(args[i + 1] as ArchetypeName)) {
        console.error(`Invalid body archetype: ${args[i + 1]}. Valid: ${validNames.join(', ')}`);
        process.exit(1);
      }
      body = args[i + 1] as ArchetypeName;
      i++;
    } else if (args[i] === '--test-drives') {
      testDrives = true;
    }
  }

  return { command, seed, matches, generations, population, body, testDrives };
}

function runSingleMatch(seed: number): void {
  const archetypes = buildAllArchetypes();

  console.log('=== ClawWorld Single Match ===');
  console.log(`Seed: ${seed}`);
  console.log('');

  // Validate all archetypes first
  for (const { name, blueprint } of archetypes) {
    const validation = validateCreature(blueprint);
    if (!validation.valid) {
      console.error(`INVALID archetype "${name}":`);
      for (const err of validation.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    if (validation.errors.length > 0) {
      console.log(`[WARN] ${name}: ${validation.errors.join('; ')}`);
    }
  }

  const creatures = archetypes.map(({ blueprint }) => blueprint);
  const result = runMatch({
    seed,
    maxTicks: ARENA.MAX_TICKS,
    creatures,
  });

  console.log(`Match completed in ${result.tickCount} ticks`);
  console.log('');
  console.log('Results:');
  for (const p of result.placements) {
    const status = p.deathCause === 'survived' ? 'SURVIVED' : `DIED (${p.deathCause})`;
    console.log(`  #${p.placement} ${p.creatureName.padEnd(12)} ${status}`);
    console.log(
      `     dmg dealt: ${p.damageDealt.toFixed(1)}, dmg taken: ${p.damageTaken.toFixed(1)}, ` +
        `parts lost: ${p.partsLost}, parts destroyed: ${p.partsDestroyed}, ` +
        `survived: ${p.ticksSurvived} ticks`
    );
  }

  // Save match result JSON
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const filepath = join(RESULTS_DIR, `match-${timestamp}-seed${seed}.json`);
  writeFileSync(filepath, JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2) + '\n');
  console.log(`\nResults saved to ${filepath}`);
}

function runBalanceReport(matchesPerCombo: number): void {
  const archetypes = buildAllArchetypes();

  // Validate all archetypes
  for (const { name, blueprint } of archetypes) {
    const validation = validateCreature(blueprint);
    if (!validation.valid) {
      console.error(`INVALID archetype "${name}":`);
      for (const err of validation.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
  }

  console.log(`Running tournament with ${matchesPerCombo} matches per combination...`);
  const startTime = performance.now();

  const result = runTournament({
    matchesPerCombination: matchesPerCombo,
    archetypes,
  });

  const elapsed = performance.now() - startTime;
  console.log(`Completed ${result.totalMatches} matches in ${(elapsed / 1000).toFixed(2)}s`);

  printBalanceReport(result);
}

function runEvolutionCommand(): void {
  const startTime = performance.now();

  const result = runEvolution({
    bodyArchetype: body,
    populationSize: population,
    generations,
    matchesPerEval: matches < EVOLUTION.DEFAULT_MATCHES_PER_EVAL
      ? EVOLUTION.DEFAULT_MATCHES_PER_EVAL
      : matches,
    seed,
  });

  const elapsed = performance.now() - startTime;
  console.log(`\nEvolution completed in ${(elapsed / 1000).toFixed(1)}s`);

  // Run KC4 drive relevance test if requested
  if (testDrives && result.generationStats.length > 0) {
    const bestBrain = result.generationStats[result.generationStats.length - 1].bestBrain;
    const KC4_MATCH_COUNT = 100;
    const driveResult = testDriveRelevance(bestBrain, body, KC4_MATCH_COUNT, seed + 1);
    result.killConditions.driveRelevance = {
      passed: driveResult.passed,
      message: `Evolved=${(driveResult.withDrives * 100).toFixed(1)}% vs Hardcoded=${(driveResult.withoutDrives * 100).toFixed(1)}%, diff=${(driveResult.difference * 100).toFixed(1)}%`,
    };
  }

  // Save results
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const filepath = join(RESULTS_DIR, `evolution-${body}-${timestamp}.json`);

  const output = {
    timestamp: new Date().toISOString(),
    config: result.config,
    randomBaselineFitness: result.randomBaselineFitness,
    generationBeatRandom: result.generationBeatRandom,
    killConditions: result.killConditions,
    generations: result.generationStats.map((g) => ({
      generation: g.generation,
      bestFitness: g.bestFitness,
      avgFitness: g.avgFitness,
      diversity: g.diversity,
    })),
    elapsedSeconds: elapsed / 1000,
  };

  writeFileSync(filepath, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nResults saved to ${filepath}`);
}

// ── Main ──────────────────────────────────────────────────────────

const { command, seed, matches, generations, population, body, testDrives } = parseArgs();

switch (command) {
  case 'match':
    runSingleMatch(seed);
    break;
  case 'balance':
    runBalanceReport(matches);
    break;
  case 'evolve':
    runEvolutionCommand();
    break;
  default:
    console.log('Usage:');
    console.log('  bun run src/index.ts match [--seed N]');
    console.log('  bun run src/index.ts balance [--matches N]');
    console.log('  bun run src/index.ts evolve [--generations N] [--population N] [--body ARCHETYPE] [--matches N] [--seed N] [--test-drives]');
    break;
}
