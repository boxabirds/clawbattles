# SpacetimeDB 2.0 + WebGPU + Asset Pipeline: Research Brief

*Compiled 2026-02-28 for Game Design Workshop*

---

## 1. SpacetimeDB: Core Architecture

SpacetimeDB is a **relational database that is also a server**. Built by Clockwork Labs (40-person SF studio, backed by Supercell, a16z, Roblox founder, Unity founder), it collapses the traditional client → API server → database stack into a single layer where application logic executes **inside the database itself**.

**Key architectural properties:**

- **In-memory database** — all state in RAM, sub-microsecond data access, WAL for crash recovery
- **Modules** — server logic compiled to WASM (Rust, C#, C++) or runs on V8 (TypeScript), uploaded directly into the database
- **Automatic state sync** — clients subscribe to SQL queries; SpacetimeDB pushes incremental row-level updates over WebSocket
- **ACID transactions** — every reducer call is atomic (all-or-nothing)
- **Single-node architecture** — no distributed database, which enables extreme low latency

The philosophy: no Docker, no Kubernetes, no microservices. Write your logic, deploy a module, the database handles compute, storage, and networking.

---

## 2. SpacetimeDB 2.0 (Released February 20, 2026)

### Major New Features

| Feature | Details |
|---|---|
| **TypeScript modules (production)** | 100k+ TPS, full parity with Rust/C# for module authoring |
| **Procedure Functions (beta)** | Outbound HTTP requests from modules (non-transactional) |
| **Event Tables** | Transient publish/subscribe for ephemeral events (damage numbers, chat, SFX triggers) |
| **Typed Query Builder** | Auto-generated, fully typed subscription APIs — no raw SQL strings |
| **View Functions** | Read-only server-side computed queries |
| **Postgres Wire Protocol** | Connect with `psql` and any Postgres-compatible tool |
| **SpacetimeAuth** | First-party auth, free on Maincloud |
| **`spacetime dev`** | Hot-reload dev server |
| **UE5 / C++ support** | Official C++ module and client support |
| **Web framework templates** | React, Next.js, Vue, Nuxt, Svelte, Angular, Remix, TanStack, Deno, Bun, Node |

### Breaking Changes from 1.0

- Reducer callbacks removed → use Event Tables
- `table name` → `table accessor`
- `withModuleName()` → `withDatabaseName()`
- Update only on primary keys (non-primary unique columns: delete + insert)
- Scheduled reducers private by default

---

## 3. How It Works for Multiplayer Games

### Tables (Schema-as-Code)

```typescript
const Player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    x: t.f32(), y: t.f32(),
    health: t.u16(),
    online: t.bool(),
  }
);
```

### Reducers (Server-Side Mutations)

```typescript
spacetimedb.reducer('move_player', [t.f32(), t.f32()], (ctx, x, y) => {
  const player = ctx.db.player.identity.find(ctx.sender());
  if (!player) throw new SenderError('Not logged in');
  ctx.db.player.identity.update({ ...player, x, y });
});
```

- Execute atomically (all-or-nothing)
- No filesystem/network access (deterministic) — use Procedures for external calls
- Lifecycle reducers: `init`, `client_connected`, `client_disconnected`
- Scheduled reducers: table-driven, insert a row with timestamp/interval

### Subscriptions (Real-Time Sync)

1. Client registers SQL queries describing needed data
2. Server sends initial state (all matching rows)
3. Server pushes incremental updates (insert/update/delete) over WebSocket
4. Client SDK maintains local cache — reads are instant (local memory)

```typescript
conn.subscriptionBuilder()
  .subscribe(Player.where(p => p.online.eq(true))); // Typed query builder (2.0)
```

Per-table callbacks: `onInsert(row)`, `onDelete(row)`, `onUpdate(oldRow, newRow)`

**Spatial partitioning pattern** (from BitCraft): subscribe to entities in current "chunk," update subscriptions as player moves.

---

## 4. Performance

| Metric | Value |
|---|---|
| Rust module TPS | ~170,000 |
| TypeScript module TPS | ~100,000+ |
| Per-transaction latency | ~10 microseconds |
| Contention degradation | <5% throughput loss |

**Why it's fast:** colocated execution (zero network hops), in-memory data, single-threaded transactions (no distributed locks), WebSocket fire-and-forget.

**Honest caveat:** Benchmarks are adversarial to competitors (Zipf-distributed hot-key writes). Real-world gaps will be smaller. Single-node in-memory vs. distributed multi-tenant is an apples-to-oranges comparison.

---

## 5. Limitations

- **Single-node only.** No horizontal scaling. Game world bounded by one machine (RAM + CPU).
- **All data must fit in memory.** Practical limit = host RAM.
- **No physics engine.** Action games need separate physics.
- **Reconnection is immature.** Build your own reconnection logic.
- **BSL 1.1 license.** Not open source. Production use limited to single server instance. Converts to AGPL after some years.
- **Vendor lock-in.** SpacetimeDB-specific APIs; migrating means rewriting server logic.
- **Room-based games** need external orchestration (create/destroy database instances per match).
- **Single-threaded transactions.** One slow reducer blocks everything.

---

## 6. Pricing (Maincloud)

| Tier | Price | Approx. Capacity |
|---|---|---|
| **Free** | $0/mo | ~3M function calls, 12.5GB egress, 1GB storage |
| **Pro** | $25/mo | ~120M function calls, 500GB egress, 40GB storage |
| **Team** | $250/mo | ~300M function calls, 1.25TB egress, 100GB storage |
| **Enterprise** | Custom | Dedicated nodes, custom SLAs |

Self-hosting: `spacetime start` or Docker. Single binary deployment.

---

## 7. Games Built with SpacetimeDB

- **BitCraft Online** — MMORPG by Clockwork Labs themselves, entire backend is one SpacetimeDB module
- **2D Multiplayer Survival MMORPG** — Open-source (Apache 2.0), React + Vite + SpacetimeDB, built by one developer
- **DeliveryZ** — Mobile game shipped in 3 months by 8 engineers
- **3D Multiplayer Starter Kit** — Three.js + React + SpacetimeDB

---

## 8. WebGPU: State of the Art (2025-2026)

### Browser Support (~70% global coverage)

| Browser | Status |
|---|---|
| Chrome/Edge 113+ | Stable (Windows, macOS, ChromeOS, Android 12+) |
| Firefox 141+ | Stable (Windows), macOS in Firefox 145 |
| Safari 26 | Stable (macOS Tahoe 26, iOS 26) |

**You must implement WebGL 2 fallback.** Three.js r171+ and Babylon.js 8.0 do this automatically.

### Engine Comparison

| Engine | WebGPU Status | Key Strength |
|---|---|---|
| **Three.js r171+** | Production-ready | Largest ecosystem, TSL shaders, auto WebGL fallback |
| **Babylon.js 8.0** | Production-ready | Most complete feature set (physics, GUI, animation) |
| **PlayCanvas** | Beta | Cloud editor, mobile-optimized |

### Performance: WebGPU vs WebGL

| Metric | WebGL | WebGPU |
|---|---|---|
| Particles at 60 FPS | 2.3-2.7M | 20-37M (7-15x) |
| Draw call overhead | Sequential, single-threaded | Multi-threaded command encoding (2-5x) |
| Compute shaders | None | Full support (the transformative feature) |

**Caveat:** Small scenes can run faster on WebGL. WebGPU advantages emerge at scale (hundreds of draw calls, thousands of objects, compute workloads).

### What Game Styles Benefit Most

| Genre | WebGPU Advantage |
|---|---|
| **RTS / Colony Sim** | Compute for unit AI/pathing, instanced rendering for armies |
| **Arena / Competitive MP** | Stable 60 FPS with heavy VFX |
| **Voxel worlds** | Indirect draws, GPU-driven culling |
| **Physics sandbox** | Compute for simulation (300K+ particles) |
| **Particle-heavy** | 10M+ particles at 60 FPS |

### Best Practices

- **ECS on GPU**: Component data in storage buffers, systems as compute shader dispatches
- **Instanced rendering**: `instancedArray` for per-instance buffers, compute shaders update on GPU
- **Compute for game logic**: Particle systems, physics, spatial queries, terrain generation, AI flocking
- **Keep on CPU**: State machines, networking, UI state, anything needing frequent readback

---

## 9. Asset Pipeline

### AI 3D Model Generation

| Tool | Price | Best For | Output |
|---|---|---|---|
| **Sloyd** | $15/mo unlimited | Bulk props, clean topology | GLB/glTF, proper UVs + LODs |
| **Tripo** | 300 free credits/mo, $15.90/mo | Characters, rigging | GLB/glTF |
| **Meshy** | $16-20/mo | All-rounder, retexturing | GLB/glTF |
| **Rodin/Hyper3D** | Higher cost | Hero assets, highest fidelity | GLB/glTF |
| **Scenario.com** | $10-30/mo | Style consistency, integrates 12+ generators | GLB/glTF via integrations |

### Free Asset Libraries

| Library | Content | License |
|---|---|---|
| **Kenney.nl** | Thousands of low-poly models, textures, audio | CC0 |
| **Quaternius** | Hundreds of low-poly 3D packs | CC0 |
| **Poly Pizza** | Aggregator of free 3D models | Various (CC) |
| **OpenGameArt** | Sprites, textures, 3D models, audio | Various |

### AI Texture Generation

- **GenPBR** — Free, algorithmic, in-browser PBR generation
- **Polycam** — Free, AI-generated, commercially licensed
- **AI Textured** — Free 4K PBR with seamless tiling

### Sound & Music (Free)

- **Kenney audio** — CC0 sound effects
- **Freesound / Pixabay** — Large libraries
- **jsfxr** — Procedural SFX as a JS library (zero download size)

### Compression Pipeline (Non-Negotiable for Production)

```
Source → glTF 2.0 / GLB
      → Draco mesh compression (60-90% reduction)
      → KTX2 + Basis Universal textures (88% reduction)
      → LOD meshes (meshoptimizer)
      → Serve via CDN
```

Tool: `gltf-transform` CLI applies Draco + KTX2 in one pass.

### Cost Tiers

| Phase | Monthly Cost | Stack |
|---|---|---|
| **Prototype** | $0 | Kenney + Quaternius + GenPBR + jsfxr |
| **Production** | $45-65 | Add Sloyd + Scenario.com |

---

## 10. SpacetimeDB + WebGPU: Architecture for a Multiplayer Web Game

```
┌─────────────────┐     WebSocket      ┌──────────────────────────┐
│  Browser Client  │◄──────────────────►│     SpacetimeDB 2.0      │
│                  │                    │                          │
│  Three.js WebGPU │  Auto-sync via     │  TypeScript Module:      │
│  + TSL Shaders   │  SQL Subscriptions │  - Tables (game state)   │
│  + Compute       │                    │  - Reducers (mutations)  │
│                  │                    │  - Scheduled reducers    │
│  Client Cache    │                    │  - Event tables          │
│  (local replica) │                    │  - View functions        │
└─────────────────┘                    └──────────────────────────┘
```

**Why this combination works:**

1. **No netcode to write** — SpacetimeDB subscriptions handle state sync
2. **TypeScript everywhere** — module + client in one language
3. **Compute shaders for rendering** — GPU handles particles, instancing, effects
4. **In-memory performance** — sub-microsecond server-side data access
5. **Free tier viable for launch** — $0 SpacetimeDB + $0 assets + browser = zero infrastructure cost

**What you still need to solve:**

- Physics (implement in reducers or use a JS physics lib client-side)
- WebGL 2 fallback for ~30% of users
- Reconnection logic
- Room-based game orchestration (if match-based)
- Audio engine (Howler.js, Tone.js, or Web Audio API directly)
