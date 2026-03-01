/**
 * SpacetimeDB HTTP API client for the evolution agent.
 *
 * Uses the REST API for reducer calls and `spacetime sql` CLI for queries.
 * The HTTP API accepts database names directly (no identity resolution needed).
 */

const POLL_INTERVAL_MS = 2000;
const MATCH_TIMEOUT_MS = 120_000;

export interface StdbClientConfig {
  host: string;
  database: string;
}

export interface MatchCreatureResult {
  name: string;
  alive: boolean;
  deathCause: string;
  damageDealt: number;
  damageTaken: number;
  partsLost: number;
  placement: number;
  matchId: number;
}

export class StdbClient {
  private apiBase: string;

  constructor(private config: StdbClientConfig) {
    this.apiBase = `${config.host}/v1/database/${config.database}`;
  }

  /** Verify the database is reachable */
  async init(): Promise<void> {
    // Verify database is reachable by querying a known table
    const result = await this.sql('SELECT match_id FROM match');
    // Empty result is fine (no matches yet), as long as the query didn't throw
  }

  /** Call a reducer via HTTP API */
  async callReducer(name: string, args: any[]): Promise<void> {
    const resp = await fetch(`${this.apiBase}/call/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Reducer ${name} failed (${resp.status}): ${text}`);
    }
  }

  /** Run a SQL query via CLI and return raw text output */
  async sql(query: string): Promise<string> {
    const proc = Bun.spawn(
      ['spacetime', 'sql', this.config.database, query],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`SQL failed: ${stderr.trim()}`);
    }
    return stdout.trim();
  }

  /** Submit a creature design */
  async submitCreature(
    name: string,
    bodyJson: string,
    brainTopologyJson: string,
    brainWeightsJson: string,
  ): Promise<void> {
    await this.callReducer('submit_creature', [
      name,
      bodyJson,
      brainTopologyJson,
      brainWeightsJson,
    ]);
  }

  /** Get the N most recent design IDs (highest autoInc IDs = most recently inserted) */
  async getLatestDesignIds(count: number): Promise<bigint[]> {
    const result = await this.sql('SELECT design_id FROM creature_design');
    const ids: bigint[] = [];
    for (const line of result.split('\n')) {
      const m = line.match(/^\s*(\d+)/);
      if (m) ids.push(BigInt(m[1]));
    }
    // Sort descending, take N most recent, return in insertion order
    ids.sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
    return ids.slice(0, count).reverse();
  }

  /** Start a match with entries specifying design IDs and team assignments */
  async startMatch(entries: Array<{ designId: number; teamIdx: number }>): Promise<void> {
    const entriesJson = JSON.stringify(entries);
    await this.callReducer('start_match', [entriesJson]);
  }

  /** Get the latest match ID from the database */
  async getLatestMatchId(): Promise<bigint> {
    const result = await this.sql('SELECT match_id FROM match');
    let maxId = 0n;
    for (const line of result.split('\n')) {
      const m = line.match(/^\s*(\d+)/);
      if (m) {
        const id = BigInt(m[1]);
        if (id > maxId) maxId = id;
      }
    }
    return maxId;
  }

  /** Poll until a match with ID > afterMatchId finishes. Returns the match ID. */
  async waitForMatchFinish(afterMatchId: bigint = 0n): Promise<bigint> {
    const start = Date.now();

    while (Date.now() - start < MATCH_TIMEOUT_MS) {
      const result = await this.sql('SELECT match_id, state, current_tick FROM match');

      // Find latest match with ID > afterMatchId
      let latestId = 0n;
      let latestState = '';
      for (const line of result.split('\n')) {
        const m = line.match(/^\s*(\d+)\s*\|\s*"(\w+)"/);
        if (m) {
          const id = BigInt(m[1]);
          if (id > afterMatchId && id > latestId) {
            latestId = id;
            latestState = m[2];
          }
        }
      }

      if (latestState === 'finished') {
        return latestId;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Match did not finish within ${MATCH_TIMEOUT_MS}ms`);
  }

  /** Get match creature results for a specific match */
  async getMatchResults(matchId: bigint): Promise<MatchCreatureResult[]> {
    const result = await this.sql(
      'SELECT match_id, name, alive, death_cause, damage_dealt, damage_taken, parts_lost, placement FROM match_creature',
    );

    const results: MatchCreatureResult[] = [];
    for (const line of result.split('\n')) {
      // Parse: matchId | "name" | true/false | "cause" | float | float | int | int
      const m = line.match(
        /^\s*(\d+)\s*\|\s*"([^"]+)"\s*\|\s*(true|false)\s*\|\s*"([^"]*)"\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(\d+)\s*\|\s*(\d+)/,
      );
      if (m && BigInt(m[1]) === matchId) {
        results.push({
          matchId: Number(m[1]),
          name: m[2],
          alive: m[3] === 'true',
          deathCause: m[4],
          damageDealt: parseFloat(m[5]),
          damageTaken: parseFloat(m[6]),
          partsLost: parseInt(m[7]),
          placement: parseInt(m[8]),
        });
      }
    }
    return results;
  }
}
