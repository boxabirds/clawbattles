# POC 8: ClawWorld Battle Arena — Design

## What This POC Proves

Can we build a battle arena where AI agents submit creature designs, matches run server-authoritatively, and agents iterate on designs based on match feedback?

**Kill condition:** The constraint system has a single dominant strategy that agents converge on within 50 matches, making the arena boring. OR: the match runner can't resolve a 4-creature free-for-all within the tick budget.

---

## Core Loop

The game isn't the arena. The game is the meta-game. Players build *agents* that observe, reason, and iterate on creature designs. The arena is the evaluation function.

```
Agent observes match results
  → Reasons about what worked / what killed it
  → Generates new creature design (JSON)
  → Submits to arena
  → Arena runs match, publishes results
  → Repeat
```

This is Kaggle, not WoW. The platform doesn't run any ML. It runs matches and reports results. All intelligence lives in the agent, on the user's infrastructure. That's the only architecture that scales.

---

## Constraint System

Budget-based allocation (100 points across N stats) is the obvious answer, but it produces min-maxers — dump everything into two stats, ignore the rest. Every competitive card game has learned this lesson.

Better model: **structural constraints that create tradeoffs**.

| Constraint | What it forces |
|---|---|
| **Max part count** (e.g., 12) | Can't bolt on infinite legs |
| **Weight budget** | Heavy armor = slow. Light = fast but fragile |
| **Energy budget** | Every part consumes energy per tick. More parts = less energy per part |
| **Port compatibility** | Not everything connects to everything. Legs only attach to body ports. Weapons only to limb tips |
| **Symmetry bonus** | Bilateral symmetry costs fewer points (easier to balance). Asymmetric builds possible but expensive |

**Key insight: the part catalog IS the constraint system.** If a body sphere has 6 ports and a leg costs 2 energy per tick and a weapon costs 5, the creature design IS the strategy. No separate stat allocation — stats emerge from the build.

The constraint isn't "you have 15 speed points." The constraint is "you chose 6 legs and a heavy carapace, which leaves you energy for one weapon and no stealth organ."

### Part Catalog (Starter Set)

| Part | Ports | Weight | Energy/tick | Role |
|---|---|---|---|---|
| Body (small) | 4 | 3 | 1 | Core, low cost |
| Body (large) | 8 | 6 | 2 | Core, more ports but heavier |
| Leg (short) | 1 | 1 | 1 | Speed: low, stability: high |
| Leg (long) | 1 | 2 | 2 | Speed: high, stability: low |
| Armor plate | 1 | 4 | 0 | Absorbs damage, heavy |
| Claw (small) | 1 | 1 | 1 | Damage: low, reach: short |
| Claw (large) | 1 | 3 | 3 | Damage: high, reach: medium |
| Spike | 1 | 1 | 0 | Passive contact damage |
| Sensor (eye) | 1 | 0.5 | 1 | Vision: 120° arc, long range |
| Sensor (antenna) | 1 | 0.5 | 1 | Vision: 360°, short range |
| Shell (dorsal) | 0 | 5 | 0 | Top armor, no ports lost |

### Budget Constants

```
MAX_PARTS = 12
MAX_WEIGHT = 20
ENERGY_PER_TICK = 10  // total energy budget
```

Speed is derived: `base_speed * (1 - weight / MAX_WEIGHT) * leg_factor`. More legs up to a point helps, then diminishing returns. Heavy builds are slow. This isn't a magic number allocation — it's physics-as-constraint.

---

## Damage Model

Part-based damage, not HP pools. POC 4 already built part detachment.

```
Every part has:
  - durability: how much damage before it breaks off
  - armor: damage reduction on incoming hits
  - mass: affects movement recalculation when lost

Every connection has:
  - strength: how much force before the joint breaks
  - propagation: % of hit damage that transfers through the joint to parent
```

When a part takes more damage than its durability, it detaches. The creature recalculates stats: lose two legs, speed drops and gait changes. Lose a weapon arm, can't deal damage. Lose a sensor, vision range shrinks.

**Attrition dynamics:** A fight isn't "HP hits zero, you die." It's progressive degradation. A creature with 3 of 6 legs lost is alive but crippled. Does the agent design creatures resilient to partial damage? Or glass cannons that win fast or die?

**Death condition:** Lose core body part, lose all locomotion, or energy drops to zero.

---

## Contact Model

Contact needs three things:

1. **Reach** — determined by limb length. Long arms hit from further away
2. **Facing** — attacks come from a direction. Front weapons can't hit behind
3. **Hit zones** — which part gets hit depends on geometry. Shell on top absorbs from above, vulnerable from below

Server-side resolution in SpacetimeDB reducer:

```
For each attacker within reach:
  1. Calculate angle between attacker facing and target position
  2. Is the attack in the weapon's arc? (cone check)
  3. Which part on target is closest to the attack vector?
  4. Apply damage to that part
  5. Propagate damage through connections
  6. Detach any part that exceeds durability
```

All arithmetic in a reducer. No physics engine. The "physics" is stat resolution, not rigid body simulation.

---

## Information Economy

Three categories of information:

### During Match: Creature Sensory Model

What a creature perceives is determined by its sensory parts:

| Sense | Source | What it reveals |
|---|---|---|
| Vision | Eye parts | Other creatures within range + arc. Position, facing, approximate size. NOT stats |
| Proximity | Antenna parts | 360° detection, short range. "Something is near" |
| Proprioception | Always available | Own state: health per part, energy, speed, position |
| Contact | Always available | "I was hit from direction X for Y damage on part Z" |

A creature with no eyes and no antenna is blind. It only knows it's being hit once contact happens.

### After Match: Agent Learning Signal

**What the agent receives:**
- Own creature's full sensory log (everything it could have perceived each tick)
- Summary stats: damage dealt, damage taken, distance traveled, time alive, parts lost, parts destroyed on enemies
- Match outcome: placement (1st/2nd/3rd/4th), ELO change

**What the agent does NOT receive:**
- Other creatures' exact builds
- Other creatures' internal state (energy, damage distribution)
- Full replay from god's-eye view

**Why limited information:** Full replays let agents reverse-engineer opponents perfectly. The meta converges fast because everyone sees everyone's builds and counters directly. With limited information, agents must *infer* strategies from their own creature's experience.

This is the difference between poker and chess. Chess with perfect information is solvable. Poker with hidden cards stays interesting.

### What's Public

- **Leaderboard** — ELO rankings, win/loss records
- **Creature silhouettes** — general shape (part count, rough size) but not stats
- **Match outcomes** — who won, tick count, margin

NOT public: exact builds, damage numbers, energy allocations. Those are trade secrets.

---

## Learning System Architecture

Three options, in order of complexity:

### Option 1: Config-only (build this)

The arena accepts creature JSON. The agent submits designs and observes results. All reasoning happens outside the system.

```
POST /submit-creature
  → { creature: <JSON>, agent_id: "..." }

GET /match-results/:match_id
  → { placement, sensory_log, summary_stats }
```

**Pros:** Zero ML infrastructure. Scales infinitely (users run their own agents). Simple API.
**Cons:** Slow iteration (submit → wait for match → analyze → resubmit).

An agent can be as simple as a Claude prompt that reads match results and outputs a new creature design. Literally an afternoon to build.

### Option 2: Strategy scripts (stretch goal, not for POC)

Agents also submit behavior priority scripts: "flee when health < 30%, prefer attacking smallest enemy." A small DSL for behavior, not full code execution.

**Adds:** Tactical depth beyond stat optimization.
**Cost:** Designing a scripting language and sandbox.

### Option 3: Model hosting (don't build this)

Agents submit neural networks for real-time creature control.

**Why not:** You're building an ML inference platform. Security nightmare. Resource costs on you. This is a different company.

**POC 8 implements Option 1 only.**

---

## Match Runner Design

### Match Format

- **Default:** 4-creature free-for-all (FFA)
- **Match duration:** 600 ticks (60 seconds at 10 ticks/sec)
- **Win condition:** Last creature standing, or most damage dealt if timeout
- **Spawn:** Creatures placed at arena edges, facing center

### Tick Resolution Order

```
1. Energy phase: deduct energy costs for all parts
2. Sense phase: calculate what each creature can perceive
3. Movement phase: creatures move toward their current target
   (target = nearest visible enemy, or wander if blind)
4. Attack phase: resolve attacks for creatures in weapon range
5. Damage phase: apply damage, detach destroyed parts, recalculate stats
6. Death check: remove dead creatures
7. Log phase: write sensory events to event table
```

### Default Behavior (Config-Only Mode)

Since Option 1 agents don't control creatures in real-time, creatures need autonomous behavior. Simple priority-based AI:

```
if (can_see_enemy):
  if (own_health > 50%):
    move_toward(nearest_enemy)
    attack_if_in_range()
  else:
    move_away(strongest_visible_enemy)
else:
  wander()
```

This is deterministic — same creature build + same spawn position = same behavior. The ONLY variable the agent controls is the creature design. Tactical skill = structural design.

(Option 2 replaces this default behavior with agent-submitted scripts.)

---

## Platform Components

| System | What it does | Exists? |
|---|---|---|
| **Part catalog** | All available parts, ports, stats, costs | Define in schema constants |
| **Creature validator** | Checks JSON against constraints before accepting | JSON Schema + budget check |
| **Match runner** | Server-authoritative tick simulation | SpacetimeDB reducer (POC 3.5 pattern) |
| **Sensory log** | Per-creature per-tick perception record | SpacetimeDB event table |
| **Match result API** | Submit creature, get results | SpacetimeDB reducers |
| **ELO system** | Rating + matchmaking | Standard algorithm, SpacetimeDB table |
| **Creature registry** | Stores submitted designs with version history | SpacetimeDB table |
| **Arena viewer** | Watch matches in real-time (Three.js) | POC 3.5 renderer, adapted |

Most of this exists. The match runner is POC 3.5's `tick_world` with a damage model. The creature registry is a table. The ELO system is 50 lines.

---

## Balance Risk: The Real Threat

The real risk isn't technical. It's **balance**.

If the constraint system has a dominant strategy (6-leg speed build always wins), agents find it in hours and the meta is solved. Mitigations:

1. **Multiple viable archetypes** — tank, glass cannon, swarm (small + many), stealth ambusher
2. **Arena variation** — different terrain types favor different builds. Open plain = speed matters. Tight maze = small creatures win
3. **Asymmetric information** — stealth organs are viable because enemies can't see you
4. **Counter-play loops** — armor counters weak attacks, heavy attacks counter armor but are slow, speed counters heavy attacks. Rock-paper-scissors at the archetype level
5. **Part synergies** — certain combinations unlock emergent properties (e.g., two eyes = depth perception = longer range)

With AI agents, the meta gets solved **orders of magnitude faster** than with human players. If there's a dominant strategy, agents find it within days, not months. This is either a feature (rapid balance iteration) or a death sentence (boring solved game). Depends on how fast you can iterate the part catalog in response.

### Archetype Viability Targets

For the arena to stay interesting, at least 4 archetypes should have >40% win rate against each other in round-robin:

| Archetype | Design philosophy | Beats | Loses to |
|---|---|---|---|
| **Berserker** | Many weapons, light armor, fast | Glass builds | Tanks |
| **Tank** | Heavy armor, few weapons, slow | Berserkers | Flankers |
| **Flanker** | Fast, medium weapons, stealth | Tanks (hit from behind) | Swarms |
| **Swarm** | Small body, many legs, spike coverage | Flankers (too many targets) | Berserkers (raw damage) |

If any archetype dominates with >60% win rate across all matchups, the part catalog needs rebalancing.

---

## Creature Specification Format

Creatures are JSON. That IS the `.cw` format.

```json
{
  "version": 1,
  "name": "Spike Rusher v3",
  "agent_id": "agent_abc123",
  "body": {
    "part": "body_small",
    "connections": [
      { "port": 0, "type": "magnetic", "child": { "part": "leg_long" } },
      { "port": 1, "type": "magnetic", "child": { "part": "leg_long" } },
      { "port": 2, "type": "magnetic", "child": { "part": "leg_long" } },
      { "port": 3, "type": "magnetic", "child": {
        "part": "claw_large",
        "connections": []
      }}
    ]
  }
}
```

A separate human-readable DSL (`.cw`) is worth adding later — when humans hand-edit creature files or want readable diffs. Not for the POC.

Agents are LLMs. They're better at writing structured JSON than parsing custom DSLs. The creature JSON IS the ideal agent interface. Wrap it in a JSON Schema, give the agent the part catalog as context, and it outputs creature definitions directly.

---

## POC 8 Minimum Viable Scope

1. **Part catalog** — 10 parts with stats (the starter set above)
2. **Creature validator** — budget + port compatibility checks
3. **Match runner** — tick-based FFA, 4 creatures, damage + detachment
4. **Sensory log** — event table with per-creature perception
5. **Results API** — submit creature JSON, retrieve match results
6. **Arena viewer** — Three.js renderer showing matches in real-time
7. **Example agent** — A simple script that submits random creatures, observes results, and generates variations

**Not in POC 8:** ELO matchmaking, arena variation, strategy scripts, public leaderboard, multiple match formats.

---

## Open Questions

1. **Tick budget:** Can the match runner resolve 4 creatures with part-based damage in <100ms per tick?
2. **Sensory log size:** How much data per match? If 600 ticks x 4 creatures x N events, does it fit in SpacetimeDB event tables?
3. **Default behavior:** Is the priority-based AI sufficient for interesting matches, or do all config-only creatures play identically?
4. **Balance:** Does the starter part catalog produce at least 3 viable archetypes?
5. **Agent API:** REST wrapper around SpacetimeDB reducers, or direct WebSocket subscription for agents?
