/**
 * POC 6: SpacetimeDB at Scale — Client Dashboard
 *
 * Connects to SpacetimeDB, subscribes to creature and tick_metrics tables,
 * and renders a live performance dashboard to validate whether SpacetimeDB
 * can handle 500+ creatures at <250ms per tick.
 */

import { DbConnection } from './module_bindings';
import type { Creature, Player, TickMetrics } from './module_bindings/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STDB_URI = `ws://${window.location.hostname}:3000`;
const STDB_DATABASE = 'poc6';
const AUTH_TOKEN_KEY = 'poc6_token';
const RECONNECT_DELAY_MS = 2000;
const MAX_LOG_ENTRIES = 50;

/** Kill condition threshold in milliseconds */
const KILL_THRESHOLD_MS = 250;

/** Minimum creature count to evaluate pass/fail */
const KILL_CREATURE_COUNT = 500;

/** Number of ticks displayed in the rolling chart */
const CHART_TICK_COUNT = 100;

/** Canvas chart bar colors */
const BAR_COLOR_OK = '#4ade80';
const BAR_COLOR_WARN = '#facc15';
const BAR_COLOR_CRIT = '#f87171';
const THRESHOLD_LINE_COLOR = '#f87171';
const CHART_TEXT_COLOR = '#666';
const CHART_AXIS_COLOR = '#2a2a4a';

/** Chart layout constants */
const CHART_PADDING_LEFT = 50;
const CHART_PADDING_RIGHT = 10;
const CHART_PADDING_TOP = 10;
const CHART_PADDING_BOTTOM = 20;
const CHART_FONT_SIZE = 10;
const Y_AXIS_TICK_COUNT = 5;

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

const connDot = document.getElementById('conn-dot')!;
const connStatus = document.getElementById('conn-status')!;
const identityEl = document.getElementById('identity')!;
const playersOnlineEl = document.getElementById('players-online')!;
const creatureCountEl = document.getElementById('creature-count')!;

const tickCurrentEl = document.getElementById('tick-current')!;
const tickAvgEl = document.getElementById('tick-avg')!;
const tickMaxEl = document.getElementById('tick-max')!;
const tickCreaturesEl = document.getElementById('tick-creatures')!;
const tickCombatEl = document.getElementById('tick-combat')!;

const verdictEl = document.getElementById('verdict')!;
const metricsBody = document.getElementById('metrics-body')!;
const logEl = document.getElementById('log')!;

const canvas = document.getElementById('chart') as HTMLCanvasElement;
const ctx2d = canvas.getContext('2d')!;

// Buttons
const btnSpawn10 = document.getElementById('btn-spawn-10')!;
const btnSpawn50 = document.getElementById('btn-spawn-50')!;
const btnSpawn100 = document.getElementById('btn-spawn-100')!;
const btnSpawn500 = document.getElementById('btn-spawn-500')!;
const btnReset = document.getElementById('btn-reset')!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let conn: DbConnection | null = null;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const div = document.createElement('div');
  const ts = new Date().toLocaleTimeString();
  div.textContent = `[${ts}] ${msg}`;
  logEl.prepend(div);
  while (logEl.children.length > MAX_LOG_ENTRIES) {
    logEl.removeChild(logEl.lastChild!);
  }
}

// ---------------------------------------------------------------------------
// Dashboard updates
// ---------------------------------------------------------------------------

function updateCreatureCount(): void {
  if (!conn) return;
  let count = 0;
  for (const _c of conn.db.creature.iter()) {
    count++;
  }
  creatureCountEl.textContent = String(count);
}

function updatePlayerCount(): void {
  if (!conn) return;
  let online = 0;
  for (const p of conn.db.player.iter()) {
    if (p.online) online++;
  }
  playersOnlineEl.textContent = String(online);
}

function getMetricsSorted(): TickMetrics[] {
  if (!conn) return [];
  const all: TickMetrics[] = [];
  for (const m of conn.db.tickMetrics.iter()) {
    all.push(m);
  }
  all.sort((a, b) => Number(a.tickNumber - b.tickNumber));
  return all;
}

function microsToMs(micros: bigint): number {
  return Number(micros) / 1000;
}

function updateMetrics(): void {
  const metrics = getMetricsSorted();
  if (metrics.length === 0) return;

  const latest = metrics[metrics.length - 1];
  const currentMs = microsToMs(latest.durationMicros);

  tickCurrentEl.textContent = `${currentMs.toFixed(2)} ms`;
  tickCreaturesEl.textContent = String(latest.creatureCount);
  tickCombatEl.textContent = String(latest.combatEvents);

  // Compute average and max
  let sum = 0;
  let max = 0;
  for (const m of metrics) {
    const ms = microsToMs(m.durationMicros);
    sum += ms;
    if (ms > max) max = ms;
  }
  const avg = sum / metrics.length;

  tickAvgEl.textContent = `${avg.toFixed(2)} ms`;
  tickMaxEl.textContent = `${max.toFixed(2)} ms`;

  // Update verdict
  if (latest.creatureCount >= KILL_CREATURE_COUNT) {
    if (avg < KILL_THRESHOLD_MS) {
      verdictEl.textContent = `PASS (avg ${avg.toFixed(1)}ms @ ${latest.creatureCount} creatures)`;
      verdictEl.className = 'verdict pass';
    } else {
      verdictEl.textContent = `FAIL (avg ${avg.toFixed(1)}ms @ ${latest.creatureCount} creatures)`;
      verdictEl.className = 'verdict fail';
    }
  } else {
    verdictEl.textContent = `WAITING (${latest.creatureCount}/${KILL_CREATURE_COUNT} creatures)`;
    verdictEl.className = 'verdict pending';
  }

  // Update recent ticks table (last 20)
  const recent = metrics.slice(-20).reverse();
  metricsBody.innerHTML = '';
  for (const m of recent) {
    const ms = microsToMs(m.durationMicros);
    const tr = document.createElement('tr');

    const warnClass = ms > KILL_THRESHOLD_MS ? 'crit' : ms > KILL_THRESHOLD_MS / 2 ? 'warn' : '';

    tr.innerHTML = `
      <td>${m.tickNumber.toString()}</td>
      <td>${m.creatureCount}</td>
      <td class="${warnClass}">${ms.toFixed(2)} ms</td>
      <td>${m.combatEvents}</td>
    `;
    metricsBody.appendChild(tr);
  }

  // Draw chart
  drawChart(metrics);
}

// ---------------------------------------------------------------------------
// Canvas chart
// ---------------------------------------------------------------------------

function drawChart(metrics: TickMetrics[]): void {
  // Handle high-DPI displays
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx2d.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;

  // Clear
  ctx2d.fillStyle = '#0a0a18';
  ctx2d.fillRect(0, 0, w, h);

  const plotLeft = CHART_PADDING_LEFT;
  const plotRight = w - CHART_PADDING_RIGHT;
  const plotTop = CHART_PADDING_TOP;
  const plotBottom = h - CHART_PADDING_BOTTOM;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  // Take last CHART_TICK_COUNT entries
  const data = metrics.slice(-CHART_TICK_COUNT);
  if (data.length === 0) return;

  // Determine Y scale — at least show up to the kill threshold
  let maxVal = KILL_THRESHOLD_MS;
  for (const m of data) {
    const ms = microsToMs(m.durationMicros);
    if (ms > maxVal) maxVal = ms;
  }
  maxVal = Math.ceil(maxVal * 1.2); // 20% headroom

  // Y-axis ticks
  ctx2d.fillStyle = CHART_TEXT_COLOR;
  ctx2d.font = `${CHART_FONT_SIZE}px monospace`;
  ctx2d.textAlign = 'right';
  ctx2d.textBaseline = 'middle';

  ctx2d.strokeStyle = CHART_AXIS_COLOR;
  ctx2d.lineWidth = 1;

  for (let i = 0; i <= Y_AXIS_TICK_COUNT; i++) {
    const val = (maxVal / Y_AXIS_TICK_COUNT) * i;
    const y = plotBottom - (val / maxVal) * plotH;

    ctx2d.fillText(`${val.toFixed(0)}`, plotLeft - 5, y);

    ctx2d.beginPath();
    ctx2d.moveTo(plotLeft, y);
    ctx2d.lineTo(plotRight, y);
    ctx2d.stroke();
  }

  // Draw bars
  const barWidth = Math.max(1, plotW / CHART_TICK_COUNT - 1);
  const gap = 1;

  for (let i = 0; i < data.length; i++) {
    const ms = microsToMs(data[i].durationMicros);
    const barH = (ms / maxVal) * plotH;
    const x = plotLeft + (i / CHART_TICK_COUNT) * plotW;
    const y = plotBottom - barH;

    if (ms > KILL_THRESHOLD_MS) {
      ctx2d.fillStyle = BAR_COLOR_CRIT;
    } else if (ms > KILL_THRESHOLD_MS / 2) {
      ctx2d.fillStyle = BAR_COLOR_WARN;
    } else {
      ctx2d.fillStyle = BAR_COLOR_OK;
    }

    ctx2d.fillRect(x, y, barWidth, barH);
  }

  // Draw kill threshold line
  const thresholdY = plotBottom - (KILL_THRESHOLD_MS / maxVal) * plotH;
  ctx2d.strokeStyle = THRESHOLD_LINE_COLOR;
  ctx2d.lineWidth = 2;
  ctx2d.setLineDash([6, 4]);
  ctx2d.beginPath();
  ctx2d.moveTo(plotLeft, thresholdY);
  ctx2d.lineTo(plotRight, thresholdY);
  ctx2d.stroke();
  ctx2d.setLineDash([]);

  // Label the threshold
  ctx2d.fillStyle = THRESHOLD_LINE_COLOR;
  ctx2d.textAlign = 'left';
  ctx2d.fillText(`${KILL_THRESHOLD_MS}ms KILL`, plotLeft + 4, thresholdY - 4);
}

// ---------------------------------------------------------------------------
// SpacetimeDB Connection
// ---------------------------------------------------------------------------

function connectToSTDB(token?: string): void {
  conn = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DATABASE)
    .withToken(token)
    .onConnect((connection, identity, newToken) => {
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
      connDot.classList.add('connected');
      connStatus.textContent = 'Connected';
      identityEl.textContent = identity.toHexString().slice(0, 16) + '...';
      log(`Connected as ${identity.toHexString().slice(0, 12)}...`);

      connection.subscriptionBuilder()
        .onApplied(() => {
          log('Subscriptions active');
          updateCreatureCount();
          updatePlayerCount();
          updateMetrics();
        })
        .onError((_ctx: unknown, err: unknown) => log(`Sub error: ${err}`))
        .subscribe([
          'SELECT * FROM player',
          'SELECT * FROM creature',
          'SELECT * FROM tick_metrics',
        ]);
    })
    .onConnectError((_ctx: unknown, err: unknown) => {
      connDot.classList.remove('connected');
      connStatus.textContent = 'Reconnecting...';
      log(`Connection error: ${err}`);

      // If we had a stored token, it's probably stale — retry without it
      if (token) {
        log('Clearing stale token and reconnecting...');
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
      } else {
        setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
      }
    })
    .onDisconnect(() => {
      connDot.classList.remove('connected');
      connStatus.textContent = 'Disconnected';
      log('Disconnected -- reconnecting...');
      setTimeout(
        () => connectToSTDB(localStorage.getItem(AUTH_TOKEN_KEY) || undefined),
        RECONNECT_DELAY_MS
      );
    })
    .build();

  // Player callbacks
  conn.db.player.onInsert((_ctx: unknown, _row: Player) => {
    updatePlayerCount();
  });
  conn.db.player.onUpdate((_ctx: unknown, _old: Player, _row: Player) => {
    updatePlayerCount();
  });
  conn.db.player.onDelete((_ctx: unknown, _row: Player) => {
    updatePlayerCount();
  });

  // Creature callbacks
  conn.db.creature.onInsert((_ctx: unknown, _row: Creature) => {
    updateCreatureCount();
  });
  conn.db.creature.onDelete((_ctx: unknown, _row: Creature) => {
    updateCreatureCount();
  });

  // TickMetrics callbacks
  conn.db.tickMetrics.onInsert((_ctx: unknown, _row: TickMetrics) => {
    updateMetrics();
  });
  conn.db.tickMetrics.onUpdate((_ctx: unknown, _old: TickMetrics, _row: TickMetrics) => {
    updateMetrics();
  });
  conn.db.tickMetrics.onDelete((_ctx: unknown, _row: TickMetrics) => {
    // Metrics pruned on server; just refresh
    updateMetrics();
  });
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

function callSpawnBatch(count: number): void {
  if (!conn) {
    log('Not connected');
    return;
  }
  log(`Spawning ${count} creatures...`);
  conn.reducers.spawnBatch(count);
}

btnSpawn10.addEventListener('click', () => callSpawnBatch(10));
btnSpawn50.addEventListener('click', () => callSpawnBatch(50));
btnSpawn100.addEventListener('click', () => callSpawnBatch(100));
btnSpawn500.addEventListener('click', () => callSpawnBatch(500));

btnReset.addEventListener('click', () => {
  if (!conn) {
    log('Not connected');
    return;
  }
  log('Resetting all creatures...');
  conn.reducers.reset();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

log('POC 6: SpacetimeDB at Scale -- Starting...');
const savedToken = localStorage.getItem(AUTH_TOKEN_KEY) || undefined;
connectToSTDB(savedToken);
