/**
 * Test script: submit 4 creature designs, start a match,
 * and poll tick metrics to verify KC2 (tick budget).
 *
 * Uses HTTP API directly for reducer calls (avoids CLI escaping).
 * Usage: bun run test-match.ts
 */

import { BRAIN } from '../src/simulation/constants.js';
import { totalWeightCount } from '../src/simulation/brain.js';

const SERVER = 'http://127.0.0.1:3000';
const DB_IDENTITY = 'c2007354cbec693eeb8b0619abe0ba6207975489269c76378eb8240939bcf5a1';

// ── Body blueprints ──────────────────────────────────────────────

let counter = 0;
function p(partId: string, children: any[] = []) {
  return { partId, instanceId: `${partId}_${counter++}`, children };
}

function berserkerBody() {
  counter = 100;
  return p('body_small', [
    p('leg_long', [p('claw_large')]),
    p('leg_long', [p('claw_small')]),
    p('sensor_eye'),
    p('spike'),
  ]);
}

function tankBody() {
  counter = 200;
  return p('body_large', [
    p('leg_short'),
    p('leg_short'),
    p('leg_short', [p('claw_small')]),
    p('sensor_antenna'),
    p('armor_plate'),
    p('shell_dorsal'),
  ]);
}

function flankerBody() {
  counter = 300;
  return p('body_small', [
    p('leg_long', [p('claw_small')]),
    p('leg_long', [p('claw_small')]),
    p('sensor_eye'),
    p('spike'),
  ]);
}

function spikerBody() {
  counter = 400;
  return p('body_large', [
    p('leg_short', [p('spike')]),
    p('leg_short', [p('spike')]),
    p('leg_short', [p('spike')]),
    p('leg_short', [p('spike')]),
    p('sensor_antenna'),
    p('sensor_antenna'),
  ]);
}

// ── Random brain weights ─────────────────────────────────────────

function randomBrainWeights(): number[] {
  const count = totalWeightCount(BRAIN.TOPOLOGY);
  const weights: number[] = [];
  for (let i = 0; i < count; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    weights.push(Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2));
  }
  return weights;
}

// ── HTTP API helpers ─────────────────────────────────────────────

async function callReducer(name: string, args: any[]): Promise<void> {
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

async function sql(query: string): Promise<string> {
  const proc = Bun.spawn(
    ['spacetime', 'sql', 'poc8arena', query],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('=== POC 8 Arena: KC2 Tick Budget Test ===\n');

  const bodies = [
    { name: 'Berserker', body: berserkerBody() },
    { name: 'Tank', body: tankBody() },
    { name: 'Flanker', body: flankerBody() },
    { name: 'Spiker', body: spikerBody() },
  ];

  // Submit 4 creature designs via HTTP API
  console.log('Submitting creature designs...');
  for (const { name, body } of bodies) {
    const brainWeights = randomBrainWeights();
    try {
      await callReducer('submit_creature', [
        name,
        JSON.stringify(body),
        JSON.stringify(Array.from(BRAIN.TOPOLOGY)),
        JSON.stringify(brainWeights),
      ]);
      console.log(`  Submitted: ${name}`);
    } catch (e: any) {
      console.error(`  Failed: ${name}: ${e.message}`);
      // Check server logs for crash details
      const logs = Bun.spawn(['spacetime', 'logs', 'poc8arena'], { stdout: 'pipe', stderr: 'pipe' });
      const logOut = await new Response(logs.stdout).text();
      await logs.exited;
      console.log('Server logs:', logOut.split('\n').slice(-10).join('\n'));
      process.exit(1);
    }
  }

  // Get design IDs
  const designResult = await sql('SELECT design_id, name FROM creature_design');
  console.log('\n' + designResult);

  const ids: number[] = [];
  for (const line of designResult.split('\n')) {
    const match = line.match(/^\s*(\d+)/);
    if (match) ids.push(parseInt(match[1]));
  }

  if (ids.length < 4) {
    console.error(`Only found ${ids.length} designs. Need 4.`);
    process.exit(1);
  }

  // Start match
  console.log(`\nStarting match with design IDs: ${ids.slice(0, 4).join(', ')}`);
  try {
    await callReducer('start_match', ids.slice(0, 4));
    console.log('Match started!\n');
  } catch (e: any) {
    console.error(`Failed to start match: ${e.message}`);
    const logs = Bun.spawn(['spacetime', 'logs', 'poc8arena'], { stdout: 'pipe', stderr: 'pipe' });
    const logOut = await new Response(logs.stdout).text();
    await logs.exited;
    console.log('Server logs:', logOut.split('\n').slice(-15).join('\n'));
    process.exit(1);
  }

  // Poll for match completion
  console.log('Waiting for match to complete...');
  const startTime = Date.now();
  const POLL_INTERVAL_MS = 3000;
  const TIMEOUT_MS = 120_000;

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const matchState = await sql('SELECT match_id, state, current_tick FROM match');
    const tickLine = matchState.split('\n').find(l => /\d/.test(l))?.trim() ?? 'no data';
    console.log(`  ${tickLine}`);

    if (matchState.includes('finished')) {
      console.log('\nMatch finished!');
      break;
    }
  }

  // Query results
  console.log('\n=== Match Results ===');
  const creatures = await sql(
    'SELECT name, alive, death_cause, damage_dealt, damage_taken, parts_lost, placement FROM match_creature'
  );
  console.log(creatures);

  // Get tick metrics
  const allDurations = await sql(
    'SELECT duration_micros FROM tick_metrics'
  );
  const durations: number[] = [];
  for (const line of allDurations.split('\n')) {
    const match = line.match(/(\d+)/);
    if (match) {
      const val = parseInt(match[1]);
      if (val > 0) durations.push(val);
    }
  }

  if (durations.length > 0) {
    durations.sort((a, b) => a - b);
    const p50Index = Math.floor(durations.length * 0.50);
    const p95Index = Math.floor(durations.length * 0.95);
    const p50 = durations[p50Index] / 1000;
    const p95 = durations[p95Index] / 1000;
    const avgMs = durations.reduce((s, d) => s + d, 0) / durations.length / 1000;
    const maxMs = durations[durations.length - 1] / 1000;

    console.log(`\n=== KC2 Tick Budget ===`);
    console.log(`Total ticks: ${durations.length}`);
    console.log(`Average: ${avgMs.toFixed(2)}ms`);
    console.log(`p50: ${p50.toFixed(2)}ms`);
    console.log(`p95: ${p95.toFixed(2)}ms`);
    console.log(`Max: ${maxMs.toFixed(2)}ms`);
    console.log(`\nKC2 (p95 < 80ms): ${p95 < 80 ? 'PASS' : 'FAIL'}`);
  } else {
    console.log('\nNo tick metrics found.');
    const logs = Bun.spawn(['spacetime', 'logs', 'poc8arena'], { stdout: 'pipe', stderr: 'pipe' });
    const logOut = await new Response(logs.stdout).text();
    await logs.exited;
    console.log('Last server logs:\n' + logOut.split('\n').slice(-30).join('\n'));
  }
}

main().catch(console.error);
