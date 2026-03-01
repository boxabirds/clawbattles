#!/usr/bin/env bun
/**
 * Submit 16 creatures (cycling through 10 archetypes) with generated names,
 * then optionally start a match with team assignments.
 *
 * Usage:
 *   bun run agent/src/submit-archetypes.ts              # submit only
 *   bun run agent/src/submit-archetypes.ts --start      # submit + start match
 */

import { StdbClient } from './stdb-client';
import { getArchetypeNames, getBodyJson } from './archetypes';
import { generateName } from './names';
import { randomBrain, SimpleRNG, type BrainData } from './brain-utils';

const CREATURES_PER_MATCH = 16;
const TEAMS_PER_MATCH = 4;
const CREATURES_PER_TEAM = 4;
const BRAIN_TOPOLOGY = [24, 16, 8, 4];
const SEED = 42;

async function main() {
  const shouldStart = process.argv.includes('--start');
  const client = new StdbClient({ host: 'http://127.0.0.1:3000', database: 'poc8arena' });
  await client.init();
  console.log('Connected to SpacetimeDB.\n');

  const rng = new SimpleRNG(SEED);
  const archetypes = getArchetypeNames();

  // Submit 16 creatures, cycling through archetypes
  const submittedNames: string[] = [];
  for (let i = 0; i < CREATURES_PER_MATCH; i++) {
    const archetype = archetypes[i % archetypes.length];
    const name = generateName(i);
    const bodyJson = getBodyJson(archetype);
    const brain: BrainData = randomBrain(rng);
    const topologyJson = JSON.stringify(BRAIN_TOPOLOGY);
    const weightsJson = JSON.stringify(brain.weights);

    await client.submitCreature(name, bodyJson, topologyJson, weightsJson);
    const teamIdx = Math.floor(i / CREATURES_PER_TEAM);
    submittedNames.push(name);
    console.log(`Submitted [team ${teamIdx}]: ${name} (${archetype})`);
  }

  console.log(`\nDone. ${CREATURES_PER_MATCH} creatures submitted.`);

  if (shouldStart) {
    // Get the 16 most recent design IDs
    const designIds = await client.getLatestDesignIds(CREATURES_PER_MATCH);
    if (designIds.length < CREATURES_PER_MATCH) {
      throw new Error(`Need ${CREATURES_PER_MATCH} designs, only found ${designIds.length}`);
    }

    // Build entries with team assignments: first 4 = team 0, next 4 = team 1, etc.
    const entries = designIds.map((id, i) => ({
      designId: Number(id),
      teamIdx: Math.floor(i / CREATURES_PER_TEAM),
    }));

    console.log('\nStarting match...');
    await client.startMatch(entries);
    console.log('Match started!');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
