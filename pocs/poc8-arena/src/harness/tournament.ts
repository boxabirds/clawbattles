import type { CreatureBlueprint, MatchResult } from '../simulation/types.js';
import { runMatch } from '../simulation/match.js';
import { ARENA } from '../simulation/constants.js';
import type { ArchetypeName } from './archetypes.js';

export interface TournamentConfig {
  matchesPerCombination: number;
  archetypes: Array<{ name: ArchetypeName; blueprint: CreatureBlueprint }>;
}

export interface ArchetypeStats {
  name: ArchetypeName;
  wins: number;
  totalMatches: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalPartsLost: number;
  totalPartsDestroyed: number;
  avgTicksSurvived: number;
  /** Head-to-head win counts: opponentName -> wins */
  headToHead: Map<ArchetypeName, { wins: number; matches: number }>;
}

export interface TournamentResult {
  matchesPerCombination: number;
  totalMatches: number;
  stats: Map<ArchetypeName, ArchetypeStats>;
  matchResults: MatchResult[];
}

/**
 * Generate all unique combinations of `choose` elements from `arr`.
 * For FFA with 4 creatures, we need combinations with replacement
 * (an archetype can appear multiple times in one match).
 */
function* combinationsWithReplacement<T>(arr: T[], choose: number): Generator<T[]> {
  if (choose === 0) {
    yield [];
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    for (const rest of combinationsWithReplacement(arr.slice(i), choose - 1)) {
      yield [arr[i], ...rest];
    }
  }
}

/**
 * Run a round-robin tournament.
 * Every combination of 4 archetypes (with replacement) fights N times.
 */
export function runTournament(config: TournamentConfig): TournamentResult {
  const { matchesPerCombination, archetypes } = config;

  // Initialize stats
  const stats = new Map<ArchetypeName, ArchetypeStats>();
  for (const { name } of archetypes) {
    const headToHead = new Map<ArchetypeName, { wins: number; matches: number }>();
    for (const { name: otherName } of archetypes) {
      if (otherName !== name) {
        headToHead.set(otherName, { wins: 0, matches: 0 });
      }
    }
    stats.set(name, {
      name,
      wins: 0,
      totalMatches: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      totalPartsLost: 0,
      totalPartsDestroyed: 0,
      avgTicksSurvived: 0,
      headToHead,
    });
  }

  const allResults: MatchResult[] = [];
  let seedCounter = 1;

  // Generate all combinations of 4 from the archetype pool
  const combos = [...combinationsWithReplacement(archetypes, ARENA.CREATURES_PER_MATCH)];

  for (const combo of combos) {
    for (let m = 0; m < matchesPerCombination; m++) {
      const seed = seedCounter++;
      const creatures = combo.map(({ blueprint }) => blueprint);

      // Need fresh blueprints each match (instance IDs must be unique per creature)
      // Actually the match runner creates runtime state from blueprints, so
      // blueprints can be reused. But instance IDs across creatures in the same
      // match should be unique. Let me re-build for each match.
      const freshCreatures = combo.map(({ name }) => {
        const archetype = archetypes.find((a) => a.name === name)!;
        // Need to rebuild to get fresh instance IDs
        return { ...archetype.blueprint };
      });

      const result = runMatch({
        seed,
        maxTicks: ARENA.MAX_TICKS,
        creatures: freshCreatures,
      });

      allResults.push(result);

      // Map creature indices back to archetype names
      const archetypeForCreature = combo.map((c) => c.name);

      // Find winner (placement 1)
      const winner = result.placements.find((p) => p.placement === 1);
      if (winner) {
        const winnerIdx = parseInt(winner.creatureId.split('_')[1]);
        const winnerArchetype = archetypeForCreature[winnerIdx];
        const winnerStats = stats.get(winnerArchetype)!;
        winnerStats.wins++;
      }

      // Update per-archetype stats
      for (const placement of result.placements) {
        const idx = parseInt(placement.creatureId.split('_')[1]);
        const archName = archetypeForCreature[idx];
        const s = stats.get(archName)!;
        s.totalMatches++;
        s.totalDamageDealt += placement.damageDealt;
        s.totalDamageTaken += placement.damageTaken;
        s.totalPartsLost += placement.partsLost;
        s.totalPartsDestroyed += placement.partsDestroyed;
        s.avgTicksSurvived += placement.ticksSurvived;
      }

      // Head-to-head tracking: in a 4-creature match, the winner
      // gets a "win" against each other archetype present
      if (winner) {
        const winnerIdx = parseInt(winner.creatureId.split('_')[1]);
        const winnerArchetype = archetypeForCreature[winnerIdx];
        const winnerH2H = stats.get(winnerArchetype)!.headToHead;

        for (let i = 0; i < archetypeForCreature.length; i++) {
          const loserArchetype = archetypeForCreature[i];
          if (loserArchetype !== winnerArchetype) {
            const h2h = winnerH2H.get(loserArchetype);
            if (h2h) h2h.wins++;
          }
        }
      }

      // Track h2h matches for all pairs in this match
      for (let i = 0; i < archetypeForCreature.length; i++) {
        for (let j = 0; j < archetypeForCreature.length; j++) {
          if (i === j) continue;
          const nameI = archetypeForCreature[i];
          const nameJ = archetypeForCreature[j];
          if (nameI === nameJ) continue;
          const h2h = stats.get(nameI)!.headToHead.get(nameJ);
          if (h2h) h2h.matches++;
        }
      }
    }
  }

  // Finalize avgTicksSurvived
  for (const s of stats.values()) {
    if (s.totalMatches > 0) {
      s.avgTicksSurvived = Math.round(s.avgTicksSurvived / s.totalMatches);
    }
  }

  return {
    matchesPerCombination,
    totalMatches: allResults.length,
    stats,
    matchResults: allResults,
  };
}
