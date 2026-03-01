import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TournamentResult } from './tournament.js';
import type { ArchetypeName } from './archetypes.js';
import { TOURNAMENT } from '../simulation/constants.js';

const RESULTS_DIR = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'results');

export interface BalanceReportJSON {
  timestamp: string;
  matchesPerCombination: number;
  totalMatches: number;
  archetypes: Array<{
    name: string;
    winRate: number;
    wins: number;
    totalMatches: number;
    avgDamageDealt: number;
    avgDamageTaken: number;
    avgTicksSurvived: number;
    headToHead: Record<string, { wins: number; matches: number; winRate: number }>;
  }>;
  verdict: {
    balanced: boolean;
    dominantCheck: { passed: boolean; maxWinRate: number; threshold: number };
    viableCheck: { passed: boolean; viableCount: number; totalCount: number; threshold: number };
  };
}

/** Serialize tournament results to a JSON structure suitable for web consumption. */
function buildReportJSON(result: TournamentResult): BalanceReportJSON {
  const { stats, matchesPerCombination, totalMatches } = result;
  const names = [...stats.keys()].sort();

  const archetypes = names.map((name) => {
    const s = stats.get(name)!;
    const winRate = s.totalMatches > 0 ? s.wins / s.totalMatches : 0;
    const h2h: Record<string, { wins: number; matches: number; winRate: number }> = {};
    for (const [opponentName, record] of s.headToHead.entries()) {
      h2h[opponentName] = {
        ...record,
        winRate: record.matches > 0 ? record.wins / record.matches : 0,
      };
    }
    return {
      name,
      winRate,
      wins: s.wins,
      totalMatches: s.totalMatches,
      avgDamageDealt: s.totalMatches > 0 ? Math.round((s.totalDamageDealt / s.totalMatches) * 10) / 10 : 0,
      avgDamageTaken: s.totalMatches > 0 ? Math.round((s.totalDamageTaken / s.totalMatches) * 10) / 10 : 0,
      avgTicksSurvived: s.avgTicksSurvived,
      headToHead: h2h,
    };
  });

  const maxWinRate = Math.max(...archetypes.map((a) => a.winRate));
  const dominantCheck = {
    passed: maxWinRate <= TOURNAMENT.DOMINANT_WIN_RATE,
    maxWinRate,
    threshold: TOURNAMENT.DOMINANT_WIN_RATE,
  };

  const viableCount = archetypes.filter((a) => a.winRate >= TOURNAMENT.VIABLE_WIN_RATE).length;
  const viableCheck = {
    passed: viableCount === archetypes.length,
    viableCount,
    totalCount: archetypes.length,
    threshold: TOURNAMENT.VIABLE_WIN_RATE,
  };

  return {
    timestamp: new Date().toISOString(),
    matchesPerCombination,
    totalMatches,
    archetypes,
    verdict: {
      balanced: dominantCheck.passed && viableCheck.passed,
      dominantCheck,
      viableCheck,
    },
  };
}

/** Write balance report JSON to results/ directory. Returns the file path. */
function saveReport(report: BalanceReportJSON): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = report.timestamp.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const filename = `balance-${timestamp}.json`;
  const filepath = join(RESULTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2) + '\n');
  return filepath;
}

/**
 * Format and print the balance report to stdout, and save JSON to results/.
 */
export function printBalanceReport(result: TournamentResult): void {
  const { stats, matchesPerCombination, totalMatches } = result;
  const names = [...stats.keys()].sort();

  console.log('');
  console.log('=== ClawWorld Balance Report ===');
  console.log(`Matches per combination: ${matchesPerCombination}`);
  console.log(`Total matches: ${totalMatches}`);
  console.log('');

  // ── Overall win rates ─────────────────────────────────────────
  console.log('Archetype Win Rates:');
  const winRates = new Map<ArchetypeName, number>();

  for (const name of names) {
    const s = stats.get(name)!;
    const winRate = s.totalMatches > 0 ? s.wins / s.totalMatches : 0;
    winRates.set(name, winRate);
    const pct = (winRate * 100).toFixed(1);
    const padName = name.padEnd(12);
    console.log(`  ${padName} ${pct.padStart(5)}%  (${s.wins}/${s.totalMatches})`);
  }
  console.log('');

  // ── Detailed stats ────────────────────────────────────────────
  console.log('Archetype Stats:');
  for (const name of names) {
    const s = stats.get(name)!;
    const padName = name.padEnd(12);
    const avgDmgDealt = s.totalMatches > 0 ? (s.totalDamageDealt / s.totalMatches).toFixed(1) : '0';
    const avgDmgTaken = s.totalMatches > 0 ? (s.totalDamageTaken / s.totalMatches).toFixed(1) : '0';
    console.log(
      `  ${padName} avg dmg dealt: ${avgDmgDealt.padStart(6)}  avg dmg taken: ${avgDmgTaken.padStart(6)}  avg survived: ${String(s.avgTicksSurvived).padStart(4)} ticks`
    );
  }
  console.log('');

  // ── Head-to-head matrix ───────────────────────────────────────
  console.log('Head-to-Head Win Rates:');
  const COL_WIDTH = 12;
  const header = ''.padEnd(COL_WIDTH) + names.map((n) => n.padStart(COL_WIDTH)).join('');
  console.log(header);

  for (const rowName of names) {
    const s = stats.get(rowName)!;
    let row = rowName.padEnd(COL_WIDTH);
    for (const colName of names) {
      if (rowName === colName) {
        row += '-'.padStart(COL_WIDTH);
      } else {
        const h2h = s.headToHead.get(colName as ArchetypeName);
        if (h2h && h2h.matches > 0) {
          const pct = ((h2h.wins / h2h.matches) * 100).toFixed(0) + '%';
          row += pct.padStart(COL_WIDTH);
        } else {
          row += 'N/A'.padStart(COL_WIDTH);
        }
      }
    }
    console.log(row);
  }
  console.log('');

  // ── Balance checks ────────────────────────────────────────────
  let allPass = true;

  // Dominant strategy check
  const maxWinRate = Math.max(...[...winRates.values()]);
  const dominantCheck = maxWinRate <= TOURNAMENT.DOMINANT_WIN_RATE;
  const dominantLabel = dominantCheck ? 'PASS' : 'FAIL';
  if (!dominantCheck) allPass = false;
  console.log(
    `Dominant strategy check: ${dominantLabel} (no archetype >${(TOURNAMENT.DOMINANT_WIN_RATE * 100).toFixed(0)}% overall, max: ${(maxWinRate * 100).toFixed(1)}%)`
  );

  // Viable archetypes check
  const viableCount = [...winRates.values()].filter((r) => r >= TOURNAMENT.VIABLE_WIN_RATE).length;
  const viableCheck = viableCount === names.length;
  const viableLabel = viableCheck ? 'PASS' : 'FAIL';
  if (!viableCheck) allPass = false;
  console.log(
    `Viable archetypes (>${(TOURNAMENT.VIABLE_WIN_RATE * 100).toFixed(0)}% win rate): ${viableCount}/${names.length} ${viableLabel}`
  );

  console.log('');
  if (allPass) {
    console.log('Overall: BALANCED');
  } else {
    console.log('Overall: NEEDS REBALANCING');
  }
  console.log('');

  // Save structured JSON for web viewer / historical tracking
  const report = buildReportJSON(result);
  const filepath = saveReport(report);
  console.log(`Results saved to ${filepath}`);
}
