# SWARM: Connectables Design Document

## The Game

Browser-based multiplayer. You design creatures from snap-together parts. Your creatures compete against other players' creatures for territory in a persistent shared world. WebGPU rendering. SpacetimeDB backend.

## Part Catalog

### Structural

```
CORE (sphere, r=0.3)
├── 6 ports: top, bottom, front, back, left, right
├── Has energy bar (creature dies when core energy = 0)
├── Every creature has exactly 1
└── Cost: 10 biomass

SEGMENT (cylinder, r=0.25, h=0.4)
├── 2 ports: front, back (axial)
├── 4 ports: top, bottom, left, right (radial)
├── Extends body length
└── Cost: 5 biomass

JOINT (small sphere, r=0.15)
├── 6 ports (omnidirectional)
├── Allows articulation between connected parts
├── Ball-joint connection type on all ports
└── Cost: 3 biomass

SHELL (half-sphere cap, r=0.3)
├── 1 port: bottom (attaches to host)
├── Absorbs 20 damage before breaking off
├── Slows creature by 10% per shell
└── Cost: 8 biomass
```

### Locomotion

```
LEG (thin cylinder + foot sphere)
├── 1 port: top (attaches to body)
├── 3 segments: thigh, shin, foot (IK chain)
├── Ground speed: +1.0 per leg (diminishing returns after 6)
├── Stability: creatures with <3 legs tip over on slopes
├── Animated via FABRIK IK + procedural gait
└── Cost: 6 biomass

WING (flat quad, semi-transparent)
├── 1 port: side (attaches to body)
├── Flight requires 2+ wings
├── Air speed: 2.0 per wing pair
├── Fragile: 5 HP per wing
├── Animated via hinge oscillation
└── Cost: 12 biomass

FLIPPER (flat oval)
├── 1 port: side
├── Water speed: +1.5 per flipper
├── Land speed: +0.3 per flipper (waddle)
└── Cost: 7 biomass

THRUSTER (cone with particle trail)
├── 1 port: front (thrust goes backward)
├── Burst speed: +4.0 for 2 seconds, 8 second cooldown
├── Visible flame particle effect
└── Cost: 15 biomass
```

### Sensory

```
EYE (small emissive sphere)
├── 1 port: any
├── Vision radius: +5 tiles per eye
├── Max useful: 4 (diminishing returns)
├── Glows faintly in creature's color
└── Cost: 4 biomass

ANTENNA (thin cylinder + tip sphere)
├── 1 port: top or front
├── Detects resources through fog: +8 tiles
├── Detects enemies through fog: +4 tiles
├── Animated via spring-damper (wobbles)
└── Cost: 5 biomass

BEACON (icosahedron, pulsing glow)
├── 1 port: top
├── Broadcasts creature position to all allied creatures within 20 tiles
├── Allies within range get +10% speed (rallying)
└── Cost: 10 biomass
```

### Offensive

```
MANDIBLE (cone pair, opens/closes on hinge)
├── 1 port: front
├── Melee damage: 5 per bite (1 bite/sec)
├── Also harvests resources (3/sec from deposits)
├── Animated: hinge open/close cycle
└── Cost: 6 biomass

STINGER (sharp cone)
├── 1 port: back or front
├── Melee damage: 12 per hit (0.5 hits/sec)
├── Cannot harvest
├── Animated: thrust forward on attack
└── Cost: 8 biomass

SPITTER (open cylinder)
├── 1 port: front
├── Ranged damage: 4 per projectile
├── Range: 5 tiles
├── Rate: 1 projectile/sec
├── Projectile: small glowing sphere, ballistic arc
└── Cost: 14 biomass

CLAW (curved cone pair)
├── 1 port: left or right
├── Melee damage: 8 per swipe (0.8/sec)
├── Can grab + hold enemy parts (prevents movement)
└── Cost: 10 biomass
```

### Utility

```
CARRIER (open box frame)
├── 1 port: top or back
├── Resource carry capacity: +10 per carrier
├── Visually fills with colored resource cubes as creature carries
└── Cost: 4 biomass

SPAWNER (pulsing sphere, larger than core)
├── 1 port: bottom
├── Creature can produce 1 copy of itself every 60 seconds
├── Copy costs 50% of the design's biomass cost
├── Rare part, unlocked at tier 3
└── Cost: 25 biomass

HEALER (rotating ring)
├── 1 port: any
├── Heals adjacent allied creatures: 2 HP/sec within 3 tiles
├── Visible: green particle stream to heal target
└── Cost: 12 biomass

GLUE (small flat disc)
├── 1 port: any
├── Destroyed parts reattach after 5 seconds instead of falling off
├── Only works once per part per life
└── Cost: 6 biomass
```

## Connection System

### Port Rules

Every part has typed ports. Connections form when a port on Part A touches a compatible port on Part B.

```
Port compatibility matrix:

              MAGNETIC    BALL_JOINT    HINGE       SPRING
structural    ✓           ✓             -           -
locomotion    -           ✓             -           -
sensory       ✓           -             -           ✓
offensive     ✓           -             ✓           -
utility       ✓           ✓             -           -
```

- MAGNETIC: rigid lock. No relative movement. Default for armor, carriers, beacons.
- BALL_JOINT: free rotation (constrained to cone). Legs, flippers. IK-driven.
- HINGE: single-axis rotation. Mandibles, wings, claws. Cycle-driven.
- SPRING: elastic with damping. Antennae, eyes on stalks. Physics-driven.

### Connection Behavior

When a part takes lethal damage:
1. Connection snaps (particle burst + sound)
2. Part becomes a physics object (tumbles away with inherited velocity)
3. Creature recalculates capabilities (speed, damage, carry capacity)
4. Creature adapts locomotion (IK adjusts to remaining legs)
5. If core is exposed (all shells gone), core takes direct damage

### Assembly Rules

- Max parts per creature: 20 (increases with tech level)
- Every creature needs exactly 1 CORE
- No floating parts (everything must connect to core via chain)
- Bilateral symmetry toggle: place a leg on the left, mirror auto-places on right
- Validation: can't spawn a creature with 0 locomotion parts (it wouldn't move)

## Creature Editor

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  SWARM - Creature Designer                    [Deploy]  │
├───────────┬─────────────────────────────┬───────────────┤
│           │                             │  STATS        │
│  PARTS    │     3D VIEWPORT             │               │
│           │                             │  Speed: 4.2   │
│  [core]   │     (rotate/zoom/pan)       │  HP: 45       │
│  [segment]│                             │  DPS: 5.0     │
│  [joint]  │     creature renders here   │  Vision: 15   │
│  [leg]    │     with connection ports   │  Carry: 10    │
│  [wing]   │     visible as glowing dots │  Cost: 47     │
│  [eye]    │                             │               │
│  [mandble]│     click port to select    │  LOCOMOTION   │
│  [stinger]│     drag part to attach     │  Ground: 4.2  │
│  [shell]  │                             │  Air: 0       │
│  [carrier]│                             │  Water: 0     │
│  ...      │                             │               │
├───────────┤                             ├───────────────┤
│ DESIGNS   │                             │  PREVIEW      │
│           │                             │               │
│ Hauler v2 │                             │  [Test Walk]  │
│ War Wasp  │                             │  [Test Fight] │
│ Scout Eye │                             │  [Share Link] │
└───────────┴─────────────────────────────┴───────────────┘
```

### Interaction

1. Click a part in the left panel to pick it up
2. Hover over the creature in the viewport — compatible ports glow
3. Click a glowing port to attach
4. Part snaps into place with magnetic pull animation
5. Stats panel updates in real-time
6. Right-click a part to detach
7. Symmetry mode: [S] key toggles bilateral mirroring

### Test Mode

- "Test Walk" drops creature onto a small terrain patch, it walks around procedurally
- "Test Fight" spawns a dummy enemy creature, yours attacks it
- Player watches to see if the design's locomotion looks right, if attacks connect, if it's too slow/fast

## Procedural Animation System

### Per-Frame Pipeline

```
1. AI DECISION (SpacetimeDB reducer, server-side)
   └── Sets target position + action state per creature

2. STEERING (client-side, CPU)
   └── Smooth interpolation toward target
   └── Obstacle avoidance (simple repulsion)

3. BODY PHYSICS (client-side, GPU compute)
   └── Verlet integration on body chunk positions
   └── Distance constraints between connected parts
   └── Gravity + terrain collision

4. LOCOMOTION (client-side, GPU compute)
   For each leg:
   ├── Cast ray from hip to ground → foot target
   ├── If foot target moved >0.3 from planted position → initiate step
   ├── Step: parabolic arc from current to target over 0.15 sec
   ├── FABRIK IK solve: hip → knee → foot (3 iterations)
   └── Gait: alternate leg groups (left-right for bipeds, wave for 6+ legs)

   For each wing:
   ├── Hinge oscillation: sin(time * FLAP_FREQ) * FLAP_AMPLITUDE
   ├── FLAP_FREQ scales with creature mass (heavier = faster flap)
   └── Body bobs opposite to wing phase

   For each tail/flipper:
   └── Sine wave propagation along segments (phase offset per segment)

5. SECONDARY MOTION (client-side, GPU compute)
   ├── Antennae: spring-damper driven by head velocity
   ├── Carried resources: slight lag behind carrier (spring)
   ├── Shell wobble on impact: damped oscillation
   ├── Eye tracking: slerp toward nearest point of interest
   └── Breathing: sin(t * 0.7) * 0.02 on core scale

6. SQUASH & STRETCH (client-side, vertex shader)
   ├── On landing: squash along Y, stretch along XZ (0.15 sec recovery)
   ├── On hit: squash along impact normal (0.1 sec recovery)
   └── Volume-preserving: stretch = 1 + speed * 0.12, squash = 1/sqrt(stretch)

7. RENDER (instanced draw, 1 call per part type)
   ├── Flat shading, vertex colors
   ├── Rim light for silhouette readability
   ├── Emissive on eyes, beacons, projectiles
   └── Connection points: subtle glow at joints
```

### Gait Patterns (automatic based on leg count + placement)

```
2 legs (biped):    alternating L-R
3 legs (tripod):   2 move while 1 plants, rotate
4 legs (quad):     diagonal pairs (trot) or sequential (walk)
6 legs (hexapod):  tripod gait (alternating triangles)
8+ legs:           wave gait (ripple from back to front)
```

The gait is selected automatically based on leg count and position on the body. No animation data needed.

### Damage & Part Loss Animation

```
1. Part HP reaches 0
2. Connection joint emits spark particles (orange, 20 particles, 0.3 sec)
3. Part detaches: inherits creature velocity + random tumble torque
4. Part fades out over 2 seconds (alpha → 0)
5. Creature body rebalances:
   ├── Lost leg: remaining legs re-solve IK, body tilts toward gap
   ├── Lost wing: creature spirals down if airborne
   ├── Lost shell: core pulses red briefly (vulnerability warning)
   └── Lost weapon: creature switches to flee behavior if no weapons remain
```

## Visual Style

### Color System

Each player picks a primary hue on join. All their creatures use this hue with variation:

```
Core:        player hue, full saturation, bright
Structural:  player hue, desaturated 30%, slightly darker
Locomotion:  player hue, shifted 15° toward warm, medium brightness
Offensive:   player hue, shifted toward red, high saturation
Sensory:     player hue, shifted toward blue, emissive
Utility:     player hue, shifted toward green, medium
```

This means every player's swarm is visually distinct at a glance, and every part within a creature reads as belonging together.

### Lighting

- Single directional sun light (warm white, 35° elevation)
- Hemisphere light (sky blue top, warm brown bottom) for fill
- Rim light (back-edge highlight) for silhouette separation at swarm scale
- Emissive parts (eyes, beacons, projectiles) self-illuminate
- No shadows on creatures (too expensive at 500+ creature scale, and flat shading makes them unnecessary)
- Terrain gets simple shadow map from sun

### Terrain

- Procedural heightmap (compute shader, multi-octave noise + erosion)
- Vertex-colored by height: deep green valleys, tan hills, grey rock peaks
- Resource deposits: glowing crystalline icosahedra embedded in terrain
- Territory overlay: per-tile translucent wash in owning player's color
- Grid lines: subtle, visible when zoomed in for strategic play

### Scale Reference

```
1 tile = 1.0 world unit
Core = 0.6 units diameter (slightly more than half a tile)
Leg = 0.4 units long
Small creature (core + 4 legs) ≈ 1.0 × 0.8 × 1.0 units
Large creature (core + 3 segments + 6 legs + mandibles) ≈ 2.5 × 0.8 × 1.2 units
```

At default zoom, ~40×30 tiles visible. A swarm of 50 small creatures fills about 1/4 of the screen.

## Creature Design Serialization

### Format

```json
{
  "v": 1,
  "name": "Harvester Mk3",
  "parts": [
    { "t": "core", "id": 0 },
    { "t": "segment", "id": 1, "p": 0, "port": "back", "c": "magnetic" },
    { "t": "segment", "id": 2, "p": 1, "port": "back", "c": "magnetic" },
    { "t": "leg", "id": 3, "p": 0, "port": "left", "c": "ball_joint" },
    { "t": "leg", "id": 4, "p": 0, "port": "right", "c": "ball_joint" },
    { "t": "leg", "id": 5, "p": 1, "port": "left", "c": "ball_joint" },
    { "t": "leg", "id": 6, "p": 1, "port": "right", "c": "ball_joint" },
    { "t": "mandible", "id": 7, "p": 0, "port": "front", "c": "hinge" },
    { "t": "carrier", "id": 8, "p": 2, "port": "top", "c": "magnetic" }
  ]
}
```

Compact enough to encode in a URL parameter for sharing. ~200 bytes for a typical creature.

### Sharing

`https://swarm.game/c/eyJ2IjoxLCJuYW1l...` (base64-encoded design JSON)

Click link → editor opens with the design loaded → one click to deploy.

## Example Creature Builds

### "Ant Worker" — The Basic Hauler
```
core
├── front: mandible (hinge) — harvests resources
├── back: segment (magnetic)
│   └── top: carrier (magnetic) — holds resources
├── left: leg (ball_joint)
├── right: leg (ball_joint)
├── segment.left: leg (ball_joint)
└── segment.right: leg (ball_joint)

Stats: Speed 4.0 | HP 25 | DPS 5 | Carry 10 | Cost 42
Role: harvest resources, bring them home
```

### "War Wasp" — The Air Striker
```
core
├── front: stinger (hinge) — high melee damage
├── left: wing (hinge)
├── right: wing (hinge)
├── top: eye (spring) — vision
└── back: thruster (magnetic) — burst speed for dive attacks

Stats: Speed 6.0 (air) | HP 20 | DPS 12 | Vision 10 | Cost 55
Role: fast attack, fragile, hit-and-run
```

### "Tank Beetle" — The Armored Push
```
core
├── top: shell (magnetic)
├── front: shell (magnetic)
│   └── front: claw (hinge)
├── back: segment (magnetic)
│   ├── top: shell (magnetic)
│   └── back: stinger (magnetic)
├── left: leg (ball_joint)
├── right: leg (ball_joint)
├── segment.left: leg (ball_joint)
└── segment.right: leg (ball_joint)

Stats: Speed 2.1 | HP 85 | DPS 8+12 | Cost 78
Role: frontline, absorbs damage, holds territory
```

### "Seer Spider" — The Intelligence Gatherer
```
core
├── front: eye (spring)
├── top: antenna (spring)
├── back: antenna (spring)
├── left-front: leg (ball_joint)
├── right-front: leg (ball_joint)
├── left-back: leg (ball_joint)
├── right-back: leg (ball_joint)
├── top-front: eye (spring)
└── top-back: beacon (magnetic)

Stats: Speed 5.2 | HP 20 | DPS 0 | Vision 25 | Cost 46
Role: scout, reveals map, rallies nearby allies, no attack
```

### "Hydra" — The Late-Game Monstrosity
```
core
├── front: joint (ball_joint)
│   ├── front: joint (ball_joint)
│   │   └── front: spitter (hinge)
│   ├── left: joint (ball_joint)
│   │   └── front: spitter (hinge)
│   └── right: joint (ball_joint)
│       └── front: spitter (hinge)
├── back: segment (magnetic)
│   └── back: segment (magnetic)
│       └── back: spawner (magnetic)
├── left: leg (ball_joint)
├── right: leg (ball_joint)
├── segment1.left: leg (ball_joint)
├── segment1.right: leg (ball_joint)
├── segment2.left: leg (ball_joint)
├── segment2.right: leg (ball_joint)
├── top: shell (magnetic)
└── core.top-front: eye (spring)

Stats: Speed 2.5 | HP 65 | DPS 12 (3 spitters) | Self-replicating | Cost 120
Role: siege weapon, area denial, expensive
```

## SpacetimeDB Schema

```typescript
// === TABLES ===

const Player = table({ name: 'player', public: true }, {
  identity: t.identity().primaryKey(),
  name: t.string(),
  color_hue: t.f32(),          // 0-360, player's color identity
  home_x: t.i32(),
  home_y: t.i32(),
  biomass: t.u32(),
  crystal: t.u32(),
  metal: t.u32(),
  tech_level: t.u8(),          // unlocks more parts + higher max parts
  online: t.bool(),
});

const CreatureDesign = table({ name: 'creature_design', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity(),
  name: t.string(),
  parts_json: t.string(),     // serialized part tree (see format above)
  total_cost: t.u32(),        // computed: sum of part costs
  max_speed: t.f32(),         // computed from parts
  max_hp: t.f32(),            // computed from parts
  dps: t.f32(),               // computed from parts
  carry_capacity: t.u32(),    // computed from parts
  vision_range: t.f32(),      // computed from parts
  can_fly: t.bool(),          // computed: has 2+ wings
  created_at: t.u64(),
});

const Creature = table({ name: 'creature', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity(),
  design_id: t.u64(),
  x: t.f32(),
  y: t.f32(),
  health: t.f32(),
  state: t.u8(),              // 0=idle, 1=moving, 2=harvesting, 3=fighting, 4=fleeing, 5=carrying
  target_x: t.f32(),
  target_y: t.f32(),
  carrying_amount: t.u32(),
  carrying_type: t.u8(),      // 0=none, 1=biomass, 2=crystal, 3=metal
  parts_alive: t.string(),    // bitmask: which parts are still attached
});

const Structure = table({ name: 'structure', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity(),
  x: t.i32(),
  y: t.i32(),
  structure_type: t.u8(),     // 0=hive, 1=wall, 2=turret, 3=harvester, 4=lab
  health: t.f32(),
  level: t.u8(),
});

const Territory = table({ name: 'territory', public: true }, {
  chunk_x: t.i32(),
  chunk_y: t.i32(),
  owner: t.identity(),
  control: t.f32(),           // 0-1, strength of control
});

const TerrainChunk = table({ name: 'terrain_chunk', public: true }, {
  chunk_x: t.i32(),
  chunk_y: t.i32(),
  seed: t.u64(),
  resources_json: t.string(), // resource deposit positions + types + amounts
});

// Event tables (transient, not persisted)
const EventCombat = table({ name: 'event_combat', public: true }, {
  attacker_id: t.u64(),
  defender_id: t.u64(),
  damage: t.f32(),
  x: t.f32(),
  y: t.f32(),
  part_destroyed: t.string(), // which part broke off, if any
});

const EventChat = table({ name: 'event_chat', public: true }, {
  sender: t.identity(),
  message: t.string(),
  x: t.f32(),
  y: t.f32(),
});

// === REDUCERS ===

// Player actions
spacetimedb.reducer('join_game',        [t.string(), t.f32()]);        // name, color_hue
spacetimedb.reducer('spawn_creature',   [t.u64(), t.f32(), t.f32()]);  // design_id, x, y
spacetimedb.reducer('command_creature',  [t.u64(), t.f32(), t.f32(), t.u8()]); // creature_id, target_x, target_y, action
spacetimedb.reducer('command_swarm',    [t.f32(), t.f32(), t.u8()]);   // target_x, target_y, action (all selected)
spacetimedb.reducer('build_structure',  [t.u8(), t.i32(), t.i32()]);   // type, x, y
spacetimedb.reducer('save_design',      [t.string(), t.string()]);     // name, parts_json
spacetimedb.reducer('delete_design',    [t.u64()]);                    // design_id

// Scheduled (server tick)
spacetimedb.reducer('tick_world');       // 1/sec: resource regen, territory decay, offline defense
spacetimedb.reducer('tick_creatures');   // 4/sec: movement, harvesting, combat resolution
spacetimedb.reducer('tick_spawners');    // 1/min: self-replicating creatures produce copies
```

## File Structure

```
swarm/
├── src/
│   ├── client/
│   │   ├── main.ts                 # entry point, Three.js setup
│   │   ├── renderer/
│   │   │   ├── scene.ts            # Three.js WebGPU scene setup
│   │   │   ├── camera.ts           # isometric camera + zoom/pan
│   │   │   ├── terrain.ts          # procedural terrain (compute shader)
│   │   │   ├── creatures.ts        # instanced creature rendering
│   │   │   ├── structures.ts       # structure rendering
│   │   │   ├── particles.ts        # GPU particle system
│   │   │   └── territory.ts        # territory overlay shader
│   │   ├── parts/
│   │   │   ├── registry.ts         # all part definitions (shape, stats, ports)
│   │   │   ├── meshes.ts           # generate BufferGeometry per part type
│   │   │   └── connections.ts      # connection type physics (magnetic, ball, hinge, spring)
│   │   ├── animation/
│   │   │   ├── verlet.ts           # Verlet integration for body chunks
│   │   │   ├── ik.ts               # FABRIK IK solver
│   │   │   ├── gait.ts             # automatic gait selection + foot placement
│   │   │   ├── secondary.ts        # spring-damper for antennae, tails, etc.
│   │   │   └── damage.ts           # part breakage + detach animation
│   │   ├── editor/
│   │   │   ├── editor.ts           # creature editor UI + 3D viewport
│   │   │   ├── drag-drop.ts        # part placement interaction
│   │   │   ├── symmetry.ts         # bilateral mirror mode
│   │   │   ├── validation.ts       # design rules enforcement
│   │   │   ├── stats.ts            # real-time stat computation
│   │   │   └── sharing.ts          # URL encode/decode designs
│   │   ├── input/
│   │   │   ├── commands.ts         # click-to-command, drag-select
│   │   │   └── camera-control.ts   # pan, zoom, rotate
│   │   ├── audio/
│   │   │   ├── sfx.ts              # zzfx procedural sound effects
│   │   │   └── music.ts            # Tone.js generative ambient
│   │   ├── network/
│   │   │   ├── connection.ts       # SpacetimeDB client setup
│   │   │   ├── subscriptions.ts    # spatial chunk subscriptions
│   │   │   └── sync.ts             # interpolate server state for rendering
│   │   └── ui/
│   │       ├── hud.ts              # resource counts, minimap
│   │       ├── minimap.ts          # territory overview
│   │       └── chat.ts             # proximity chat
│   ├── server/
│   │   ├── module.ts               # SpacetimeDB module entry
│   │   ├── tables.ts               # all table definitions
│   │   ├── reducers/
│   │   │   ├── player.ts           # join, disconnect
│   │   │   ├── creatures.ts        # spawn, command, movement resolution
│   │   │   ├── combat.ts           # damage, part destruction, death
│   │   │   ├── economy.ts          # harvesting, resource transfer, building
│   │   │   ├── territory.ts        # control calculation, decay
│   │   │   └── designs.ts          # save, validate, compute stats
│   │   └── tick/
│   │       ├── world.ts            # resource regen, territory maintenance
│   │       ├── creatures.ts        # movement, AI, harvesting, combat
│   │       └── spawners.ts         # self-replicating creature logic
│   └── shared/
│       ├── parts.ts                # part definitions shared between client + server
│       ├── stats.ts                # stat computation formulas
│       └── constants.ts            # game balance numbers
├── public/
│   └── index.html                  # single HTML file, loads JS bundle
├── docs/
│   ├── research/
│   │   └── spacetimedb2.0.md
│   ├── design/
│   │   └── connectables.md         # this file
│   └── proposal.md
├── spacetime.json                  # SpacetimeDB config
├── package.json
└── tsconfig.json
```
