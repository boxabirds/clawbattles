/**
 * Seed 16 creatures (4 archetypes x 4 variants) and start a match.
 * Called by start.sh after publishing the module.
 */

import { BRAIN } from '../src/simulation/constants.js';
import { totalWeightCount } from '../src/simulation/brain.js';
import { generateName } from '../agent/src/names.js';

const SERVER = 'http://127.0.0.1:3000';
const DB_IDENTITY = 'c2007354cbec693eeb8b0619abe0ba6207975489269c76378eb8240939bcf5a1';

const CREATURES_PER_MATCH = 16;
const CREATURES_PER_TEAM = 4;

// ── Part tree builder ────────────────────────────────────────────

let counter = 0;
function p(partId: string, children: ReturnType<typeof p>[] = []) {
  return { partId, instanceId: `${partId}_${counter++}`, children };
}

// ── Archetypes ───────────────────────────────────────────────────

const archetypes = [
  (suffix: string) => {
    counter = 100;
    return {
      name: `Berserker ${suffix}`,
      body: p('body_small', [
        p('leg_long', [p('claw_large')]),
        p('leg_long', [p('claw_small')]),
        p('sensor_eye'),
        p('spike'),
      ]),
    };
  },
  (suffix: string) => {
    counter = 200;
    return {
      name: `Tank ${suffix}`,
      body: p('body_large', [
        p('leg_short'),
        p('leg_short'),
        p('leg_short', [p('claw_small')]),
        p('sensor_antenna'),
        p('armor_plate'),
        p('shell_dorsal'),
      ]),
    };
  },
  (suffix: string) => {
    counter = 300;
    return {
      name: `Flanker ${suffix}`,
      body: p('body_small', [
        p('leg_long', [p('claw_small')]),
        p('leg_long', [p('claw_small')]),
        p('sensor_eye'),
        p('spike'),
      ]),
    };
  },
  (suffix: string) => {
    counter = 400;
    return {
      name: `Spiker ${suffix}`,
      body: p('body_large', [
        p('leg_short', [p('spike')]),
        p('leg_short', [p('spike')]),
        p('leg_short', [p('spike')]),
        p('leg_short', [p('spike')]),
        p('sensor_antenna'),
        p('sensor_antenna'),
      ]),
    };
  },
];

// ── Random brain weights ─────────────────────────────────────────

function randomBrainWeights(): number[] {
  const n = totalWeightCount(BRAIN.TOPOLOGY);
  return Array.from({ length: n }, () => {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  });
}

// ── HTTP API helper ──────────────────────────────────────────────

async function callReducer(name: string, args: unknown[]): Promise<void> {
  const url = `${SERVER}/v1/database/${DB_IDENTITY}/call/${name}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${name} failed (${resp.status}): ${text}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding 16 creatures...');
  const designIds: number[] = [];

  for (let i = 0; i < CREATURES_PER_MATCH; i++) {
    const archetype = archetypes[i % archetypes.length];
    const { body } = archetype('');
    const name = generateName(i);
    const weights = randomBrainWeights();

    await callReducer('submit_creature', [
      name,
      JSON.stringify(body),
      JSON.stringify(Array.from(BRAIN.TOPOLOGY)),
      JSON.stringify(weights),
    ]);
    designIds.push(i + 1);
    console.log(`  ${name}`);
  }

  // Start match — entries format: [{designId, teamIdx}]
  const entries = designIds.map((id, i) => ({
    designId: id,
    teamIdx: Math.floor(i / CREATURES_PER_TEAM),
  }));

  await callReducer('start_match', [JSON.stringify(entries)]);
  console.log(`Match started with ${CREATURES_PER_MATCH} creatures!`);
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
