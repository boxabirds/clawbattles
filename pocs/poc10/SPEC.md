# POC 10 — SWARM: Creature Editor + Arena + Sound

Comprehensive specification for rebuilding the POC from scratch. This document covers every system, data model, and integration point.

## Overview

A single-page browser application combining:

1. **Creature Editor** — Assemble creatures from 11 part types using a typed/spatial port system
2. **Team Design** — 4 pre-populated creature slots in a 2×2 grid, tap to edit
3. **Arena Combat** — Real-time spectator view of 4v4 mirror matches with 6-phase tick simulation
4. **Sound Synthesis** — Rust/WASM AudioWorklet producing procedural footsteps, impacts, and detachment sounds

## Tech Stack

- **Renderer:** Three.js (WebGLRenderer) with MeshStandardMaterial
- **Build:** Vite 6 + TypeScript 5 (esbuild type-stripping, no tsc)
- **Sound:** Rust → wasm-pack → AudioWorklet (creature-synth crate)
- **Simulation:** Deterministic 6-phase tick loop, seeded PRNG, no server dependency

## Build & Run

```bash
cd pocs/poc10

# First time: build WASM (requires wasm-pack + Rust toolchain)
./build.sh

# Install JS deps
bun install

# Dev server (port 3010, COEP headers enabled)
bunx vite --host
```

COEP headers (`Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Opener-Policy: same-origin`) are required for `SharedArrayBuffer` used by the AudioWorklet telemetry. Configured in `vite.config.ts`.

---

## Data Model

### Part System Types

```typescript
type PartId =
  | 'body_small' | 'body_large'
  | 'leg_short' | 'leg_long'
  | 'armor_plate'
  | 'claw_small' | 'claw_large' | 'spike'
  | 'sensor_eye' | 'sensor_antenna'
  | 'shell_dorsal';

type PartRole = 'core' | 'locomotion' | 'weapon' | 'armor' | 'sensor' | 'passive_armor';
type PortType = 'body' | 'limb' | 'sensor' | 'armor' | 'dorsal';
type Direction = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
```

### PortSlot — Spatial Port System

Each `PartDefinition` has a `portLayout: PortSlot[]` that defines where children can attach:

```typescript
interface PortSlot {
  type: PortType;                     // What can connect here
  position: [number, number, number]; // 3D offset from part center
  direction: Direction;               // Orientation + symmetry axis
}
```

This merges POC 5's directional placement with POC 8's type-based compatibility. Attachment rules: a child's `attachesTo` array must include the port's `type`.

### PartInstance — Blueprint Tree Node

```typescript
interface PartInstance {
  partId: PartId;
  instanceId: string;    // Unique within creature
  portIndex: number;     // Which portLayout slot on parent (-1 for root)
  children: PartInstance[];
}

interface CreatureBlueprint {
  name: string;
  body: PartInstance;      // Root must be body_small or body_large
  brain?: BrainSpec;       // Optional neural net (for evolved creatures)
}
```

### Bilateral Symmetry

`MIRROR_DIRECTION` maps `left↔right` (all others map to self). When symmetry is on, placing a part on a left/right port auto-places the same part on the mirror port if available.

---

## Part Catalog (11 Parts)

| ID | Role | Weight | Energy | Durability | Attaches To | Ports |
|---|---|---|---|---|---|---|
| body_small | core | 3 | 1 | 30 | — (root) | 5: 2×limb, sensor, armor, dorsal |
| body_large | core | 6 | 2 | 40 | — (root) | 9: 4×limb, 2×sensor, 2×armor, dorsal |
| leg_short | locomotion | 1 | 1 | 8 | limb | 1: limb (tip) |
| leg_long | locomotion | 2 | 2 | 8 | limb | 1: limb (tip) |
| armor_plate | armor | 4 | 0 | 30 | armor, limb | 0 |
| claw_small | weapon | 1 | 1 | 8 | limb | 0 |
| claw_large | weapon | 3 | 3 | 12 | limb | 0 |
| spike | weapon | 1 | 0 | 5 | limb, armor | 0 |
| sensor_eye | sensor | 0.5 | 1 | 4 | sensor, limb | 0 |
| sensor_antenna | sensor | 0.5 | 1 | 4 | sensor, limb | 0 |
| shell_dorsal | passive_armor | 5 | 0 | 35 | dorsal | 0 |

### Port Layouts

**body_small** (ellipsoid ~0.85 radius):
```
[0] limb    (-0.85, 0, 0)     left
[1] limb    (0.85, 0, 0)      right
[2] sensor  (0, 0.8, 0)       top
[3] armor   (0, 0, 0.85)      front
[4] dorsal  (0, 0.72, -0.26)  back
```

**body_large** (ellipsoid ~1.2 radius):
```
[0] limb    (-1.2, 0, 0.6)    left    (front-left)
[1] limb    (1.2, 0, 0.6)     right   (front-right)
[2] limb    (-1.2, 0, -0.6)   left    (back-left)
[3] limb    (1.2, 0, -0.6)    right   (back-right)
[4] sensor  (0, 0.9, 0.36)    top     (front-top)
[5] sensor  (0, 0.9, -0.36)   top     (back-top)
[6] armor   (0, 0, 1.2)       front
[7] armor   (0, 0, -1.2)      back
[8] dorsal  (0, 0.81, 0)      top
```

**leg_short** tip at `(0, -0.7, 0)`, **leg_long** tip at `(0, -1.1, 0)`.

### Combat Stats

Weapons:
- claw_small: 5 damage, 2.5 reach
- claw_large: 7 damage, 2.5 reach
- spike: 3 contact damage (range 3.5)

Sensors:
- eye: 25 range, 120° arc
- antenna: 10 range, 360° arc

### Budgets

- Max parts: 12
- Max weight: 20
- Energy per tick: 10

---

## Combat Simulation

### 6-Phase Tick Loop (10 Hz)

Each tick executes these phases in order:

1. **Energy Phase** — Calculate energy drain from all attached parts. If drain exceeds budget, apply self-damage proportional to deficit (`ENERGY_DEFICIT_DAMAGE_RATE = 0.5`).

2. **Drives Phase** — Update 4 emotional drives based on recent events:
   - Aggression (baseline 0.5): spikes on damage dealt
   - Fear (baseline 0.0): spikes on damage taken + parts lost
   - Pain (baseline 0.0): spikes on damage taken, fast decay
   - Exploration (baseline 0.0): increases when no enemies visible

3. **Sense Phase** — For each creature, find visible enemies within sensor range/arc. Emit `enemy_spotted` events. Provide visibility info to brain.

4. **Movement Phase** — Brain (neural net or hardcoded AI) outputs:
   - Movement angle + speed fraction
   - Target enemy index
   - Stance (aggressive ↔ defensive)

   Movement speed = `BASE_SPEED * legFactor * weightFactor`. Speed-based evasion: `dodge_chance = speed² × 0.60` (capped at 45%).

5. **Attack Phase** — Weapons attack if target in range. Damage calculation:
   - Base weapon damage × (1 + speed² × 0.9) speed bonus
   - Reduced by armor: `× (1 - armorPoints × 0.05)` (capped at 50%)
   - Shell provides flat -2 damage reduction
   - Hit distribution weighted: shell 3.0, armor 2.5, core 0.5, others 1.0
   - Joint damage propagation: 15% to parent on part destruction
   - Contact damage (spikes) applied when within range 3.5

6. **Death Phase** — Check death conditions:
   - Core body destroyed → `core_destroyed`
   - No locomotion remaining → `no_locomotion`
   - Energy completely depleted (via self-damage) → `energy_depleted`

### Hardcoded AI Behaviors

When no neural net is present:
- **Aggressive:** Approach nearest enemy, attack when in range
- **Flee:** Run away when health < 50%
- **Kite:** Fast creatures (speed > 0.8) engage 70% / retreat 30%, flee when multiple enemies nearby
- **Smart targeting:** Creatures with 2+ sensors target weakest enemy instead of nearest

### Match Configuration

```typescript
interface MatchConfig {
  seed: number;        // PRNG seed for determinism
  maxTicks: number;    // Default 600 (60 seconds at 10 Hz)
  creatures: CreatureBlueprint[];
}
```

Spawn positions: evenly spaced around a circle at 35% of arena radius.

### Step-by-Step Playback

For real-time arena display, the match runs via:

```typescript
const match = initLiveMatch(config);  // Set up state

// Each game tick (10 Hz):
const events = stepTick(match);       // Returns sensory events

// At any time:
const result = getMatchResult(match); // Compute placements
```

Arena screen lerps creature positions at 60 FPS with `LERP_FACTOR = 0.2`.

---

## 4 Archetypes (Pre-populated Team)

| Name | Body | Parts | Weight | Strategy |
|---|---|---|---|---|
| Berserker | small | 7 | 12.5 | 2 long legs + large claw + small claw + eye + spike |
| Tank | large | 8 | 19.5 | 3 short legs + small claw + antenna + armor plate + shell |
| Flanker | small | 7 | 10.5 | 2 long legs + 2 small claws + eye + spike |
| Spiker | large | 11 | 15 | 4 short legs + 4 spikes + 2 antennae |

All 4 achieve ~23-27% win rate in 4-FFA (balanced by tuning log v4).

---

## Screen Architecture

### Screen Lifecycle

```typescript
interface Screen {
  enter(ctx: ScreenContext): void;  // Activate: set up scene, listeners
  exit(): void;                      // Deactivate: clean up
  update(dt: number): void;          // Every animation frame
  resize(w: number, h: number): void;
}

interface ScreenContext {
  renderer: THREE.WebGLRenderer;    // Shared renderer
  scene: THREE.Scene;                // Fresh scene per screen
  canvas: HTMLCanvasElement;         // The viewport canvas
  navigate: (id: ScreenId) => void;
  editCreature: (slot: number) => void;
}

type ScreenId = 'menu' | 'teams' | 'editor' | 'arena';
```

### Navigation Flow

```
Menu ─┬─→ Teams ──→ Editor (per slot) ──→ back to Teams
      └─→ Arena ──→ back to Menu
```

### Menu Screen

- Bold "SWARM" title with gradient text (white → purple)
- "Creature Arena" subtitle
- Two buttons: TEAMS (green) and ARENA (red)
- Dark radial gradient background

### Teams Screen

- Header with "Your Team" title + Back button
- 2×2 grid of creature cells
- Each cell: per-cell `WebGLRenderer` for 3D preview (slowly rotating), creature name, stats summary
- Click cell → navigates to editor for that slot

### Editor Screen

Three-panel layout:
- **Left panel (180px):** Part buttons grouped by category (core, locomotion, weapon, armor, sensor, passive_armor). Color-coded dots. Click to select part type.
- **Center viewport:** 3D view with OrbitControls. Port spheres pulse on valid attachment points when a part is selected. Ghost preview mesh follows cursor and snaps to nearest valid port.
- **Right panel (200px):** Stats bars (speed, HP, DPS, vision, weight, energy). Undo/Reset/Save buttons. Symmetry toggle (`[S]` key).

Interaction model:
1. Click part button in left panel
2. Hover over creature — valid ports glow cyan, hovered port glows white
3. Click port to place part
4. Right-click any placed part to remove it
5. `[S]` toggles bilateral symmetry
6. `Ctrl+Z` undoes last placement
7. Back button saves and returns to teams

### Arena Screen

- Full 3D combat view with orbiting camera
- Health bars at bottom for all creatures
- Timer at top-right (MM:SS)
- Kill feed at top-right (part lost / creature died, fades after 6s)
- Winner overlay on match end

---

## Rendering

### Creature Mesh Builder

`buildCreatureMesh(rootPart)` recursively walks the `PartInstance` tree:

1. For root body: create geometry at origin
2. For each child: look up parent's `portLayout[child.portIndex]` for position + direction
3. Create part geometry, orient based on direction, position at port offset
4. Recurse into child's children

Returns `{ group: THREE.Group, partMeshes: Map<instanceId, THREE.Object3D> }` — the map is used for part detachment effects.

### Part Geometries

| Part | Geometry | Color |
|---|---|---|
| body_small | Sphere (radius 0.8) scaled [1.1, 0.9, 1.0] | #6688aa |
| body_large | Sphere (radius 1.0) scaled [1.3, 0.8, 1.1] | #7799bb |
| leg_short | Cylinder (radius 0.08, height 0.7) | #44aa88 |
| leg_long | Cylinder (radius 0.06, height 1.1) | #55bb99 |
| claw_small | Cone (radius 0.12, height 0.3) | #cc6644 |
| claw_large | Cone (radius 0.18, height 0.45) | #dd5533 |
| spike | Cone (radius 0.08, height 0.25) | #cc7744 |
| armor_plate | Box (0.4 × 0.5 × 0.08) | #8888aa |
| sensor_eye | Sphere (radius 0.1) | #aa44cc |
| sensor_antenna | Cylinder (radius 0.02, height 0.4) + sphere tip | #bb55dd |
| shell_dorsal | Sphere hemisphere (radius 0.5) scaled [1.2, 0.6, 1.0] | #777799 |

### Effects

- **Hit flash:** On `contact_hit` — briefly set `emissive` to white, fade back
- **Part debris:** On `part_lost` — detach mesh, spawn small particles, apply physics-like drift
- **Death:** Fade opacity to 0.3, sink Y position to -0.5

### Camera

- **Editor:** `OrbitControls` centered on origin
- **Arena:** Orbiting camera that tracks the centroid of alive creatures, slowly rotating

---

## Sound Integration

### Architecture

```
[Main Thread]              [Audio Thread (Worklet)]
     │                           │
     ├── loadCreatureSynthWasm() │
     │   → WebAssembly.Module    │
     │                           │
     ├── audioWorklet.addModule  │
     │   (creature-synth-processor.ts)
     │                           │
     ├── new AudioWorkletNode ───┤
     │   processorOptions: {     │
     │     wasmModule,           ├── init(wasmModule)
     │     sab                   │   init_engine(sampleRate)
     │   }                      │
     │                           │
     │ port.postMessage({        │
     │   type: 'trigger',    ────┤── trigger_sound(soundType)
     │   soundType: 0            │
     │ })                        │
     │                           │
     │ port.postMessage({        │
     │   type: 'setParams',  ────┤── set_creature_params(...)
     │   body_size, material,    │
     │   weight, aggression      │
     │ })                        │
     │                           │
     │ Atomics.load(sab, 0)  ←───┤── Atomics.store(sab, ...)
     │   (telemetry polling)     │   (active voices, peak level)
```

### Sound Types (Rust Engine)

| ID | Name | Mode | Character |
|---|---|---|---|
| 0 | Footstep | FM | Fast decay impact. body_size → pitch, weight → sustain |
| 1 | ClawStrike | FM | Sharp 3:1 harmonic attack. material → ring time |
| 2 | PartDetach | FM | Inharmonic 1.414:1 ratio, descending pitch (breaking) |
| 3 | IdleBreath | Glottal | Mostly noise (30-45% aspiration), slow 30-70 Hz pulse |
| 4 | Vocalize | Glottal | Rosenberg pulses → 3-formant resonator. body_size → formants |

### Creature → Synth Parameter Mapping

```
body_size  = body_large ? 0.7 : 0.3
material   = min(1, armorPartCount / 3)
weight     = min(1, totalWeight / 25)
aggression = min(1, weaponCount / 5)
```

### Combat Event → Sound Trigger Mapping

| Simulation Event | Sound Triggered | Timing |
|---|---|---|
| Creature moving (alive) | Footstep | Every 400ms / speed factor |
| `contact_hit` event | ClawStrike | Debounced 50ms |
| `part_lost` event | PartDetach | Debounced 50ms |
| `enemy_killed` event | Vocalize | Immediate |
| Any alive creature | IdleBreath | Every 3000ms (ambient) |

### Rust Engine Details

- 32 voice polyphony with LRU voice stealing
- FM synthesis: carrier + modulator oscillators, vibrato, pitch sweep
- Glottal synthesis: Rosenberg pulse train → biquad bandpass formant filters
- ADSR envelope per voice
- Soft-clip limiter, denormal bias
- Interleaved stereo output (128 frames/block)

### SharedArrayBuffer Telemetry

4 slots × 4 bytes = 16 bytes:
```
[0] Int32:   active_voice_count
[1] Int32:   total_renders
[2] Float32: peak_level
[3] Float32: render_us (microseconds)
```

Written by worklet via `Atomics.store`, read by main thread via `Atomics.load`.

---

## File Structure

```
pocs/poc10/
├── SPEC.md                      # This file
├── package.json                 # Vite + Three.js + TypeScript
├── tsconfig.json                # ES2022, strict, @creature-synth alias
├── vite.config.ts               # Port 3010, COEP headers, WASM alias
├── index.html                   # Single-page shell with all CSS
├── build.sh                     # WASM build script (wasm-pack)
│
├── crate/                       # Rust synthesis engine
│   ├── Cargo.toml               # creature-synth, cdylib, wasm-bindgen
│   ├── src/lib.rs               # ~940 lines: FM + glottal + formant synthesis
│   └── pkg/                     # Built WASM + JS bindings
│       ├── creature_synth.js
│       ├── creature_synth.d.ts
│       ├── creature_synth_bg.wasm
│       └── creature_synth_bg.wasm.d.ts
│
└── src/
    ├── main.ts                  # App bootstrap, screen router, animation loop
    │
    ├── screens/
    │   ├── screen.ts            # Screen/ScreenContext interfaces
    │   ├── menu-screen.ts       # Title screen + navigation
    │   ├── teams-screen.ts      # 2×2 creature grid with 3D previews
    │   ├── editor-screen.ts     # Full creature editor (parts panel + viewport + stats)
    │   └── arena-screen.ts      # Combat spectator + sound integration
    │
    ├── simulation/
    │   ├── types.ts             # All type definitions (PartId, PortSlot, etc.)
    │   ├── catalog.ts           # 11 part definitions with portLayout
    │   ├── constants.ts         # All balance constants (BUDGET, ARENA, SPEED, COMBAT, etc.)
    │   ├── archetypes.ts        # 4 pre-built creature blueprints
    │   ├── match.ts             # LiveMatch, initLiveMatch, stepTick, getMatchResult
    │   ├── combat.ts            # 6-phase tick loop
    │   ├── brain.ts             # Neural net forward pass
    │   ├── sensory.ts           # Visibility/threat calculations
    │   ├── prng.ts              # Mulberry32 seeded PRNG
    │   └── validator.ts         # Blueprint validation
    │
    ├── editor/
    │   └── editor-state.ts      # EditorState class, part tree ops, stats computation
    │
    ├── rendering/
    │   ├── scene-setup.ts       # Scene + lighting + ground grid
    │   ├── creature-mesh.ts     # Part tree → Three.js mesh hierarchy
    │   ├── camera.ts            # Editor OrbitControls + arena orbiting camera
    │   └── effects.ts           # Hit flash + debris particles
    │
    └── audio/
        ├── wasm-loader.ts       # WASM compile + cache
        ├── creature-synth-processor.ts  # AudioWorklet processor
        └── sound-manager.ts     # Combat event → synth trigger mapping
```

---

## Balance Tuning Reference

The simulation went through 4 balance iterations to achieve ~25% win rate per archetype in 4-FFA:

- v1: Tank dominated (41%), Flanker unviable (3.6%)
- v2: Reduced armor/point, buffed claw_small, added speed damage bonus
- v3: Added quadratic speed evasion, crowd avoidance AI for kiters
- v4: Differentiated claw sizes, quadratic speed bonus at 0.9, short leg speed 0.6→0.8, contact range 3.5

Key balance levers:
- `SPEED.SPEED_DAMAGE_BONUS_FACTOR` (0.9) — most impactful for glass cannon viability
- `COMBAT.EVASION_PER_SPEED_SQ` (0.60) — makes speed a defensive stat too
- `COMBAT.ARMOR_REDUCTION_PER_POINT` (0.05) — armor stacking ceiling
- `AI_BEHAVIOR.KITE_ENGAGE_RATIO` (0.7) — prevents kiters from infinite kiting

---

## Known Limitations

1. **No multiplayer** — Combat runs locally, no SpacetimeDB
2. **No shader system** — Fixed MeshStandardMaterial colors, no custom GPU shaders
3. **No screen transitions** — Instant screen swaps (transitions.ts planned but not implemented)
4. **Single synth instance** — All creatures share one set of synth params; ideally each creature would have independent params
5. **No persistence** — Team edits are lost on page refresh
6. **AudioWorklet startup** — Sound requires user gesture (arena entry); first few footsteps may be silent during WASM init
