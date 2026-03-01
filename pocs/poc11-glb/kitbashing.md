# Kitbashing: Rigid-Body Creature Assembly

## Terminology

- **Kitbashing** — assembling a model from pre-made modular parts. The overall approach.
- **Hardpoints** — fixed attachment locations on a parent part (e.g., "this body has 6 leg slots and 2 weapon slots"). From mech/vehicle games (MechWarrior etc).
- **Sockets** — the receiving point on a parent part. Unreal Engine's term, widely adopted.
- **Plug** — the connection end of a child part. In our system, the mesh origin IS the plug.
- **Joints** — connection points that allow relative motion (rotation/pivot). Legs have joints; armor plates don't.
- **Seam** — the visible boundary where two parts meet. The main visual challenge.

## Our System: Hardpoint + Socket Hybrid

The body defines hardpoints (where things attach), and each part's origin is the plug. The normalize script ensures `origin = base of part`, so "plug into hardpoint" = "position at parent offset."

### Convention

- **Attachment point = mesh origin (0,0,0) = base of part**
- creature-builder positions parts relative to parent's local origin
- Normalized GLBs drop in without positioning changes
- Per-part offset overrides available for meshes that come out off-center

## The Seam Problem

When a claw attaches to a body, the joint between them can look wrong:
- Visible gap between parts
- Interpenetration where they overlap
- Floating look if scales don't match

### Solutions

1. **Collar/gasket meshes** — small ring/sleeve geometry at the joint that hides the seam. Extra draw calls but clean look.
2. **Consistent socket geometry** — every part's attachment end has the same diameter flange, every parent socket has a matching recess. Requires disciplined reference images.
3. **Overlap by design** — parts slightly penetrate each other, hidden by camera angle and small on-screen size. Simplest, good enough at our render scale.

**Decision: Option 3 (overlap) for now.** At the scale creatures render on screen (50-100px), seams are barely visible. If quality matters later, standardize socket diameter in reference images.

## Pipeline (Validated)

```
1. Reference image    Generate 2D image of isolated part (DALL-E / Midjourney / Flux)
2. Image-to-3D        Upload to Tripo API → image_to_model (30 credits = $0.30)
3. Simplify            meshoptimizer: weld + simplify (ratio 0.02) + dedup + quantize
4. Texture resize      sharp: resize PBR textures (2048 → 128-512 depending on need)
5. Normalize           gltf-transform: center origin at base, scale to target height
6. Deploy              Output to client/public/models/{partType}/{variant}.glb
```

### Key Findings

- **Text-to-3D is useless for isolated parts.** Models generate whole creatures, not individual claws/legs. Prompt engineering cannot fix this — it's a training data distribution problem.
- **Image-to-3D works perfectly.** The quality of the reference image IS the pipeline. A good 2D image → faithful 3D reconstruction.
- **meshoptimizer simplification has no visible artifacts.** 293K → 5.8K faces (98% reduction) with zero quality loss at game render scale.
- **Textures dominate file size, not geometry.** At 5.8K faces, geometry is ~119KB. Three 2048x2048 PBR maps add ~708KB. Resizing to 128x128 drops total to 131KB with no visible difference at small render sizes.
- **Tripo's built-in retopology API errors out.** `convert_model` with `face_limit` returns parameter validation errors. Local meshoptimizer is better anyway — free and instant.

### Size Comparison (claw_small)

| Texture resolution | Faces | Total GLB size |
|--------------------|-------|----------------|
| 2048x2048 (raw)    | 293K  | 8,926KB        |
| 2048x2048 (simplified) | 5.8K | 778KB       |
| 1024x1024          | 5.8K  | 409KB          |
| 512x512            | 5.8K  | 224KB          |
| 256x256            | 5.8K  | 155KB          |
| 128x128            | 5.8K  | 131KB          |

### Cost

- Per part: 30 credits = $0.30 (Tripo image-to-model)
- Full library (45-75 parts): $13-22 total
- Optimization/normalization: free (local)

## Part Types (15)

Each part type has a target height matching creature-builder.ts constants:

| Part | Target Height | Category |
|------|--------------|----------|
| body_small | 1.7 | Body |
| body_large | 2.4 | Body |
| body_centipede | 4.0 | Body |
| leg_short | 1.5 | Leg |
| leg_long | 2.5 | Leg |
| wing | 1.5 | Wing |
| claw_small | 1.12 | Weapon |
| claw_large | 1.68 | Weapon |
| stinger | 2.0 | Weapon |
| mandible | 1.0 | Weapon |
| spike | 0.7 | Weapon |
| armor_plate | 1.0 | Defense |
| shell_dorsal | 1.2 | Defense |
| sensor_eye | 0.4 | Sensor |
| sensor_antenna | 1.0 | Sensor |

Each type gets 3-5 visual variants. Variants come from different reference images fed to the same pipeline.

## Reference Image Guidelines

For best results from image-to-3D:
- Show the part in isolation on a clean background
- Single object, no other parts visible
- Show the connector/socket end if relevant
- Side view or 3/4 view works best
- Consistent lighting, no dramatic shadows
- Game-asset aesthetic (slightly stylized, clean surfaces)
