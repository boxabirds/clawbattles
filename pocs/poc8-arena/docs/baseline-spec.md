# Baseline Spec

Living document: what we learned from POCs and what the full version needs.

---

## Learned from POCs

- **SpacetimeDB works** for real-time server-authoritative game state. WebSocket subscriptions push row changes instantly -- no polling, no REST, no manual sync. Reducer-based mutations are atomic and deterministic.
- **10Hz tick rate + 60fps client interpolation** feels smooth. Server runs physics/combat at 10 ticks/sec; client renders at 60fps and interpolates between snapshots. The two rates are fully independent.
- **Spring-damper camera** with exponential damping (`v *= exp(-damping * dt)`) is frame-rate independent and jitter-free. Semi-implicit Euler integration. Cut spring vs. tracking spring gives natural snappy-then-smooth transitions.
- **Stamina/fatigue system** prevents stalemates. After 20s grace period, all parts decay. High-durability builds survive longer but everyone dies eventually. Matches resolve within ~60s.
- **Team combat with 16 creatures (4 teams of 4)** is visually engaging. Enough chaos to be interesting, small enough to track. Team-based targeting (can't attack teammates) creates natural tactical dynamics.
- **Neural net brains (24-16-8-4)** with hardcoded AI fallback works for POC but the brain outputs are opaque and hard to tune. Needs utility AI replacement for readable, evolvable decisions.
- **Part-tree topology** (body -> children -> sub-children) is expressive. 10 archetypes cover a good range from glass cannon (Wasp) to armored wall (Beetle). Port types constrain builds meaningfully.
- **Event-driven camera director** (inspired by Valve HLTV) with minimum shot durations and priority-based cuts makes watching matches feel cinematic without manual camera control.
- **Weighted hit targeting** (armor attracts hits at 2.5-3.0x weight, core at 0.5x) makes armor builds feel meaningfully different from glass builds.
- **SpacetimeDB gotchas**: `Math.random()` banned in modules (use `ctx.random()`), two-file split required for scheduled reducers, `spacetime generate` does not accept `-s`, default server can silently be `maincloud`.

---

## Full Version: Collision Detection

### What we have now
- Simple pairwise repulsion: if distance < 2.5, push both creatures apart along connecting vector (SEPARATION_RADIUS=2.5, SEPARATION_STRENGTH=0.8)
- O(n^2) brute-force -- fine for 16 creatures, won't scale
- No spatial partitioning
- Arena boundary is a soft clamp, not a wall

### What we need
- **Spatial hash grid or quad-tree** for broad phase -- reduces pairwise checks from O(n^2) to O(n) for large creature counts
- **Swept-circle collision detection** for continuous movement -- prevents tunneling at high speed (fast creatures can skip past each other in one tick)
- **Contact manifold data**: which parts are touching, contact normal, penetration depth -- feeds into visual effects and damage calculation
- **Contact events** piped to VFX system: sparks on metal-to-metal (armor/shell contact), dust on ground scraping, flash on weapon hit
- **Physics-based knockback**: creature weight affects push distance on heavy impacts (light creatures get shoved, heavy creatures barely move)
- **Arena boundary as a wall**: solid collision, not just position clamping. Creatures should bounce off or slide along the edge
- **Collision layers**: teammates should still collide physically (for positioning/blocking) even though they can't damage each other
- **Part-level collision shapes**: currently all creatures are treated as point masses. Want per-part bounding volumes for accurate weapon reach and contact detection

---

## Full Version: Visual Effects

### What we have now
- Lunge animation on attack swing
- Red damage flash on hit
- Death explosion with debris particles
- Death flash point light
- Camera shake on kill event
- Part detachment (mesh removed from scene graph)
- Name labels above creatures

### What we need
- **Sparks on part-to-part contact** -- especially metal parts (armor plates, shells, claws). Particle system with short-lived emissive sprites
- **Dust clouds** on ground impacts and fast movement -- ground plane interaction feedback
- **Part damage visualization**: cracks, deformation, color degradation as durability drops. Currently parts look pristine until they detach
- **Smoke/steam from critically damaged parts** -- durability below 25% threshold
- **Impact trails**: brief line effects showing weapon swing paths (claw arcs, stinger thrusts)
- **Fluid effects for organic parts**: body damage should produce visual feedback distinct from metal-on-metal sparks
- **Screen-space effects**: vignette on nearby heavy impacts, chromatic aberration on death, subtle bloom on emissive parts (eyes, stingers)
- **Arena floor effects**: scorch marks where creatures die, dust rings from heavy landings
- **Health bars or durability indicators**: per-creature visual HP that spectators can read at a glance (currently only inferable from part count)

---

## Full Version: AI

### What we have now
- Neural net brains: 24 inputs -> 16 hidden -> 8 hidden -> 4 outputs (572 total weights)
- Outputs: movement angle, movement speed, target selection, stance (aggressive/defensive)
- Inputs: own drives (4), own state (8), up to 3 visible enemies (12 = 3 x 4 features)
- Hardcoded fallback AI: approach nearest visible enemy, wander toward center if blind
- Drive system: aggression, fear, pain, exploration -- decay toward baselines, spike on events

### What we need
- **Utility AI** with parameterized behavior templates (~20 floats per personality)
  - Per-tick action scoring via utility curves (linear, quadratic, logistic)
  - Pick highest-scoring action, execute
  - Actions: approach enemy, flee, circle strafe, hold position, retreat to hill, contest hill
- **Spectator-readable decisions**: each creature's current action and score visible in debug overlay ("attacking: 0.82", "fleeing: 0.15")
- **Evolvable genome**: flat float array suitable for genetic algorithm (crossover, mutation, selection)
- **Team coordination behaviors**:
  - Focus fire: multiple teammates target same enemy
  - Flanking: approach from opposite sides
  - Retreat together: disengage as a group when losing
  - Protect wounded: healthy teammates body-block for damaged ones
- **Hill awareness**: path toward scoring circle, contest enemy hill positions, balance hill control vs. combat
- **Personality archetypes**: aggressive, cautious, opportunistic, territorial -- driven by utility curve shapes, not hardcoded branching
- **Decision history**: short-term memory of recent actions to prevent oscillation (committed action cooldown)

---

## Full Version: Creature Generation

### What we have now
- 10 hand-crafted archetypes with fixed part trees (Berserker, Tank, Flanker, Spiker, Wasp, Centipede, Scorpion, Beetle, Mantis, Crawler)
- Fixed part catalog: 14 part types across 6 roles (core, locomotion, weapon, armor, sensor, passive_armor)
- Budget constraints: max 12 parts, max 20 weight, 10 energy/tick
- Port system: bodies provide typed ports, parts attach to compatible port types

### What we need
- **Procedural creature generation** with constraint satisfaction:
  - Satisfy budget (parts, weight, energy)
  - Satisfy port compatibility (no attaching claws to sensor ports)
  - Ensure minimum viability (at least one core, at least one locomotion)
  - Bias toward coherent builds (don't randomly scatter incompatible parts)
- **Genetic algorithm for co-evolving body plans + brain weights**:
  - Genome: part tree structure (variable length) + utility AI floats (fixed length)
  - Crossover: subtree swap for body plan, uniform crossover for AI weights
  - Mutation: add/remove/swap parts, perturb AI weights
- **Fitness function**: weighted combination of:
  - Survival time (not dying early)
  - Damage dealt (contributing to fights)
  - Hill control time (strategic positioning)
  - Parts destroyed on enemies (combat effectiveness)
- **Diversity pressure**: penalize populations converging on a single archetype
  - Niching / speciation (like NEAT)
  - Or explicit diversity bonus based on body plan edit distance
- **Balancing feedback loop**: if one archetype dominates, its fitness gets penalized or counter-builds get boosted

---

## Full Version: Match Structure

### What we have now
- Single circular arena (radius 50)
- Auto-restart on match finish
- King-of-hill scoring across 3 rounds with shrinking hill radius (12, 10, 7)
- Match ends when one team remains or max ticks (600) exceeded
- Placement ranking: survivors by damage dealt, dead by death order

### What we need
- **Tournament brackets**: 4+ teams compete, losers eliminated, winners advance through rounds
- **Creature drafting**: teams select from a shared pool, counter-picking phase. Bans possible
- **Map variety**:
  - Different arena shapes (square, hexagonal, figure-8)
  - Obstacles and terrain (rocks, walls, elevation changes)
  - Environmental hazards (lava zones, wind corridors, shrinking boundaries)
- **Spectator mode**:
  - Multiple camera presets (overhead, tracking, free-cam, picture-in-picture)
  - Replay system with scrubbing
  - Slow-motion on kills and critical moments
  - Commentary-ready event feed
- **Persistent creature progression**:
  - Survivors carry damage into next match (wounded but experienced)
  - XP/leveling for stat improvements across a tournament
  - Part upgrades or mutations earned through combat
- **Match types**:
  - Free-for-all (no teams)
  - 1v1 duel (single creature each)
  - King-of-hill (current)
  - Last team standing (current, no hill)
  - Timed point scoring (damage dealt = points)
- **Anti-stall mechanics beyond stamina**:
  - Shrinking arena boundary (battle royale style)
  - Escalating environmental damage
  - Bonus points for aggression

---

## Architecture Notes for Full Version

- Server remains authoritative. Client renders and interpolates only.
- SpacetimeDB scheduled reducers at 10Hz for game tick. Client at 60fps.
- Row-change subscriptions push state instantly. No polling.
- Brain cache lives in module memory (cleared on match end). Body plan parsing happens once at match start.
- All randomness via `ctx.random()` (deterministic seeded PRNG). Replays are possible by replaying the seed.
- Part catalog is extensible: add new `PartDefinition` entries to the catalog, the rest of the system adapts.
- Two-file split (schema.ts + index.ts) required by SpacetimeDB to avoid circular type inference in scheduled reducers.
