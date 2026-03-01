/**
 * POC 8: ClawWorld Battle Arena — Reducers
 *
 * All reducers, lifecycle hooks, and combat logic.
 * Brain inference, drive updates, and 7 combat phases run inside tick_match.
 */

import spacetimedb from './schema';
import {
  scheduledReducerHolder,
  TickSchedule,
  Match,
  MatchCreature,
  MatchPart,
  MatchWeapon,
  MatchSensor,
  ArenaState,
  BUDGET, ARENA, SPEED, COMBAT, DRIVES, BRAIN, STAMINA, SEPARATION, HILL,
  TICK_INTERVAL_MICROS,
  PART_CATALOG,
  getPartDef,
  type PartDefinition,
} from './schema';
import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

export default spacetimedb;

// ── Types for in-memory combat state ──────────────────────────────

interface BrainLayer {
  weights: number[];
  biases: number[];
  outSize: number;
}

interface Vec2 { x: number; y: number }

/** Parsed body tree node from JSON */
interface PartNode {
  partId: string;
  instanceId: string;
  children: PartNode[];
}

// ── Module-level brain cache ──────────────────────────────────────
// Parsed brain layers, keyed by matchId → creatureIdx → layers
// Populated on start_match, cleared on match finish.

const brainCache = new Map<bigint, Map<number, BrainLayer[]>>();

// ── Brain math (copied from simulation/brain.ts) ─────────────────

function parseBrainWeights(topology: readonly number[], weights: number[]): BrainLayer[] {
  const layers: BrainLayer[] = [];
  let offset = 0;
  for (let l = 0; l < topology.length - 1; l++) {
    const inSize = topology[l];
    const outSize = topology[l + 1];
    const weightCount = inSize * outSize;
    layers.push({
      weights: weights.slice(offset, offset + weightCount),
      biases: weights.slice(offset + weightCount, offset + weightCount + outSize),
      outSize,
    });
    offset += weightCount + outSize;
  }
  return layers;
}

function brainForward(input: number[], layers: BrainLayer[]): number[] {
  let current = input;
  for (const layer of layers) {
    const next = new Array(layer.outSize).fill(0);
    for (let j = 0; j < layer.outSize; j++) {
      let sum = layer.biases[j];
      for (let i = 0; i < current.length; i++) {
        sum += current[i] * layer.weights[i * layer.outSize + j];
      }
      next[j] = Math.tanh(sum);
    }
    current = next;
  }
  return current;
}

// ── Geometry helpers ──────────────────────────────────────────────

function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleTo(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function normalizeAngle(angle: number): number {
  const TWO_PI = Math.PI * 2;
  let result = angle % TWO_PI;
  if (result < 0) result += TWO_PI;
  return result;
}

function isInArc(targetAngle: number, facingAngle: number, arcRadians: number): boolean {
  const FULL_CIRCLE = Math.PI * 2;
  if (arcRadians >= FULL_CIRCLE) return true;
  const halfArc = arcRadians / 2;
  const diff = normalizeAngle(targetAngle - facingAngle);
  return diff <= halfArc || diff >= FULL_CIRCLE - halfArc;
}

function clampToArena(pos: Vec2): Vec2 {
  const d = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
  if (d <= ARENA.RADIUS) return pos;
  const scale = ARENA.RADIUS / d;
  return { x: pos.x * scale, y: pos.y * scale };
}

// ── Body tree flattening ─────────────────────────────────────────

interface FlatPart {
  instanceId: string;
  parentInstanceId: string;
  partId: string;
  definition: PartDefinition;
}

function flattenBody(node: PartNode, parentInstanceId: string): FlatPart[] {
  const def = getPartDef(node.partId);
  const parts: FlatPart[] = [{
    instanceId: node.instanceId,
    parentInstanceId,
    partId: node.partId,
    definition: def,
  }];
  for (const child of node.children) {
    parts.push(...flattenBody(child, node.instanceId));
  }
  return parts;
}

// ── Stat recalculation from flat tables ──────────────────────────

interface CreatureStats {
  totalWeight: number;
  totalEnergyDrain: number;
  totalArmor: number;
  contactDamage: number;
  speed: number;
}

function recalcStatsFromParts(parts: Array<{ partId: string; attached: boolean }>): CreatureStats {
  let totalWeight = 0;
  let totalEnergyDrain = 0;
  let totalArmor = 0;
  let contactDamage = 0;
  let legFactor = 0;
  let legCount = 0;

  for (const p of parts) {
    if (!p.attached) continue;
    const def = getPartDef(p.partId);
    totalWeight += def.weight;
    totalEnergyDrain += def.energyPerTick;
    totalArmor += def.armorValue;
    if (def.contactDamage != null) contactDamage += def.contactDamage;
    if (def.role === 'locomotion' && def.speedContribution != null) {
      legCount++;
      if (legCount <= SPEED.LEG_DIMINISHING_RETURNS_THRESHOLD) {
        legFactor += def.speedContribution;
      } else {
        legFactor += def.speedContribution * SPEED.LEG_DIMINISHING_FACTOR;
      }
    }
  }

  const normalizedLegFactor = legCount > 0 ? legFactor / SPEED.BASELINE_LEG_DIVISOR : 0;
  const weightFraction = totalWeight / BUDGET.MAX_WEIGHT;
  const weightFactor = Math.max(SPEED.MIN_WEIGHT_FACTOR, 1 - weightFraction);
  const speed = SPEED.BASE * weightFactor * normalizedLegFactor;

  return { totalWeight, totalEnergyDrain, totalArmor, contactDamage, speed };
}

// ── Spawn positions (team-clustered) ─────────────────────────────

function getTeamSpawnPositions(): Array<{ x: number; y: number; facing: number }> {
  const spawnRadius = ARENA.RADIUS * ARENA.SPAWN_RADIUS_FRACTION;
  const spawns: Array<{ x: number; y: number; facing: number }> = [];

  for (let team = 0; team < ARENA.TEAMS_PER_MATCH; team++) {
    const teamAngle = (team * 2 * Math.PI) / ARENA.TEAMS_PER_MATCH;
    const centerX = Math.cos(teamAngle) * spawnRadius;
    const centerY = Math.sin(teamAngle) * spawnRadius;
    const facingInward = teamAngle + Math.PI;

    for (let member = 0; member < ARENA.CREATURES_PER_TEAM; member++) {
      const memberAngle = (member * 2 * Math.PI) / ARENA.CREATURES_PER_TEAM;
      const clusterRadius = ARENA.TEAM_CLUSTER_SPREAD * 0.5;
      spawns.push({
        x: centerX + Math.cos(memberAngle) * clusterRadius,
        y: centerY + Math.sin(memberAngle) * clusterRadius,
        facing: facingInward,
      });
    }
  }

  return spawns;
}

/** Count how many distinct teams still have alive members */
function countAliveTeams(creatures: CreatureRow[]): number {
  const teams = new Set<number>();
  for (const c of creatures) {
    if (c.alive) teams.add(c.teamIdx);
  }
  return teams.size;
}

/** Stamina: after grace period, all parts decay — forces match resolution */
function staminaPhase(ctx: Ctx, matchId: bigint, creatures: CreatureRow[], tick: number): void {
  if (tick <= STAMINA.GRACE_PERIOD_TICKS) return;

  const ticksAfterGrace = tick - STAMINA.GRACE_PERIOD_TICKS;
  const decayRate = STAMINA.DECAY_RATE_PER_TICK + ticksAfterGrace * STAMINA.ACCELERATION;

  const parts = [...ctx.db.matchPart.iter()].filter(p => p.matchId === matchId);

  for (const c of creatures) {
    if (!c.alive) continue;
    const myParts = parts.filter(p => p.creatureIdx === c.creatureIdx && p.attached);

    for (const part of myParts) {
      const def = getPartDef(part.partId);
      const decay = def.durability * decayRate;
      ctx.db.matchPart.id.update({
        ...part,
        currentDurability: part.currentDurability - decay,
        accumulatedDamage: part.accumulatedDamage + decay,
      });
    }
  }
}

/** Separation: push overlapping creatures apart so they don't stack on top of each other.
 *  Accumulates displacements to avoid order-dependent bias, then applies all at once. */
function separationPhase(ctx: any, matchId: bigint, creatures: any[]): void {
  const alive = creatures.filter(c => c.alive);
  const displacements = new Map<number, { dx: number; dy: number }>();

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.posX - a.posX;
      const dy = b.posY - a.posY;
      const distSq = dx * dx + dy * dy;

      if (distSq >= SEPARATION.RADIUS * SEPARATION.RADIUS) continue;

      const d = Math.sqrt(distSq);

      if (d < SEPARATION.COINCIDENT_THRESHOLD) {
        // Coincident creatures: push along arbitrary axis to break degeneracy
        const push = SEPARATION.RADIUS * SEPARATION.STRENGTH * 0.5;
        const da = displacements.get(a.creatureIdx) ?? { dx: 0, dy: 0 };
        da.dx -= push;
        displacements.set(a.creatureIdx, da);

        const db = displacements.get(b.creatureIdx) ?? { dx: 0, dy: 0 };
        db.dx += push;
        displacements.set(b.creatureIdx, db);
        continue;
      }

      const overlap = SEPARATION.RADIUS - d;
      const push = overlap * SEPARATION.STRENGTH * 0.5; // half for each creature
      const nx = dx / d;
      const ny = dy / d;

      const da = displacements.get(a.creatureIdx) ?? { dx: 0, dy: 0 };
      da.dx -= nx * push;
      da.dy -= ny * push;
      displacements.set(a.creatureIdx, da);

      const db = displacements.get(b.creatureIdx) ?? { dx: 0, dy: 0 };
      db.dx += nx * push;
      db.dy += ny * push;
      displacements.set(b.creatureIdx, db);
    }
  }

  // Apply accumulated displacements and clamp to arena
  for (const c of alive) {
    const d = displacements.get(c.creatureIdx);
    if (!d) continue;
    const clamped = clampToArena({ x: c.posX + d.dx, y: c.posY + d.dy });
    ctx.db.matchCreature.id.update({ ...c, posX: clamped.x, posY: clamped.y });
  }
}

// ── Lifecycle reducers ────────────────────────────────────────────

export const init = spacetimedb.init((ctx) => {
  console.info('[init] POC 8 Arena module published. Scheduling tick.');
  ctx.db.tickSchedule.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(TICK_INTERVAL_MICROS),
  });
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  console.info(`[connect] Client connected: ${ctx.sender.toHexString().slice(0, 8)}`);
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  console.info(`[disconnect] Client disconnected: ${ctx.sender.toHexString().slice(0, 8)}`);
});

// ── submit_creature ───────────────────────────────────────────────

export const submit_creature = spacetimedb.reducer(
  {
    name: t.string(),
    bodyJson: t.string(),
    brainTopologyJson: t.string(),
    brainWeightsJson: t.string(),
  },
  (ctx, { name, bodyJson, brainTopologyJson, brainWeightsJson }) => {
    // Parse and validate body
    let body: PartNode;
    try {
      body = JSON.parse(bodyJson);
    } catch {
      throw new SenderError('Invalid body JSON');
    }

    // Flatten and validate
    const flatParts = flattenBody(body, '');
    if (flatParts.length > BUDGET.MAX_PARTS) {
      throw new SenderError(`Part count ${flatParts.length} exceeds MAX_PARTS (${BUDGET.MAX_PARTS})`);
    }

    let totalWeight = 0;
    for (const p of flatParts) totalWeight += p.definition.weight;
    if (totalWeight > BUDGET.MAX_WEIGHT) {
      throw new SenderError(`Total weight ${totalWeight} exceeds MAX_WEIGHT (${BUDGET.MAX_WEIGHT})`);
    }

    // Root must be a core
    if (flatParts[0].definition.role !== 'core') {
      throw new SenderError('Root part must be a core (body) part');
    }

    // Must have locomotion
    const hasLegs = flatParts.some((p) => p.definition.role === 'locomotion');
    if (!hasLegs) {
      throw new SenderError('Creature must have at least one leg');
    }

    // Validate brain if provided
    if (brainWeightsJson && brainWeightsJson !== '[]') {
      let topology: number[];
      let weights: number[];
      try {
        topology = JSON.parse(brainTopologyJson);
        weights = JSON.parse(brainWeightsJson);
      } catch {
        throw new SenderError('Invalid brain JSON');
      }

      if (topology.length !== BRAIN.TOPOLOGY.length) {
        throw new SenderError(`Brain topology must be [${BRAIN.TOPOLOGY.join(',')}]`);
      }
      for (let i = 0; i < topology.length; i++) {
        if (topology[i] !== BRAIN.TOPOLOGY[i]) {
          throw new SenderError(`Brain topology must be [${BRAIN.TOPOLOGY.join(',')}]`);
        }
      }
      if (weights.length !== BRAIN.TOTAL_WEIGHTS) {
        throw new SenderError(`Brain weights must have exactly ${BRAIN.TOTAL_WEIGHTS} values, got ${weights.length}`);
      }
      for (const w of weights) {
        if (!isFinite(w)) {
          throw new SenderError('Brain weights must all be finite numbers');
        }
      }
    }

    const row = ctx.db.creatureDesign.insert({
      designId: 0n,
      owner: ctx.sender,
      name,
      bodyJson,
      brainTopology: brainTopologyJson || '[]',
      brainWeights: brainWeightsJson || '[]',
    });

    console.info(`[submit] Design "${name}" saved as ${row.designId}`);
  }
);

// ── start_match ───────────────────────────────────────────────────

export const start_match = spacetimedb.reducer(
  {
    entriesJson: t.string(),
  },
  (ctx, { entriesJson }) => {
    // Auto-finish any running match so restarts work cleanly
    for (const m of ctx.db.match.iter()) {
      if (m.state === 'running') {
        const creatures: CreatureRow[] = [];
        for (const c of ctx.db.matchCreature.iter()) {
          if (c.matchId === m.matchId) creatures.push(c);
        }
        finishMatch(ctx, m, creatures, m.currentTick);
      }
    }

    // Parse entries: [{designId, teamIdx}]
    let entries: Array<{ designId: number; teamIdx: number }>;
    try {
      entries = JSON.parse(entriesJson);
    } catch {
      throw new SenderError('Invalid entries JSON');
    }

    if (entries.length !== ARENA.CREATURES_PER_MATCH) {
      throw new SenderError(`Expected ${ARENA.CREATURES_PER_MATCH} entries, got ${entries.length}`);
    }

    const designs = entries.map((entry) => {
      const d = ctx.db.creatureDesign.designId.find(BigInt(entry.designId));
      if (!d) throw new SenderError(`Design ${entry.designId} not found`);
      return { design: d, teamIdx: entry.teamIdx };
    });

    const seed = Date.now() & 0xFFFFFFFF;

    // Read or create ArenaState singleton, compute hill radius from round
    let arenaState = ctx.db.arenaState.id.find(0n);
    if (!arenaState) {
      arenaState = ctx.db.arenaState.insert({ id: 0n, roundNumber: 1 });
    }
    const roundIndex = Math.min(arenaState.roundNumber - 1, HILL.RADII.length - 1);
    const hillRadius = HILL.RADII[roundIndex] ?? HILL.MIN_RADIUS;

    const match = ctx.db.match.insert({
      matchId: 0n,
      state: 'running',
      seed,
      currentTick: 0,
      maxTicks: ARENA.MAX_TICKS,
      hillRadius,
      winCondition: '',
    });

    const spawns = getTeamSpawnPositions();
    const matchBrains = new Map<number, BrainLayer[]>();
    const teamMemberCount = new Map<number, number>();

    for (let i = 0; i < designs.length; i++) {
      const { design, teamIdx } = designs[i];

      // Assign spawn position based on team and member index within team
      const memberIdx = teamMemberCount.get(teamIdx) ?? 0;
      teamMemberCount.set(teamIdx, memberIdx + 1);
      const spawnIdx = teamIdx * ARENA.CREATURES_PER_TEAM + memberIdx;
      const spawn = spawns[spawnIdx];

      // Parse body and flatten into MatchPart rows
      const body: PartNode = JSON.parse(design.bodyJson);
      const flatParts = flattenBody(body, '');

      // Calculate initial stats
      const stats = recalcStatsFromParts(
        flatParts.map((p) => ({ partId: p.partId, attached: true }))
      );

      // Insert creature
      ctx.db.matchCreature.insert({
        id: 0n,
        matchId: match.matchId,
        creatureIdx: i,
        designId: design.designId,
        name: design.name,
        teamIdx,
        posX: spawn.x,
        posY: spawn.y,
        facing: spawn.facing,
        speed: stats.speed,
        alive: true,
        deathCause: '',
        tickOfDeath: 0,
        aggression: DRIVES.AGGRESSION_BASELINE,
        fear: DRIVES.FEAR_BASELINE,
        pain: DRIVES.PAIN_BASELINE,
        exploration: DRIVES.EXPLORATION_BASELINE,
        tickDamageDealt: 0,
        tickDamageTaken: 0,
        tickPartsLost: 0,
        hadVisibleEnemies: false,
        brainStance: 0,
        damageDealt: 0,
        damageTaken: 0,
        partsLost: 0,
        partsDestroyed: 0,
        totalWeight: stats.totalWeight,
        totalEnergyDrain: stats.totalEnergyDrain,
        totalArmor: stats.totalArmor,
        contactDamage: stats.contactDamage,
        placement: 0,
      });

      // Insert parts
      for (const p of flatParts) {
        ctx.db.matchPart.insert({
          id: 0n,
          matchId: match.matchId,
          creatureIdx: i,
          instanceId: p.instanceId,
          parentInstanceId: p.parentInstanceId,
          partId: p.partId,
          currentDurability: p.definition.durability,
          accumulatedDamage: 0,
          attached: true,
        });

        // Insert weapon rows
        if (p.definition.damage != null && p.definition.reach != null) {
          ctx.db.matchWeapon.insert({
            id: 0n,
            matchId: match.matchId,
            creatureIdx: i,
            instanceId: p.instanceId,
            damage: p.definition.damage,
            reach: p.definition.reach,
            attached: true,
          });
        }

        // Insert sensor rows
        if (p.definition.sensorRange != null && p.definition.sensorArc != null) {
          ctx.db.matchSensor.insert({
            id: 0n,
            matchId: match.matchId,
            creatureIdx: i,
            instanceId: p.instanceId,
            range: p.definition.sensorRange,
            arcRadians: (p.definition.sensorArc * Math.PI) / 180,
            attached: true,
          });
        }
      }

      // Parse brain into cache
      const brainWeights: number[] = JSON.parse(design.brainWeights);
      if (brainWeights.length === BRAIN.TOTAL_WEIGHTS) {
        const layers = parseBrainWeights(BRAIN.TOPOLOGY, brainWeights);
        matchBrains.set(i, layers);
      }
    }

    brainCache.set(match.matchId, matchBrains);
    console.info(`[start_match] Match ${match.matchId} started with ${designs.length} creatures, seed ${seed}`);
  }
);

// ── tick_match (scheduled reducer) ────────────────────────────────

export const tick_match = spacetimedb.reducer(
  { arg: TickSchedule.rowType },
  (ctx, { arg: _scheduleRow }) => {
    // Find running match
    let match: any | null = null;
    for (const m of ctx.db.match.iter()) {
      if (m.state === 'running') { match = m; break; }
    }
    if (!match) return;

    const startTime = Date.now();
    const tick = match.currentTick + 1;

    // Load all creatures for this match
    const creatures = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);
    const alive = creatures.filter((c) => c.alive);
    if (countAliveTeams(alive) <= 1) {
      finishMatch(ctx, match, creatures, tick);
      return;
    }

    // Reset per-tick deltas
    for (const c of alive) {
      ctx.db.matchCreature.id.update({
        ...c,
        tickDamageDealt: 0,
        tickDamageTaken: 0,
        tickPartsLost: 0,
        brainStance: 0,
        hadVisibleEnemies: false,
      });
    }

    // Reload creatures after reset
    const cs = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);

    // Phase 1: Energy
    energyPhase(ctx, match.matchId, cs);

    // Phase 2: Stamina (fatigue decay after grace period)
    staminaPhase(ctx, match.matchId, cs, tick);

    // Phase 3: Drive update
    driveUpdatePhase(ctx, match.matchId, cs);

    // Reload after mutations
    const cs2 = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);

    // Phase 4: Sense
    const visibility = sensePhase(ctx, match.matchId, cs2);

    // Update visibility tracking
    for (const c of cs2) {
      if (!c.alive) continue;
      const hasEnemies = (visibility.get(c.creatureIdx)?.length ?? 0) > 0;
      if (hasEnemies !== c.hadVisibleEnemies) {
        ctx.db.matchCreature.id.update({ ...c, hadVisibleEnemies: hasEnemies });
      }
    }

    // Phase 5: Brain + Movement
    const cs3 = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);
    brainAndMovementPhase(ctx, match.matchId, cs3, visibility, tick);

    // Phase 5b: Separation (push overlapping creatures apart after movement)
    const cs3b = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);
    separationPhase(ctx, match.matchId, cs3b);

    // Phase 6: Attack
    const cs4 = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);
    const hits = attackPhase(ctx, match.matchId, cs4, tick);

    // Phase 7: Damage
    damagePhase(ctx, match.matchId, hits, tick);

    // Phase 8: Death check
    const cs5 = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);
    deathCheckPhase(ctx, match.matchId, cs5, tick);

    // Update tick
    ctx.db.match.matchId.update({ ...match, currentTick: tick });

    // Check if match should end
    const cs6 = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === match.matchId);
    const stillAlive = cs6.filter((c) => c.alive);
    if (countAliveTeams(stillAlive) <= 1 || tick >= match.maxTicks) {
      finishMatch(ctx, { ...match, currentTick: tick }, cs6, tick);
    }

    // Record tick metrics
    const durationMicros = BigInt((Date.now() - startTime) * 1000);
    ctx.db.tickMetrics.insert({
      id: 0n,
      matchId: match.matchId,
      tick,
      durationMicros,
    });
  }
);

// Wire scheduled table
scheduledReducerHolder.ref = tick_match;

// ── Phase implementations ─────────────────────────────────────────

type Ctx = Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0];
type CreatureRow = any;

function energyPhase(ctx: Ctx, matchId: bigint, creatures: CreatureRow[]): void {
  for (const c of creatures) {
    if (!c.alive) continue;
    const deficit = c.totalEnergyDrain - BUDGET.ENERGY_PER_TICK;
    if (deficit > 0) {
      const selfDamage = deficit * COMBAT.ENERGY_DEFICIT_DAMAGE_RATE;
      // Apply to core (first part = root)
      const parts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId);
      const core = parts.find((p) => p.creatureIdx === c.creatureIdx && p.parentInstanceId === '' && p.attached);
      if (core) {
        ctx.db.matchPart.id.update({
          ...core,
          currentDurability: core.currentDurability - selfDamage,
          accumulatedDamage: core.accumulatedDamage + selfDamage,
        });
      }
      ctx.db.matchCreature.id.update({
        ...c,
        damageTaken: c.damageTaken + selfDamage,
        tickDamageTaken: c.tickDamageTaken + selfDamage,
      });
    }
  }
}

function driveUpdatePhase(ctx: Ctx, matchId: bigint, creatures: CreatureRow[]): void {
  for (const c of creatures) {
    if (!c.alive) continue;

    let aggression = c.aggression + (DRIVES.AGGRESSION_BASELINE - c.aggression) * DRIVES.DECAY_RATE;
    let fear = c.fear + (DRIVES.FEAR_BASELINE - c.fear) * DRIVES.DECAY_RATE;
    let pain = c.pain + (DRIVES.PAIN_BASELINE - c.pain) * DRIVES.DECAY_RATE;
    let exploration = c.exploration + (DRIVES.EXPLORATION_BASELINE - c.exploration) * DRIVES.DECAY_RATE;

    pain = Math.min(1, pain + c.tickDamageTaken * DRIVES.PAIN_SPIKE_PER_DAMAGE);
    fear = Math.min(1, fear
      + c.tickDamageTaken * DRIVES.FEAR_SPIKE_PER_DAMAGE
      + c.tickPartsLost * DRIVES.FEAR_SPIKE_PER_PART_LOST);
    aggression = Math.min(1, aggression + c.tickDamageDealt * DRIVES.AGGRESSION_SPIKE_PER_DAMAGE);

    if (!c.hadVisibleEnemies) {
      exploration = Math.min(1, exploration + DRIVES.EXPLORATION_INCREASE_RATE);
    }

    aggression = Math.max(0, Math.min(1, aggression));
    fear = Math.max(0, Math.min(1, fear));
    pain = Math.max(0, Math.min(1, pain));
    exploration = Math.max(0, Math.min(1, exploration));

    ctx.db.matchCreature.id.update({
      ...c,
      aggression, fear, pain, exploration,
    });
  }
}

interface VisibleEnemy {
  creatureIdx: number;
  creature: CreatureRow;
  distance: number;
  angle: number;
}

function sensePhase(
  ctx: Ctx,
  matchId: bigint,
  creatures: CreatureRow[],
): Map<number, VisibleEnemy[]> {
  const sensors = [...ctx.db.matchSensor.iter()].filter((s) => s.matchId === matchId);
  const visibility = new Map<number, VisibleEnemy[]>();

  for (const c of creatures) {
    if (!c.alive) continue;

    const mySensors = sensors.filter((s) => s.creatureIdx === c.creatureIdx && s.attached);
    if (mySensors.length === 0) {
      visibility.set(c.creatureIdx, []);
      continue;
    }

    const visible: VisibleEnemy[] = [];
    const pos: Vec2 = { x: c.posX, y: c.posY };

    for (const other of creatures) {
      if (other.teamIdx === c.teamIdx || !other.alive) continue;

      const otherPos: Vec2 = { x: other.posX, y: other.posY };
      const d = dist(pos, otherPos);
      const angle = angleTo(pos, otherPos);

      for (const sensor of mySensors) {
        if (d <= sensor.range && isInArc(angle, c.facing, sensor.arcRadians)) {
          visible.push({ creatureIdx: other.creatureIdx, creature: other, distance: d, angle });
          break;
        }
      }
    }

    visibility.set(c.creatureIdx, visible);
  }

  return visibility;
}

function brainAndMovementPhase(
  ctx: Ctx,
  matchId: bigint,
  creatures: CreatureRow[],
  visibility: Map<number, VisibleEnemy[]>,
  tick: number,
): void {
  const matchBrains = brainCache.get(matchId);

  for (const c of creatures) {
    if (!c.alive || c.speed <= 0) continue;

    const visible = visibility.get(c.creatureIdx) ?? [];
    const brain = matchBrains?.get(c.creatureIdx);

    if (brain) {
      // Brain-driven movement
      const input = composeBrainInput(c, visible, ctx, matchId);
      const rawOutput = brainForward(input, brain);
      const output = decodeBrainOutput(rawOutput, visible.length);

      const moveSpeed = c.speed * output.movementSpeed;
      const absoluteAngle = c.facing + output.movementAngle;

      let newX = c.posX + Math.cos(absoluteAngle) * moveSpeed;
      let newY = c.posY + Math.sin(absoluteAngle) * moveSpeed;

      let newFacing = c.facing;
      if (output.targetIndex >= 0 && output.targetIndex < visible.length) {
        const target = visible[output.targetIndex].creature;
        newFacing = angleTo({ x: c.posX, y: c.posY }, { x: target.posX, y: target.posY });
      } else if (moveSpeed > 0.01) {
        newFacing = absoluteAngle;
      }

      const clamped = clampToArena({ x: newX, y: newY });

      ctx.db.matchCreature.id.update({
        ...c,
        posX: clamped.x,
        posY: clamped.y,
        facing: newFacing,
        brainStance: output.stance,
      });
    } else {
      // Hardcoded AI fallback — simple approach nearest visible enemy or wander
      hardcodedAI(ctx, c, visible, tick);
    }
  }
}

function composeBrainInput(
  c: CreatureRow,
  visible: VisibleEnemy[],
  ctx: Ctx,
  matchId: bigint,
): number[] {
  const input = new Array(BRAIN.INPUT_SIZE).fill(0);

  // Drives (0..3)
  input[0] = c.aggression * 2 - 1;
  input[1] = c.fear * 2 - 1;
  input[2] = c.pain * 2 - 1;
  input[3] = c.exploration * 2 - 1;

  // Own state (4..11)
  const parts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId)
    .filter((p) => p.creatureIdx === c.creatureIdx);
  const attachedParts = parts.filter((p) => p.attached);

  let maxDur = 0;
  let curDur = 0;
  for (const p of parts) {
    maxDur += getPartDef(p.partId).durability;
  }
  for (const p of attachedParts) {
    curDur += Math.max(0, p.currentDurability);
  }
  const healthFrac = maxDur > 0 ? curDur / maxDur : 0;

  input[4] = healthFrac * 2 - 1;
  input[5] = c.speed / 3 - 1;
  input[6] = c.facing / Math.PI;
  input[7] = c.posX / ARENA.RADIUS;
  input[8] = c.posY / ARENA.RADIUS;

  // Count attached weapons
  const weapons = [...ctx.db.matchWeapon.iter()].filter((w) => w.matchId === matchId)
    .filter((w) => w.creatureIdx === c.creatureIdx && w.attached);
  const MAX_WEAPON_COUNT = 4;
  input[9] = weapons.length / MAX_WEAPON_COUNT * 2 - 1;
  input[10] = c.totalArmor / BUDGET.MAX_WEIGHT * 2 - 1;

  const energySurplus = BUDGET.ENERGY_PER_TICK - c.totalEnergyDrain;
  input[11] = energySurplus / BUDGET.ENERGY_PER_TICK;

  // Visible enemies (12..23)
  const enemyCount = Math.min(visible.length, BRAIN.MAX_VISIBLE_ENEMIES);
  for (let e = 0; e < enemyCount; e++) {
    const enemy = visible[e];
    const base = 12 + e * BRAIN.FEATURES_PER_ENEMY;

    const relAngle = enemy.angle - c.facing;
    input[base + 0] = Math.sin(relAngle);

    const ARENA_DIAMETER = ARENA.RADIUS * 2;
    input[base + 1] = 1 - (enemy.distance / ARENA_DIAMETER) * 2;

    // Approximate size from attached part count
    const enemyParts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId)
      .filter((p) => p.creatureIdx === enemy.creatureIdx && p.attached);
    input[base + 2] = enemyParts.length / BUDGET.MAX_PARTS * 2 - 1;

    // Is approaching
    const dx = c.posX - enemy.creature.posX;
    const dy = c.posY - enemy.creature.posY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      const towardX = dx / d;
      const towardY = dy / d;
      const enemyFacingX = Math.cos(enemy.creature.facing);
      const enemyFacingY = Math.sin(enemy.creature.facing);
      input[base + 3] = towardX * enemyFacingX + towardY * enemyFacingY;
    }
  }

  return input;
}

function decodeBrainOutput(rawOutput: number[], visibleEnemyCount: number) {
  const movementAngle = rawOutput[0] * Math.PI;
  const movementSpeed = (rawOutput[1] + 1) / 2;

  let targetIndex = -1;
  if (visibleEnemyCount > 0) {
    const normalized = (rawOutput[2] + 1) / 2;
    targetIndex = Math.min(Math.floor(normalized * visibleEnemyCount), visibleEnemyCount - 1);
  }

  const stance = rawOutput[3];
  return { movementAngle, movementSpeed, targetIndex, stance };
}

function hardcodedAI(ctx: Ctx, c: CreatureRow, visible: VisibleEnemy[], tick: number): void {
  const pos: Vec2 = { x: c.posX, y: c.posY };
  const distFromCenter = Math.sqrt(pos.x * pos.x + pos.y * pos.y);

  // Hill pull strength ramps up after AI_HILL_AWARENESS_TICK, proportional to distance from center
  const hillAware = tick >= HILL.AI_HILL_AWARENESS_TICK;
  const hillPullStrength = hillAware
    ? HILL.AI_HILL_PULL * Math.min(1, distFromCenter / HILL.AI_HILL_PULL_DISTANCE)
    : 0;

  // Direction toward center (0,0)
  const toCenterAngle = Math.atan2(-pos.y, -pos.x);
  const hillDx = Math.cos(toCenterAngle);
  const hillDy = Math.sin(toCenterAngle);

  let moveDx: number;
  let moveDy: number;

  if (visible.length > 0) {
    // Chase nearest enemy, blended with hill pull
    const nearest = visible.reduce((a, b) => a.distance < b.distance ? a : b);
    const chaseAngle = angleTo(pos, { x: nearest.creature.posX, y: nearest.creature.posY });
    const chaseDx = Math.cos(chaseAngle);
    const chaseDy = Math.sin(chaseAngle);

    // Blend: (1 - hillPull) * chase + hillPull * toCenter
    const chaseWeight = 1 - hillPullStrength;
    moveDx = chaseWeight * chaseDx + hillPullStrength * hillDx;
    moveDy = chaseWeight * chaseDy + hillPullStrength * hillDy;

    const approachDist = Math.max(0, nearest.distance - 1.0);
    const step = Math.min(c.speed, approachDist);
    const moveLen = Math.sqrt(moveDx * moveDx + moveDy * moveDy) || 1;
    const newX = c.posX + (moveDx / moveLen) * step;
    const newY = c.posY + (moveDy / moveLen) * step;
    const clamped = clampToArena({ x: newX, y: newY });
    const newFacing = Math.atan2(moveDy, moveDx);
    ctx.db.matchCreature.id.update({ ...c, posX: clamped.x, posY: clamped.y, facing: newFacing });
  } else {
    // No enemies visible — full speed toward center (no dawdling at the edge)
    moveDx = hillDx;
    moveDy = hillDy;
    const newX = c.posX + moveDx * c.speed;
    const newY = c.posY + moveDy * c.speed;
    const clamped = clampToArena({ x: newX, y: newY });
    const newFacing = Math.atan2(moveDy, moveDx);
    ctx.db.matchCreature.id.update({ ...c, posX: clamped.x, posY: clamped.y, facing: newFacing });
  }
}

interface Hit {
  attackerIdx: number;
  targetIdx: number;
  damage: number;
  weaponId: string;
}

function attackPhase(ctx: Ctx, matchId: bigint, creatures: CreatureRow[], tick: number): Hit[] {
  const weapons = [...ctx.db.matchWeapon.iter()].filter((w) => w.matchId === matchId);
  const hits: Hit[] = [];

  for (const attacker of creatures) {
    if (!attacker.alive) continue;

    const isDefensive = brainCache.get(matchId)?.has(attacker.creatureIdx)
      && attacker.brainStance < DRIVES.DEFENSIVE_STANCE_THRESHOLD;

    // Active weapons
    const myWeapons = weapons.filter((w) => w.creatureIdx === attacker.creatureIdx && w.attached);
    for (const weapon of myWeapons) {
      if (isDefensive && weapon.reach > COMBAT.CONTACT_RANGE) continue;

      let bestIdx = -1;
      let bestDist = Infinity;

      for (const target of creatures) {
        if (target.teamIdx === attacker.teamIdx || !target.alive) continue;
        const d = dist(
          { x: attacker.posX, y: attacker.posY },
          { x: target.posX, y: target.posY },
        );
        if (d <= weapon.reach && d < bestDist) {
          bestDist = d;
          bestIdx = target.creatureIdx;
        }
      }

      if (bestIdx >= 0) {
        // Emit swing event before evasion (enables swing animation even on misses)
        ctx.db.matchEvent.insert({
          matchId, tick,
          creatureIdx: attacker.creatureIdx,
          eventType: 'attack_swing',
          data: JSON.stringify({ weaponInstanceId: weapon.instanceId, targetIdx: bestIdx }),
        });

        const speedBonus = 1 + (attacker.speed * attacker.speed) * SPEED.SPEED_DAMAGE_BONUS_FACTOR;
        hits.push({
          attackerIdx: attacker.creatureIdx,
          targetIdx: bestIdx,
          damage: weapon.damage * speedBonus,
          weaponId: weapon.instanceId,
        });
      }
    }

    // Spike contact damage
    if (attacker.contactDamage > 0) {
      for (const target of creatures) {
        if (target.teamIdx === attacker.teamIdx || !target.alive) continue;
        const d = dist(
          { x: attacker.posX, y: attacker.posY },
          { x: target.posX, y: target.posY },
        );
        if (d <= COMBAT.CONTACT_RANGE) {
          hits.push({
            attackerIdx: attacker.creatureIdx,
            targetIdx: target.creatureIdx,
            damage: attacker.contactDamage,
            weaponId: 'spikes',
          });
        }
      }
    }

    // Body bump damage — weight-based collision damage prevents weaponless stalemates
    const bumpDamage = attacker.totalWeight * COMBAT.BUMP_DAMAGE_PER_WEIGHT;
    if (bumpDamage > 0) {
      for (const target of creatures) {
        if (target.teamIdx === attacker.teamIdx || !target.alive) continue;
        const d = dist(
          { x: attacker.posX, y: attacker.posY },
          { x: target.posX, y: target.posY },
        );
        if (d <= COMBAT.CONTACT_RANGE) {
          hits.push({
            attackerIdx: attacker.creatureIdx,
            targetIdx: target.creatureIdx,
            damage: bumpDamage,
            weaponId: 'bump',
          });
        }
      }
    }
  }

  return hits;
}

function damagePhase(ctx: Ctx, matchId: bigint, hits: Hit[], tick: number): void {
  for (const hit of hits) {
    // Reload target (may have been modified by previous hit)
    const creatures = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === matchId);
    const target = creatures.find((c) => c.creatureIdx === hit.targetIdx);
    const attacker = creatures.find((c) => c.creatureIdx === hit.attackerIdx);
    if (!target || !target.alive || !attacker) continue;

    // Evasion
    const evasionChance = Math.min(
      target.speed * target.speed * COMBAT.EVASION_PER_SPEED_SQ,
      COMBAT.MAX_EVASION,
    );
    if (ctx.random() < evasionChance) continue;

    // Choose hit part
    const parts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId)
      .filter((p) => p.creatureIdx === hit.targetIdx && p.attached);
    if (parts.length === 0) continue;

    // Weighted random part selection
    const weights: number[] = [];
    for (const p of parts) {
      const def = getPartDef(p.partId);
      if (def.role === 'passive_armor') weights.push(COMBAT.HIT_WEIGHT_PASSIVE_ARMOR);
      else if (def.role === 'armor') weights.push(COMBAT.HIT_WEIGHT_ARMOR);
      else if (def.role === 'core') weights.push(COMBAT.HIT_WEIGHT_CORE);
      else weights.push(COMBAT.HIT_WEIGHT_DEFAULT);
    }

    let totalWeight = 0;
    for (const w of weights) totalWeight += w;
    let roll = ctx.random() * totalWeight;
    let hitPartIdx = parts.length - 1;
    for (let i = 0; i < parts.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { hitPartIdx = i; break; }
    }
    const hitPart = parts[hitPartIdx];

    // Armor reduction
    const armorReduction = Math.min(
      target.totalArmor * COMBAT.ARMOR_REDUCTION_PER_POINT,
      COMBAT.MAX_ARMOR_REDUCTION,
    );
    let effectiveDamage = hit.damage * (1 - armorReduction);

    // Shell flat reduction
    const hitDef = getPartDef(hitPart.partId);
    if (hitDef.role === 'passive_armor' && hit.weaponId !== 'spikes') {
      effectiveDamage = Math.max(0, effectiveDamage - COMBAT.SHELL_FLAT_REDUCTION);
    }

    if (effectiveDamage <= 0) continue;

    // Apply damage to hit part
    ctx.db.matchPart.id.update({
      ...hitPart,
      currentDurability: hitPart.currentDurability - effectiveDamage,
      accumulatedDamage: hitPart.accumulatedDamage + effectiveDamage,
    });

    // Propagate to parent
    if (hitPart.parentInstanceId) {
      const parent = parts.find((p) => p.instanceId === hitPart.parentInstanceId && p.attached);
      if (parent) {
        const propagated = effectiveDamage * COMBAT.JOINT_DAMAGE_PROPAGATION;
        ctx.db.matchPart.id.update({
          ...parent,
          currentDurability: parent.currentDurability - propagated,
          accumulatedDamage: parent.accumulatedDamage + propagated,
        });
      }
    }

    // Update stats
    ctx.db.matchCreature.id.update({
      ...attacker,
      damageDealt: attacker.damageDealt + effectiveDamage,
      tickDamageDealt: attacker.tickDamageDealt + effectiveDamage,
    });
    ctx.db.matchCreature.id.update({
      ...target,
      damageTaken: target.damageTaken + effectiveDamage,
      tickDamageTaken: target.tickDamageTaken + effectiveDamage,
    });

    // Emit event
    ctx.db.matchEvent.insert({
      matchId,
      tick,
      creatureIdx: hit.targetIdx,
      eventType: 'contact_hit',
      data: JSON.stringify({ damage: effectiveDamage, hitPart: hitPart.instanceId, attackerIdx: hit.attackerIdx }),
    });

    // Check for part detachment
    detachDestroyedParts(ctx, matchId, hit.targetIdx, hit.attackerIdx, tick);
  }
}

function detachDestroyedParts(
  ctx: Ctx,
  matchId: bigint,
  ownerIdx: number,
  attackerIdx: number,
  tick: number,
): void {
  const allParts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId)
    .filter((p) => p.creatureIdx === ownerIdx && p.attached);

  // Find root (parentInstanceId === '')
  const root = allParts.find((p) => p.parentInstanceId === '');
  if (!root) return;

  // Check all non-root parts for destruction
  for (const part of allParts) {
    if (part.parentInstanceId === '' || part.currentDurability > 0) continue;

    // Detach this part and its subtree iteratively
    const toDetach = [part.instanceId];
    const detached: string[] = [];

    while (toDetach.length > 0) {
      const instanceId = toDetach.pop()!;
      detached.push(instanceId);

      // Find children of this instance
      const children = allParts.filter((p) =>
        p.parentInstanceId === instanceId && p.attached && !detached.includes(p.instanceId)
      );
      for (const child of children) {
        toDetach.push(child.instanceId);
      }
    }

    // Mark all as detached
    const currentParts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId)
      .filter((p) => p.creatureIdx === ownerIdx);
    for (const instanceId of detached) {
      const p = currentParts.find((pp) => pp.instanceId === instanceId && pp.attached);
      if (p) {
        ctx.db.matchPart.id.update({ ...p, attached: false });
      }
    }

    // Mark corresponding weapons/sensors as detached
    const allWeapons = [...ctx.db.matchWeapon.iter()].filter((w) => w.matchId === matchId)
      .filter((w) => w.creatureIdx === ownerIdx);
    for (const w of allWeapons) {
      if (detached.includes(w.instanceId) && w.attached) {
        ctx.db.matchWeapon.id.update({ ...w, attached: false });
      }
    }
    const allSensors = [...ctx.db.matchSensor.iter()].filter((s) => s.matchId === matchId)
      .filter((s) => s.creatureIdx === ownerIdx);
    for (const s of allSensors) {
      if (detached.includes(s.instanceId) && s.attached) {
        ctx.db.matchSensor.id.update({ ...s, attached: false });
      }
    }

    // Update owner stats
    const owner = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === matchId)
      .find((c) => c.creatureIdx === ownerIdx);
    const attacker = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === matchId)
      .find((c) => c.creatureIdx === attackerIdx);

    if (owner) {
      ctx.db.matchCreature.id.update({
        ...owner,
        partsLost: owner.partsLost + detached.length,
        tickPartsLost: owner.tickPartsLost + detached.length,
      });
    }
    if (attacker) {
      ctx.db.matchCreature.id.update({
        ...attacker,
        partsDestroyed: attacker.partsDestroyed + detached.length,
      });
    }

    // Emit events
    ctx.db.matchEvent.insert({
      matchId, tick,
      creatureIdx: ownerIdx,
      eventType: 'part_lost',
      data: JSON.stringify({ partId: part.partId, instanceId: part.instanceId, count: detached.length }),
    });

    // Recalculate owner stats from remaining attached parts
    const remainingParts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId)
      .filter((p) => p.creatureIdx === ownerIdx);
    const stats = recalcStatsFromParts(remainingParts);

    const updatedOwner = [...ctx.db.matchCreature.iter()].filter((c) => c.matchId === matchId)
      .find((c) => c.creatureIdx === ownerIdx);
    if (updatedOwner) {
      ctx.db.matchCreature.id.update({
        ...updatedOwner,
        totalWeight: stats.totalWeight,
        totalEnergyDrain: stats.totalEnergyDrain,
        totalArmor: stats.totalArmor,
        contactDamage: stats.contactDamage,
        speed: stats.speed,
      });
    }
  }
}

function deathCheckPhase(ctx: Ctx, matchId: bigint, creatures: CreatureRow[], tick: number): void {
  for (const c of creatures) {
    if (!c.alive) continue;

    const parts = [...ctx.db.matchPart.iter()].filter((p) => p.matchId === matchId)
      .filter((p) => p.creatureIdx === c.creatureIdx);

    let cause: string | null = null;

    // Core destroyed
    const core = parts.find((p) => p.parentInstanceId === '' && p.attached);
    if (!core || core.currentDurability <= 0) {
      cause = 'core_destroyed';
    }

    // No locomotion
    if (!cause) {
      const attachedParts = parts.filter((p) => p.attached);
      const hasLegs = attachedParts.some((p) => getPartDef(p.partId).role === 'locomotion');
      if (!hasLegs) {
        cause = 'no_locomotion';
      }
    }

    if (cause) {
      ctx.db.matchCreature.id.update({
        ...c,
        alive: false,
        deathCause: cause,
        tickOfDeath: tick,
      });

      ctx.db.matchEvent.insert({
        matchId, tick,
        creatureIdx: c.creatureIdx,
        eventType: 'enemy_killed',
        data: JSON.stringify({ cause }),
      });
    }
  }
}

function finishMatch(
  ctx: Ctx,
  match: any,
  creatures: CreatureRow[],
  finalTick: number,
): void {
  const survivors = creatures.filter((c) => c.alive);
  const dead = creatures.filter((c) => !c.alive)
    .sort((a, b) => (b.tickOfDeath || 0) - (a.tickOfDeath || 0));

  const aliveTeams = countAliveTeams(survivors);
  let winCondition: string;
  let rankedSurvivors: CreatureRow[];

  if (aliveTeams <= 1) {
    // Elimination: only one team (or zero) left
    winCondition = 'elimination';
    rankedSurvivors = survivors.sort((a, b) => b.damageDealt - a.damageDealt);
  } else {
    // Time expired with multiple teams — hill control decides
    const hillRadius = match.hillRadius as number;

    // Count alive creatures per team inside the hill circle
    const teamHillCount = new Map<number, number>();
    const teamTotalHp = new Map<number, number>();

    const allParts = [...ctx.db.matchPart.iter()].filter(p => p.matchId === match.matchId);

    for (const c of survivors) {
      const distFromCenter = Math.sqrt(c.posX * c.posX + c.posY * c.posY);
      if (distFromCenter <= hillRadius) {
        teamHillCount.set(c.teamIdx, (teamHillCount.get(c.teamIdx) ?? 0) + 1);
      }

      // Total remaining HP of attached parts for tiebreaker
      const myParts = allParts.filter(p => p.creatureIdx === c.creatureIdx && p.attached);
      let hp = 0;
      for (const p of myParts) {
        hp += Math.max(0, p.currentDurability);
      }
      teamTotalHp.set(c.teamIdx, (teamTotalHp.get(c.teamIdx) ?? 0) + hp);
    }

    const anyoneInCircle = [...teamHillCount.values()].some(count => count > 0);

    if (anyoneInCircle) {
      // Sort teams by hill count descending, then total HP as tiebreaker
      const teamScores = [...new Set(survivors.map(c => c.teamIdx))].map(teamIdx => ({
        teamIdx,
        hillCount: teamHillCount.get(teamIdx) ?? 0,
        totalHp: teamTotalHp.get(teamIdx) ?? 0,
      }));
      teamScores.sort((a, b) => {
        if (b.hillCount !== a.hillCount) return b.hillCount - a.hillCount;
        return b.totalHp - a.totalHp;
      });

      const topHillCount = teamScores[0].hillCount;
      const tiedTeams = teamScores.filter(t => t.hillCount === topHillCount);
      winCondition = tiedTeams.length > 1 && topHillCount > 0 ? 'tiebreaker' : 'hill_control';

      // Rank survivors: winning team's creatures first (sorted by damage), then others
      const teamOrder = teamScores.map(t => t.teamIdx);
      rankedSurvivors = [...survivors].sort((a, b) => {
        const aOrder = teamOrder.indexOf(a.teamIdx);
        const bOrder = teamOrder.indexOf(b.teamIdx);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return b.damageDealt - a.damageDealt;
      });
    } else {
      // Nobody in circle — total HP tiebreaker across teams
      winCondition = 'tiebreaker';
      const teamScores = [...new Set(survivors.map(c => c.teamIdx))].map(teamIdx => ({
        teamIdx,
        totalHp: teamTotalHp.get(teamIdx) ?? 0,
      }));
      teamScores.sort((a, b) => b.totalHp - a.totalHp);

      const teamOrder = teamScores.map(t => t.teamIdx);
      rankedSurvivors = [...survivors].sort((a, b) => {
        const aOrder = teamOrder.indexOf(a.teamIdx);
        const bOrder = teamOrder.indexOf(b.teamIdx);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return b.damageDealt - a.damageDealt;
      });
    }
  }

  const ranked = [...rankedSurvivors, ...dead];
  for (let i = 0; i < ranked.length; i++) {
    ctx.db.matchCreature.id.update({
      ...ranked[i],
      placement: i + 1,
    });
  }

  ctx.db.match.matchId.update({ ...match, state: 'finished', winCondition });

  // Increment round number
  const arenaState = ctx.db.arenaState.id.find(0n);
  if (arenaState) {
    ctx.db.arenaState.id.update({ ...arenaState, roundNumber: arenaState.roundNumber + 1 });
  }

  // Clear brain cache
  brainCache.delete(match.matchId);

  const winningTeam = ranked[0]?.teamIdx;
  console.info(`[finish] Match ${match.matchId} finished at tick ${finalTick}. Condition: ${winCondition}, Winning team: ${winningTeam ?? 'none'}, MVP: ${ranked[0]?.name ?? 'none'}`);
}
