# SWARM: Game Proposal

*A persistent browser-based multiplayer territory game where you command a swarm of creatures to harvest, build, and conquer in a shared procedural world — playable in 10 seconds, deep enough for 10,000 hours.*

---

## Workshop Panel

- **Shigeru Miyamoto** — "Is it fun with no graphics?" The swarm-command feedback loop (click-and-watch-them-go) works even as colored dots. Same joy as Pikmin throwing.
- **Will Wright** — "Do players generate the content?" Territory layouts, alliance politics, base designs, and war stories are all player-created. The game is a canvas.
- **Raph Koster** — "Will players tell stories about it?" "I allied with three neighbors to take down the mega-colony" is exactly the narrative that spreads organically.

---

## Why This Combination

| Constraint | How SWARM Exploits It |
|---|---|
| **SpacetimeDB** | Persistent world state, automatic sync via subscriptions, scheduled reducers run the world while players sleep |
| **WebGPU** | Instanced rendering (500 creatures = 1 draw call), compute shaders for terrain gen + particle FX, 10M+ particles for spectacular swarm clashes |
| **Low-cost assets** | Stylized low-poly aesthetic uses free CC0 libraries (Kenney, Quaternius) + $15/mo Sloyd for creatures. Total: $15/mo. |
| **Browser-based** | Zero install friction. Every URL is a player. Share link → friend is in the game in 10 seconds. |

---

## Core Loop (30-Second Cycle)

```
DIRECT your swarm (click/tap to move, drag to assign tasks)
    → HARVEST resources (crystal, biomass, metal)
    → BUILD structures (spawners, walls, turrets, harvesters)
    → EXPAND territory (structures claim adjacent tiles)
    → DEFEND against other players' swarms and NPC threats
    → REPEAT with more creatures, better upgrades, bigger territory
```

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER CLIENT                           │
│                                                                 │
│  Three.js WebGPU (r171+)                                       │
│  ├── Compute: terrain gen, particle FX, swarm animation        │
│  ├── Instanced rendering: creatures (hundreds per player)      │
│  ├── TSL shaders: stylized lighting, territory glow            │
│  └── WebGL 2 auto-fallback                                     │
│                                                                 │
│  SpacetimeDB TS Client SDK                                     │
│  ├── Subscriptions: nearby chunks (spatial partitioning)       │
│  ├── Local cache: instant reads for rendering                  │
│  └── Reducer calls: move_swarm, build, harvest, attack         │
│                                                                 │
│  Input: click/tap to command, drag to assign, pinch to zoom    │
│  Audio: jsfxr (procedural SFX) + Howler.js                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │ WebSocket
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SPACETIMEDB 2.0 MODULE                      │
│                     (TypeScript, runs on V8)                    │
│                                                                 │
│  Tables:                                                        │
│  ├── player        identity, name, color, home_chunk, resources │
│  ├── creature      id, owner, x, y, state, type, health        │
│  ├── structure     id, owner, x, y, type, health, level        │
│  ├── terrain_chunk chunk_x, chunk_y, seed, resource_deposits   │
│  ├── territory     chunk_x, chunk_y, owner, control_strength   │
│  └── event_combat  attacker, defender, x, y, damage  [Event]   │
│                                                                 │
│  Reducers:                                                      │
│  ├── move_swarm(target_x, target_y)                            │
│  ├── assign_task(creature_ids[], task_type, target_id)         │
│  ├── build_structure(type, x, y)                               │
│  ├── upgrade_structure(structure_id)                            │
│  ├── attack(target_player, x, y)                               │
│  └── form_alliance(target_player) / break_alliance(player)     │
│                                                                 │
│  Scheduled Reducers:                                            │
│  ├── tick_world     1s   resource regen, NPC spawns, territory │
│  ├── tick_combat    500ms resolve ongoing battles              │
│  └── tick_offline   60s  offline player defense AI             │
│                                                                 │
│  Event Tables:                                                  │
│  ├── event_combat        damage numbers, death animations      │
│  ├── event_chat          player messages                       │
│  └── event_notification  "player X attacked your base!"        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Swarm, not avatar** | Instanced rendering = WebGPU strength. Losing one creature ≠ losing the game = low frustration. |
| **Click-to-command, not direct control** | No twitch input needed = WebSocket latency is fine. Mobile-friendly. Browser-friendly. |
| **Persistent shared world** | SpacetimeDB's entire architecture. Subscriptions sync nearby players automatically. |
| **Territory control** | Natural spatial partitioning for subscriptions. Natural social dynamics — borders, alliances, conflicts. |
| **Procedural terrain** | WebGPU compute shaders generate it. Zero artist cost. Infinite variety. |
| **Isometric 3D, stylized** | Free CC0 asset libraries are perfect for this aesthetic. Visual clarity > fidelity. |
| **Charming creatures, not soldiers** | Broader audience. Lower violence threshold for viral sharing. Pikmin proved this. |

---

## Asset Strategy

| Asset Type | Source | Cost |
|---|---|---|
| Creatures (5-8 types) | Sloyd (procedural, clean topology, GLB export) | $15/mo |
| Structures (10-15 types) | Kenney + Quaternius (CC0) | $0 |
| Terrain | Procedural via WebGPU compute | $0 |
| Textures/PBR | GenPBR + Polycam (free AI generation) | $0 |
| Particle FX | WebGPU compute shaders (procedural) | $0 |
| Sound FX | jsfxr (procedural, zero download) | $0 |
| Music | Pixabay / Freesound (CC0 ambient loops) | $0 |
| UI icons | Kenney (CC0 game icons pack) | $0 |
| **Total** | | **$15/mo** |

### Compression Pipeline

```
glTF 2.0 / GLB → Draco (60-90% mesh reduction)
               → KTX2 + Basis Universal (88% texture reduction)
               → LOD meshes via meshoptimizer
               → Serve via CDN
```

Tool: `gltf-transform` CLI applies Draco + KTX2 in one pass.

---

## Virality Mechanics

1. **URL = instant join.** Share a link, friend is playing in 10 seconds.
2. **Territory map is shareable.** Screenshot or live embed of the persistent world map.
3. **Alliance system creates social obligation.** Players recruit friends to defend territory.
4. **Offline persistence creates FOMO.** "Someone attacked my base while I was sleeping" brings players back.
5. **Spectator-friendly.** Watching two swarms collide is visually spectacular with WebGPU particle FX.

---

## MVP Scope (4-6 weeks, solo developer)

1. Procedural terrain (WebGPU compute, isometric camera)
2. Player swarm (spawn 20 creatures, click to move)
3. Resource harvesting (click resource node → creatures walk → resources increment)
4. Basic structures (spawner, wall, harvester — 3 types)
5. Territory control (structures claim nearby tiles, visual territory overlay)
6. Multiplayer sync (SpacetimeDB subscriptions, see other players' swarms in real-time)
7. Combat (swarm vs. swarm, simple health/DPS resolution)

---

## Post-MVP Roadmap

### Phase 2: Depth
- Creature specializations (workers, warriors, scouts, healers)
- Tech tree / upgrade paths
- NPC threats (wild creatures, environmental hazards)

### Phase 3: Social
- Alliance system (formal pacts, shared vision, coordinated attacks)
- Chat (proximity + alliance channels via event tables)
- Leaderboards and territory statistics

### Phase 4: Expression
- Cosmetic customization (creature skins, structure themes)
- Player-named territories
- World history / timeline of territorial changes

### Phase 5: Events
- Seasonal world events (meteor showers, resource surges, mega-boss spawns)
- Time-limited challenges
- Cross-server competitions

---

## Risk Analysis

| Risk | Mitigation |
|---|---|
| SpacetimeDB single-node ceiling | Spatial sharding via multiple databases (one per world region). Launch with small world, expand. |
| WebGPU 30% browser gap | Three.js r171+ auto-fallback to WebGL 2. Reduce creature count on fallback. |
| BSL license lock-in | Accept for MVP. If game succeeds, evaluate self-hosting vs. Maincloud economics. |
| Player retention after novelty | Depth systems (Phase 2-5) designed to layer on without invalidating MVP. |
| Asset consistency | Sloyd's procedural generation produces consistent style. Kenney packs are internally consistent. |
| Mobile performance | Test WebGPU on Android 12+ Chrome early. Reduce instance counts adaptively. |

---

## Comparable Successes

| Game | Similarity | What They Proved |
|---|---|---|
| **Agar.io** | Browser, instant join, persistent world | Zero-install web games can reach 100M+ players |
| **Factorio** | Build, automate, defend territory | Systems-driven games retain for 1000+ hours |
| **Pikmin** | Command a swarm, transform environment | Swarm control is inherently satisfying |
| **Clash of Clans** | Persistent base, offline defense, social alliances | Territorial persistence + FOMO = massive retention |
| **Minecraft** | Procedural world, player expression, shared servers | Player-generated content > developer-made content |

---

## The Verdict

**Miyamoto:** The core mechanic — directing a swarm with a single click — passes my "one-button test." A child can play this. A hardcore gamer can optimize it for months.

**Wright:** The systems interlock beautifully. Resources feed structures feed creatures feed territory feed resources. That's the Factorio loop in a browser. Players will surprise us with strategies we never designed.

**Koster:** The social architecture is correct. Persistent territory + visible neighbors + alliance mechanics = organic community formation. This is what made Ultima Online electric. Add a world map people can screenshot and share, and it markets itself.

**Consensus:** Build it.
