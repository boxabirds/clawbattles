# POC Roadmap

Ordered by what kills the project first if it doesn't work.

---

## POC 1: Can We Render the Swarm? ✅ PASSED

**Risk: HIGH -- if this fails, there's no game**

The promise is 500 creatures x ~8 parts each = 4,000 individually-transformed instances at 60fps in a browser. With WebGL fallback for 30% of users.

**What to prove:**
- Three.js WebGPU `InstancedMesh` with per-instance transform updates every frame
- 4,000 instances of simple geometry (spheres, cylinders, cones) with flat shading
- Per-instance vertex colors (player hue variation)
- Isometric camera, terrain plane underneath
- Measure: FPS on mid-range hardware, mobile Chrome Android, Safari
- Measure: does WebGL auto-fallback actually work? At what instance count does it choke?

**Kill condition:** <30fps on a 2022 laptop with integrated graphics at 2,000 instances.

**Result:** M2 Mac hits 60fps at 200K instances, 30fps at ~350K. Game target is ~4,000 parts — **~90x headroom**.

**Location:** `pocs/poc1-rendering/`

---

## POC 2: Does SpacetimeDB 2.0 Actually Work? ✅ PASSED

**Risk: HIGH -- the backend is 8 days old**

SpacetimeDB 2.0 TS modules shipped February 20, 2026. That's brand new. The docs may not match reality. The SDK may have bugs.

**What to prove:**
- Create a TS module with 3-4 tables (player, creature, territory)
- Publish to local/Maincloud
- Connect from browser client
- Call reducers (spawn creature, move creature)
- Subscribe to a spatial query (`WHERE chunk_x = ? AND chunk_y = ?`)
- Receive real-time updates when another client mutates subscribed data
- Run a scheduled reducer (creature tick)
- Test: 2 browser tabs simultaneously, do they see each other's changes?
- Test: disconnect + reconnect -- does the client re-sync?
- Test: what happens when a reducer throws? Does the transaction actually roll back?
- Measure: round-trip latency (client calls reducer -> client sees update via subscription)

**Kill conditions:**
- SDK crashes or doesn't connect reliably
- Scheduled reducers don't fire consistently
- Round-trip latency >200ms on Maincloud
- Reconnection doesn't work and there's no reasonable workaround

**Result:** Module deploys, tables/reducers/event tables/scheduled reducers all verified working against local SpacetimeDB 2.0.2. Creature movement confirmed across ticks. Key learnings: two-file split needed for circular type inference with scheduled reducers; `event: true` on table opts (not separate `eventTable()`); `ScheduleAt.interval()` lowercase.

**Location:** `pocs/poc2-spacetimedb/`

---

## POC 2.5: Integration — Rendering + SpacetimeDB ✅ PASSED

**Risk: LOW -- combining proven pieces**

Combines POC 1 (rendering) and POC 2 (SpacetimeDB) into a single application. Creatures rendered in Three.js with positions driven by SpacetimeDB subscriptions.

**Result:** Working integration. Creatures spawn, move, and render with SpacetimeDB providing server-authoritative positions. LAN-accessible via `host: true` in Vite config.

**Location:** `pocs/poc2.5-integration/`

---

## POC 3: Procedural IK Locomotion ✅ PASSED

**Risk: HIGH -- this is the soul of the game**

If creatures don't look alive when they walk, the entire "connectables" concept falls flat. A creature assembled from 4 legs needs to walk convincingly. A creature with 6 legs needs a different gait. A creature that loses a leg needs to adapt.

**What to prove:**
- FABRIK IK solver for a single leg chain (3 joints: hip -> knee -> foot)
- Raycast foot placement on uneven terrain
- Step trigger: foot lifts when target drifts >threshold from planted position
- Parabolic step arc
- Multi-leg gait: 4-leg (diagonal trot), 6-leg (tripod alternation)
- Dynamic leg loss: remove a leg at runtime, creature adjusts
- Scale test: 100 creatures with IK, all walking simultaneously -- measure CPU/GPU cost
- Compare: `closed-chain-ik-js` vs hand-rolled FABRIK (which is simpler, which performs better at scale?)

**Kill condition:** IK for 100 creatures exceeds 4ms/frame on CPU. That means we'd need GPU compute IK, which adds significant complexity.

**Result:** M2 Mac: IK solve = 1.30ms for 154 four-legged creatures. 30fps hit at ~150 creatures, but bottleneck is rendering (individual meshes, not instanced) — NOT IK. At 50 creatures (game target) IK would be ~0.4ms. Production would use InstancedMesh for leg bones, removing the rendering bottleneck entirely. **IK is not a concern.**

**Note:** Current IK is procedural FABRIK — legs follow the body rather than driving it. RL-trained locomotion (legs drive the body through learned gaits) is a future direction but not required for MVP.

**Location:** `pocs/poc3-locomotion/`

---

## POC 3.5: Multi-User IK Creatures ✅ PASSED

**Risk: MEDIUM -- combining IK + SpacetimeDB + multi-user**

Full integration: SpacetimeDB server-authoritative creature movement with client-side IK rendering. Multiple players on the same LAN spawning and controlling creatures.

**What was proved:**
- Server-authoritative movement at 10 ticks/sec with client lerp interpolation
- Multi-player spawn/move/select via SpacetimeDB reducers
- Random wandering AI (server-side, using `ctx.random()`)
- Arena boundary enforcement (server-side clamp)
- Configurable creature speed, leg count, and color
- Auto-reconnect with stale token clearing
- LAN-accessible for multi-device playtesting
- Combat event table (server-side proximity checks)

**Key learnings:**
- `Math.random()` banned in SpacetimeDB modules — must use `ctx.random()`
- `init` only runs on first publish — reducer signature changes require `spacetime delete` + fresh publish
- Lerp-based interpolation (can't overshoot) > velocity-based interpolation (oscillates)
- Server tick rate (10/sec) is independent of client render rate (60fps)

**Location:** `pocs/poc3.5-multiuser/`

---

## POC 4: Part Assembly + Connection Physics 🔨 BUILT — needs testing

**Risk: MEDIUM -- complex but decomposable**

Parts snap together and behave physically. Spring connections wobble. Hinge connections cycle. Parts break off under damage and tumble away. This is the "feel" of the game.

**What to prove:**
- Build a creature from a JSON part tree at runtime (parse -> generate scene graph)
- Magnetic connection: rigid parent-child transform
- Ball joint: constrained rotation (cone limit)
- Hinge: single-axis oscillation (for mandibles, wings)
- Spring: damped harmonic oscillator (for antennae)
- Part detachment: remove a part from the scene graph, convert to physics object, apply tumble
- Creature recalculates stats + locomotion after part loss
- Measure: does runtime assembly from JSON take <16ms? (needs to be instantaneous for spawning)

**Kill condition:** Connection physics creates visible jitter or instability with 5+ connected parts.

**Implementation:** Single HTML file with 4 connection types, 4 preset creatures, walk toggle, shake test, click-to-detach. Assembly time measurement included.

**Location:** `pocs/poc4-connections/index.html`

---

## POC 5: Creature Editor UX 🔨 BUILT — needs testing

**Risk: MEDIUM -- hard to get right, easy to get wrong**

3D drag-and-drop part placement with port snapping. This is the fun part of the game -- if the editor feels clunky, players won't design creatures, and without creature design there's no game.

**What to prove:**
- 3D viewport with orbit camera (Three.js OrbitControls)
- Render a creature with visible port indicators (small glowing spheres at each open port)
- Click a part type from a panel -> part attaches to cursor
- Hover over creature -> compatible ports highlight
- Click highlighted port -> part snaps into place with animation (magnetic pull + particle burst)
- Right-click part -> detach
- Bilateral symmetry toggle: place left leg, right leg auto-mirrors
- Real-time stat readout updates as parts are added/removed
- "Test Walk" button: creature drops onto a patch of terrain and walks with procedural animation

**Kill condition:** The interaction feels fiddly or confusing. If playtesters can't build a basic 6-part creature in under 30 seconds, the UX needs rethinking.

**Implementation:** Single HTML file. 3-column layout with 11 part types, port snapping, bilateral symmetry [S], undo [Ctrl+Z], test walk, export JSON, build timer.

**Location:** `pocs/poc5-editor/index.html`

---

## POC 6: SpacetimeDB at Scale 🔨 BUILT — needs testing

**Risk: MEDIUM -- works at 2 players, might not at 50**

POC 2 proves the basics. This proves it holds up under real load.

**What to prove:**
- 50+ creatures owned by different players in the same world region
- Spatial subscription updates: subscribe to a 5x5 chunk area, move the viewport, re-subscribe
- Measure: subscription update latency with 200 creatures mutating positions at 4 ticks/sec
- Measure: Maincloud free tier -- how many concurrent connections before throttling?
- Test: scheduled reducer at 4/sec processing 500 creature movements -- does it complete within the tick window (250ms)?
- Test: what happens when the tick reducer takes >250ms? Do ticks queue? Skip? Overlap?

**Kill condition:** Tick reducer for 500 creatures exceeds 250ms, or Maincloud throttles at <20 concurrent connections on free tier.

**Implementation:** Vite + bun project with SpacetimeDB backend. Spawn buttons (10/50/100/500), tick metrics chart with 250ms red line, pass/fail verdict, chunk-based spatial combat optimization.

**Location:** `pocs/poc6-scale/`

---

## ~~POC 7: WebGL Fallback~~ ❌ DROPPED

WebGPU adoption is sufficient for target audience. Not worth the complexity.

---

## POC 5.5: Creature Editor + SpacetimeDB Persistence 🔨 BUILT — needs testing

**Risk: LOW — combining proven editor (POC 5) with proven backend (POC 2)**

Creature designs persist in SpacetimeDB. Players save, load, browse community designs, and deploy creatures to the arena.

**What was built:**
- SpacetimeDB module with `creature_design` and `player` tables
- Reducers: `save_creature`, `update_creature`, `delete_creature`, `deploy_creature`, `set_player_name`
- Auto-loads deployed creature on reconnect
- My Creatures panel + Community section + Deploy button
- Full editor from POC 5 with SpacetimeDB persistence layer

**Location:** `pocs/poc5.5-editor-stdb/`
**Run:** `./start.sh` (publishes module, generates bindings, starts Vite on port 3002)

---

## POC 8: ClawWorld Battle Arena — 8a+8b ✅ PASSED, 8c NOT STARTED

**Risk: MEDIUM-HIGH — technical is straightforward, balance is the real threat**

A battle arena where AI agents submit creature designs, matches run server-authoritatively, and agents iterate based on match feedback. Players don't design creatures — they design agents that design creatures.

**What to prove:**
- Part catalog with structural constraints (max parts, weight budget, energy budget, port compatibility) produces multiple viable archetypes — not a single dominant strategy
- Tick-based match runner resolves 4-creature FFA with part-based damage within 100ms tick budget
- Sensory model (vision via eyes, proximity via antenna, proprioception always) creates meaningful information asymmetry
- Post-match feedback (own creature's sensory log + summary stats, NOT full replay) gives agents enough signal to iterate
- Config-only agent loop works: submit JSON → watch match → reason → submit better JSON
- Default creature behavior (priority-based AI) produces interesting matches without agent-controlled real-time tactics

**Kill conditions:**
- Constraint system has a single dominant strategy that agents converge on within 50 matches
- Match runner can't resolve 4-creature FFA within tick budget
- Default creature behavior makes all matches play identically regardless of build

**Design document:** `pocs/poc8-arena/design.md`

**POC 8a — Combat Simulation Engine ✅ PASSED:**
Headless tick-based match runner. 11 part types, creature validator, seeded PRNG, 4-creature FFA with part-based damage + detachment. 3,200 matches/second.

**POC 8b — Balance Harness ✅ PASSED:**
Round-robin tournament across 4 archetypes (Berserker, Flanker, Tank, Spiker). All archetypes viable at 23-27% win rate after tuning. No dominant strategy.

**POC 8c — Arena API + Viewer: NOT STARTED.**
Three.js viewer for watching matches in real-time. REST/WebSocket API for agent creature submission.

**Run:** `cd pocs/poc8-arena && bun run src/index.ts balance` or `bun run src/index.ts match --seed 42`

**Location:** `pocs/poc8-arena/`

---

## POC 9: Generative Creature Sounds — NOT STARTED

**Risk: MEDIUM — proven synthesis techniques, unproven at scale in browser**

Real-time procedural audio for creature locomotion, combat, and vocalizations. No sample libraries — all sounds generated from creature properties (size, material, part count).

**What to prove:**
- FM synthesis in Rust/WASM via FunDSP crate, running in AudioWorkletProcessor
- SharedArrayBuffer bridge between game thread and audio thread
- Creature properties map to sound parameters: size→pitch, material→timbre, aggression→modulation index
- Footstep synthesis from IK step events (weight + surface + leg count → impact sound)
- Combat sounds: claw strikes, part detachment, armor impacts
- Ambient creature breathing/idle via low-frequency FM
- Voice management: 20-30 active voices with distance-based priority culling
- Latency: <10ms from game event to audible sound

**Kill condition:** Synthesis latency >10ms, or audible artifacts (clicks/pops) with 20+ simultaneous voices on mid-range hardware.

**Architecture (based on proven rusty-waves-dsp patterns):**
- Rust/WASM synthesis engine runs inside AudioWorklet (block-based, 128 samples/callback)
- SharedArrayBuffer for real-time parameter/telemetry bridge (atomic read/write, lock-free)
- `port.postMessage()` for one-time commands (trigger sounds, load patches)
- Voice pool with SoA layout + bitmask for active voices (skip silent voices entirely)
- Plan double-buffering: graph changes swap at block boundaries, never mid-block
- Ramp-based parameter smoothing (no zipper noise)
- Denormal flush guards to prevent subnormal float glitches
- Voice priority system (distance-based culling, 20-30 max active)
- Reference implementation: `~/expts/rusty-waves-project/rusty-waves-dsp/`

**Key synthesis mappings:**
- Carrier:modulator ratio → material (integer = organic/chitinous, non-integer = metallic)
- Modulation index → aggression (low = purring, high = screeching)
- Carrier frequency → body size (inverse relationship)
- Formant filters (2-3 bandpass) → creature vocalizations

**Location:** `pocs/poc9-sounds/`

---

## POC 10: Creature Vocoder — BUILT

**Risk: LOW — proven DSP techniques, creative exploration**

Uses KittenTTS (15M param, CPU-only TTS) as a sound source, then modulates the output through a channel vocoder + FM synthesis chain to create alien creature vocalizations. Explores whether TTS-driven vocoding can produce compelling creature voices that respond to creature properties.

**What was built:**
- Docker service wrapping KittenTTS (nano model, 25MB) with FastAPI HTTP API
- POST /synthesize endpoint returning WAV audio from text + voice selection
- Web client with channel vocoder: TTS audio analyzed through logarithmically-spaced bandpass filterbank
- Envelope followers (full-wave rectification + LPF) extract amplitude per band
- FM carrier oscillator pairs per band, amplitude-modulated by analysis envelopes
- Creature properties control FM carriers: body_size -> pitch, material -> mod ratio (organic/metallic), aggression -> mod index
- Formant shifting slides synthesis bands up/down for size perception changes
- Wet/dry mix for A/B comparison between original TTS and vocoded output
- 8 TTS voices (Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo)
- 4-32 configurable vocoder bands

**Key synthesis mappings (same as POC 9):**
- Carrier:modulator ratio -> material (integer = organic/chitinous, non-integer = metallic)
- Modulation index -> aggression (low = smooth, high = screechy)
- Carrier frequency -> body size (inverse relationship)
- Formant shift -> perceived creature size without speed change

**Architecture:**
- KittenTTS Docker service on port 5100 (CPU-only, no GPU required)
- Vite + bun web client on port 3010
- Web Audio API channel vocoder (no WASM needed — all JS AudioNode graph)
- Signal chain: TTS -> Bandpass Analysis -> Envelope -> FM Carriers -> Output

**Run:** `./start-docker.sh` (TTS service) then `./start-web.sh` (web client)

**Location:** `pocs/poc10-vocoder/`

---

## Vision: AI-Generated Creature Skins (Future POC)

**Risk: LOW — proven technology, offline generation**

AI-generated textures, bump maps, and material properties for creature surfaces. Runs in a "creature studio" where players iterate on skin designs.

**Approach:**
- Generate tileable patterns per creature *design* (not per instance) using Flux/SDXL with tiling ControlNet
- PBR material channels: diffuse, normalMap, roughness, metalness, alphaMap, emissive, iridescence — all native in Three.js `MeshStandardMaterial`
- Offline generation — no runtime AI inference
- One skin per creature design, applied to all instances

**Not a kill risk** — purely additive. Game works fine with flat-shaded vertex colors. This is about depth, not viability.

---

## Vision: ClawWorld — Autonomous Agent Arena (Future POC)

**Risk: UNKNOWN — emergent system, no kill condition yet**

The emergent vision: autonomous AI agents (via OpenClaw or similar) that design, build, and evolve creatures without human intervention. A 24/7 arena where agents compete.

**Key questions:**
- What specification language do creatures compile to? (see Creature Specification Language below)
- Can agents use web research to discover creature design strategies?
- What's the fitness function for the arena?
- How do agents interact with the creature editor / studio?

**OpenClaw:** Open-source autonomous AI agent framework by Peter Steinberger. 300-400K users, runs 24/7 across 20+ messaging platforms. Could provide the agent runtime.

**Creature Specification Language:** See analysis below — likely a custom `.cw` format optimized for the connectable part model rather than adapting robot description formats (URDF/SDF/MJCF) designed for continuous-geometry robots.

---

## Not Worth a POC (Low Risk / Proven)

| Thing | Why it's fine |
|---|---|
| **Procedural terrain** | Dozens of working examples, heightmap + noise is textbook |
| **Generative music (Tone.js)** | Mature library, well-documented |
| **Creature serialization** | It's JSON. It works. |
| **URL sharing** | Base64 encode JSON, put in URL param. Trivial. |
| **HTML/CSS UI overlay** | Standard web dev |

---

## Execution Status

```
Phase 1 (DONE):   POC 1 ✅  +  POC 2 ✅              <- rendering + backend proven
Phase 2 (DONE):   POC 3 ✅  +  POC 2.5 ✅            <- IK + integration proven
Phase 3 (DONE):   POC 3.5 ✅                          <- multi-user IK creatures working
Phase 4 (TEST):   POC 4 🔨  +  POC 5 🔨  + POC 6 🔨   <- built, awaiting playtesting
Phase 5 (TEST):   POC 5.5 🔨  + POC 8a ✅ + POC 8b ✅  <- editor persistence + combat sim + balance
Phase 6 (NEXT):   POC 8c 🎯  +  POC 9 🎯              <- arena viewer + generative sounds
Phase 6b (BUILT): POC 10 🔨                            <- creature vocoder (TTS + FM synthesis)
Phase 7 (FUTURE): AI skins                              <- vision item, not yet scoped
```

### Gate Check: All HIGH-risk POCs passed. No architectural pivots needed.

---

## Risk Rankings Summary

| POC | Risk | Kill Condition |
|-----|------|---------------|
| 1 - Rendering | ~~HIGH~~ ✅ | ~~<30fps at 2K instances~~ 350K at 30fps |
| 2 - SpacetimeDB basics | ~~HIGH~~ ✅ | ~~SDK unreliable~~ All features verified |
| 2.5 - Integration | ~~LOW~~ ✅ | Combining proven pieces — worked first try |
| 3 - IK Locomotion | ~~HIGH~~ ✅ | ~~IK for 100 creatures >4ms/frame~~ 1.3ms at 154 creatures |
| 3.5 - Multi-User IK | ~~MEDIUM~~ ✅ | Server-authoritative movement + multi-player working |
| 4 - Connection Physics | MEDIUM 🔨 | Visible jitter with 5+ connected parts |
| 5 - Creature Editor | MEDIUM 🔨 | Can't build 6-part creature in <30 seconds |
| 5.5 - Editor + STDB | LOW 🔨 | Combining proven pieces |
| 6 - SpacetimeDB at Scale | MEDIUM 🔨 | 500-creature tick >250ms, or <20 connections |
| ~~7 - WebGL Fallback~~ | ❌ DROPPED | Not needed |
| 8a - Combat Sim | ~~MEDIUM~~ ✅ | ~~Tick budget exceeded~~ 3,200 matches/sec |
| 8b - Balance | ~~MEDIUM-HIGH~~ ✅ | ~~Dominant strategy~~ All 4 archetypes 23-27% win rate |
| 8c - Arena Viewer | LOW 🎯 | Combining proven renderer + proven sim |
| 9 - Generative Sounds | MEDIUM 🎯 | Latency >10ms or artifacts with 20+ voices |
| 10 - Creature Vocoder | LOW 🔨 | TTS + vocoder chain produces compelling creature voices |
