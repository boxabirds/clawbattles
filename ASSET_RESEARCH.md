# Game Asset Research: WebGPU Multiplayer Web Game

**Date:** 2026-02-28

---

## Table of Contents

1. [Scenario.com Deep Dive](#1-scenariocom-deep-dive)
2. [AI 3D Model Generators](#2-ai-3d-model-generators)
3. [Free Asset Libraries](#3-free-asset-libraries)
4. [AI Texture Generators](#4-ai-texture-generators)
5. [Procedural Generation](#5-procedural-generation)
6. [Sound and Music](#6-sound-and-music)
7. [WebGPU-Specific Considerations](#7-webgpu-specific-considerations)
8. [Practical Recommendations](#8-practical-recommendations)

---

## 1. Scenario.com Deep Dive

### What It Is

[Scenario](https://www.scenario.com/) is an AI-native platform for generating consistent, high-quality game assets -- images, textures, 3D models, and video. Its differentiator is **custom model training**: you upload 10-30 reference images of your art style, train a model in ~30 minutes, and then generate unlimited assets that maintain visual consistency. This is the killer feature for game development where aesthetic coherence matters.

### Capabilities

| Category | Supported | Details |
|----------|-----------|---------|
| 2D images/sprites | Yes | Core strength. Custom style models, ControlNet, inpainting, outpainting |
| PBR textures | Yes | Generates albedo, normal, roughness, metallic maps from text or image prompts |
| 3D models | Yes | Integrates 12+ third-party 3D generators (Rodin, Tripo, Hunyuan, Trellis, Meshy, PartCrafter, etc.) |
| Skyboxes | Yes | Generates environment skyboxes |
| Video | Yes | Via integrated video generation models |
| Consistency | Best-in-class | Custom-trained style models maintain palette, line weight, and visual identity |

### 3D Models Available Through Scenario

Scenario does not build its own 3D generator. Instead it acts as a **unified hub** for the best third-party models:

- **Hunyuan 3D 3.0 Pro** -- Ultra-HD, 1024 geometry resolution, 4K PBR textures, ~90s generation
- **Rodin Gen-2** -- 10B parameter model, quad-based meshes, scan-quality realism, ~60s, up to 10 reference images
- **Tripo 2.5** -- Fast single-image photorealistic generation, clean mesh, PBR pipeline compatible
- **Trellis 2** -- 4B parameter, handles complex topologies and transparency, 1536^3 resolution, 4K textures
- **Meshy Suite** -- Image-to-3D, Text-to-3D, retexture, remesh, rigging utilities
- **PartCrafter** -- Generates 2-16 semantically segmented mesh components from a single image
- **Voxel Crafter 1.0** -- Blocky retro-aesthetic assets for sandbox-style games
- **Direct3D-S2** -- Environmental assets using voxel-based generation up to 1024^3 resolution

### API

- RESTful API with JSON responses
- Compatible with any language/framework
- Endpoints for: image generation, model training, 3D generation, texture generation, batch operations
- **dryRun=true** parameter to estimate cost before execution
- Credits shared between web app and API

### Pricing

| Plan | Monthly Cost | Credits | Notes |
|------|-------------|---------|-------|
| Free | $0 | 50/day | Limited, exploratory only |
| Starter | $10/mo | Included credits | Entry level |
| Pro | $30/mo | More credits | Good for solo dev |
| Max | $50/mo | Most credits | Small team |
| Enterprise | Custom | Custom | Volume discounts, reserved instances |
| Annual billing | 33% discount | Same | Recommended if committed |

**Credit costs (Creative Units):**
- ~5 CU per SDXL 1024x1024 image (28 steps)
- ~10 CU per Flux Dev image
- ~15 CU per Enhance operation
- Training: ~450 CU for 20 images at 1500 steps (one-time)
- Example monthly budget: 1,000 images at 1024x1024 = ~5,000 CU

### Workflow for Game Assets

1. **Train style model** -- Upload 10-30 concept art images capturing your game's aesthetic
2. **Generate 2D assets** -- Characters, items, UI elements with consistent style
3. **Generate PBR textures** -- Seamless tileable textures for environments
4. **Image-to-3D** -- Feed 2D concept art into Rodin/Tripo/Hunyuan for 3D models
5. **Reskin/iterate** -- Use the trained model to create variants (e.g., different biome themes)
6. **API integration** -- Automate pipeline or generate assets at runtime

### Verdict on Scenario

**Strengths:** Best-in-class consistency via custom model training. One platform for 2D, textures, and 3D. Good API. Reasonable pricing for indie.

**Weaknesses:** 3D generation is third-party passthrough (you could use those generators directly). Free tier is very limited (50 credits/day). The real value is in the trained models and pipeline integration, not raw generation.

**Recommendation:** Worth it if you need **stylistic consistency** across many assets. If you just need a handful of one-off models, use the underlying generators directly.

---

## 2. AI 3D Model Generators

### Comparison Table

| Generator | Free Tier | Paid From | GLB/glTF Export | PBR Textures | Rigging | Speed | Best For |
|-----------|-----------|-----------|-----------------|--------------|---------|-------|----------|
| [Meshy](https://www.meshy.ai/) | Yes (limited) | $16-20/mo (200-1000 credits) | GLB, glTF, FBX, OBJ, USDZ, BLEND | Yes | Yes (auto) | ~60s | Fast iteration, retexturing |
| [Tripo](https://www.tripo3d.ai/) | 300 credits/mo | $15.90/mo (3,000 credits) | GLB, FBX, OBJ, USD, STL | Yes | Yes (universal) | Seconds-minutes | Game-ready topology, rigging |
| [Rodin (Hyper3D)](https://hyper3d.ai/) | Yes | Varies | glTF, FBX, OBJ | Yes (PBR baking) | SDK/API | 2-5 min | Production realism, quad meshes |
| [Sloyd](https://www.sloyd.ai/) | Unlimited generations | $15/mo (unlimited exports) | Yes | Yes | N/A (procedural) | Instant | Bulk asset production, props |
| [Luma Genie](https://lumalabs.ai/) | Free (limited daily) | N/A | Quad mesh, standard formats | Materials | No | <10s | Quick prototyping |

### Detailed Notes

**Meshy** -- The most well-rounded option. Supports text-to-3D, image-to-3D, retexturing existing models, remeshing, and auto-rigging. Exports in all major formats including GLB. API available. The $20/mo Pro plan gives 1,000 credits (~50 textured models). At scale, cost per model is ~$0.40.

**Tripo** -- Currently the strongest option for **game-ready assets**. Generates clean quad-based topology suitable for real-time rendering. Universal rigging for humanoid characters. Smart retopology. Segmentation for separating parts. The free tier (300 credits) yields roughly 12-20 models/month. Free tier outputs are **CC BY 4.0 (public, requires attribution)**. Paid plans give private commercial use.

**Rodin (Hyper3D)** -- Best surface realism. 4B+ parameters. Generates quad meshes with PBR materials. Supports LODs. Has SDK/API for Unity, Unreal, and Blender integration. The Gen-2 model accepts up to 10 reference images for accuracy. Best for hero assets where quality matters most.

**Sloyd** -- Fundamentally different approach: **procedural generation with AI customization**. Instead of generating meshes from scratch, it uses parameterized templates you can customize via text. The result is always clean topology with proper UV unwrapping and LODs. **Unlimited generations for free**, only exports require the $15/mo plan. At scale, this is the cheapest option by far (~$0.015/model vs $0.40 for Meshy). Best for bulk props, buildings, weapons, environmental objects.

**Luma Genie** -- Free and fast but lower quality than the others. Good for rapid prototyping. The product appears to be pivoting (genie URL now redirects to main Luma platform), so availability is uncertain.

### Cost at Scale (1,000 textured models/month)

| Platform | Cost |
|----------|------|
| Sloyd | $15 |
| Tripo | ~$212 |
| Meshy | ~$400 |

### Recommendation

For a web game, use a **tiered approach**:
- **Sloyd** for bulk environmental props (buildings, furniture, weapons, items) -- unlimited, clean topology
- **Tripo** for characters and hero assets needing rigging -- best game-ready quality
- **Rodin** for a few key hero assets where photorealism/quality is critical
- **Meshy** as a general-purpose fallback with good retexturing tools

---

## 3. Free Asset Libraries

### Top Sources

| Library | Content | License | Formats | Volume |
|---------|---------|---------|---------|--------|
| [Kenney.nl](https://kenney.nl/assets) | 2D/3D models, sprites, UI, audio | CC0 | glTF, PNG, SVG, OGG | 40,000+ assets |
| [Quaternius](https://quaternius.com/) | Low-poly 3D models | CC0 | FBX, OBJ, glTF | 1,411 models |
| [Poly Pizza](https://poly.pizza/) | Low-poly 3D models (aggregator) | CC0/CC BY | FBX, glTF | Thousands |
| [Kay Lousberg](https://www.kaylousberg.com/) | Low-poly 3D characters, modular | CC0 | Various | Hundreds |
| [OpenGameArt](https://opengameart.org/) | 2D, 3D, sound, music | CC0/CC-BY/GPL (varies) | Various | Hundreds of thousands |
| [itch.io game assets](https://itch.io/game-assets/tag-3d) | Everything | Varies (check each) | Various | Massive |
| [Sketchfab (free)](https://sketchfab.com/) | 3D models, scans | CC licenses (varies) | glTF, GLB, FBX, OBJ | Large |

### Detailed Notes

**Kenney.nl** -- The gold standard for free game assets. Everything is CC0 (no attribution required, full commercial use). Includes complete themed packs: space, medieval, city, nature, vehicles, UI kits, fonts, and audio. The 3D assets are low-poly and stylized, perfect for web games. Most packs include glTF exports. A membership "club" gives early access to new packs.

**Quaternius** -- Exceptional quality low-poly animated 3D models. All CC0. Categories include characters, nature, buildings, medieval, space, vehicles. All 1,411 models available in glTF format with no login required. The art style is consistent across packs, making them combinable.

**Poly Pizza** -- Aggregates models from various creators (including Quaternius). Easy search and download. Supports FBX and glTF. No login required. Many models are CC0 but always check per-model.

**Kay Lousberg** -- Specializes in modular character assets. Has collaborated with Kenney on character packs with 75+ skins, 17 animations, and 40 accessories. Great for character customization systems.

**OpenGameArt** -- The largest community repository. Quality is highly variable. Always verify the license per asset (some are CC0, some CC-BY, some GPL). Good for finding niche or specific assets. Sound effects and music collections are underrated here.

### Recommendation

Start with **Kenney + Quaternius** for consistent low-poly style. Both are CC0, high quality, and available in glTF. For a web game aiming for a cohesive look, pick one visual style and stick to assets from one or two creators.

---

## 4. AI Texture Generators

### PBR Texture Tools

| Tool | Cost | Maps Generated | Max Resolution | Notes |
|------|------|---------------|----------------|-------|
| [GenPBR](https://genpbr.com/) | Free | Normal, Metallic, Roughness, AO, Height | 1024x1024 | Algorithmic (not AI), runs in browser, no watermarks |
| [AI Textured](https://aitextured.com/) | Free | Full PBR set from image or text | 4K | AI-based, seamless tiling, WebGL preview, engine-ready |
| [Polycam Texture Gen](https://poly.cam/tools/ai-texture-generator) | Free | 4 seamless textures per prompt | High res | No watermarks, royalty-free commercial license |
| [Scenario Textures](https://www.scenario.com/features/generate-textures) | From $10/mo | Albedo, Normal, Roughness, Metallic | High res | Best for consistency with trained style models |
| [3D AI Studio PBR](https://www.3daistudio.com/Tools/PBRMapGenerator) | Free | Normal, Roughness, Height maps | Varies | Free online tool |

### Workflow for WebGPU

1. Generate base albedo texture from text prompt (Polycam, AI Textured, or Scenario)
2. Generate PBR maps (normal, roughness, metallic, AO) from that albedo (GenPBR or AI Textured)
3. Compress to KTX2 format using `gltf-transform` or Basis Universal for GPU efficiency
4. Load in WebGPU via Three.js KTX2Loader or Babylon.js equivalent

### Recommendation

**GenPBR** for quick algorithmic map generation from any source image (free, fast, in-browser). **AI Textured** for text-to-texture when you need something from scratch. **Scenario** if you need all textures to match a trained art style.

---

## 5. Procedural Generation

### Terrain

| Library/Tool | Framework | WebGPU Support | Notes |
|-------------|-----------|----------------|-------|
| [Three.js TSL Procedural Terrain](https://threejs.org/examples/webgpu_tsl_procedural_terrain.html) | Three.js | Yes (native) | Official example, compute shaders, heightmap noise |
| [THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain) | Three.js | WebGL (adaptable) | Perlin/Simplex noise, multiple algorithms |
| [PlanetTechJS](https://github.com/nicksea/planetTechJS) | Three.js | Yes | Planetary-scale terrain |
| [Kosmos](https://github.com/kaylendog/kosmos) | Rust + WebGPU | Yes (native) | Modular terrain gen in Rust/WASM |
| PLAIN | Web | Yes | Low-poly 3D terrain with simplex noise |

### Particle Systems / VFX

WebGPU compute shaders are ideal for GPU-driven particle systems:

- **Three.js WebGPU** -- Built-in TSL (Three Shading Language) node system for particles, includes official compute-based particle examples
- **Custom compute shaders** -- Write WGSL compute shaders for millions of GPU-driven particles, physics simulations, fluid dynamics
- **Babylon.js 8.0** -- Full WGSL shader support, GPU particle system, post-processing pipeline

### Noise Libraries (JS)

- `simplex-noise` -- Fast 2D/3D/4D simplex noise in JavaScript
- `noisejs` -- Perlin/Simplex noise
- WebGPU compute shaders can generate noise on-GPU (much faster than CPU-side)

### Recommendation

Use **Three.js with WebGPU renderer** and write custom WGSL compute shaders for terrain generation and particle effects. The TSL procedural terrain example is a solid starting point. For complex terrain, generate heightmaps on the GPU and sample them in the vertex shader.

---

## 6. Sound and Music

### Free Sound Effects

| Source | License | Content | Notes |
|--------|---------|---------|-------|
| [Freesound](https://freesound.org/) | CC0/CC-BY (varies per sound) | Massive library of community-uploaded sounds | Largest collection, check license per sound |
| [Kenney Audio](https://kenney.nl/assets?t=audio) | CC0 | Game-oriented SFX packs | Consistent quality, themed packs |
| [OpenGameArt Audio](https://opengameart.org/) | CC0/CC-BY/GPL (varies) | Game SFX and music | Good for game-specific sounds |
| [Pixabay Sounds](https://pixabay.com/sound-effects/) | Pixabay License (free commercial) | General SFX | No attribution required |
| [ZapSplat](https://www.zapsplat.com/) | Free with attribution / Paid no-attribution | Large SFX library | Good quality, game-oriented categories |
| [itch.io SFX](https://itch.io/game-assets/tag-sound-effects) | Varies (many CC0) | Community SFX packs | Often bundled in themed packs |

### Free Music

| Source | License | Notes |
|--------|---------|-------|
| [SoundImage.org](https://soundimage.org/) | Free with credit | 600+ tracks across genres (Action, Fantasy, Sci-Fi, Horror, etc.) |
| [OpenGameArt Music](https://opengameart.org/) | CC0/CC-BY (varies) | Loop-ready game music |
| [Pixabay Music](https://pixabay.com/music/) | Pixabay License | No attribution required |
| [Incompetech](https://incompetech.com/) | CC BY (free) / Paid (no attribution) | Kevin MacLeod's extensive library |

### Procedural Audio

| Tool | Type | Notes |
|------|------|-------|
| [jsfxr](https://sfxr.me/) | Browser-based SFX generator | 8-bit/retro SFX from parameters. Also available as [JS library](https://github.com/chr15m/jsfxr) for runtime generation |
| Web Audio API | Built-in browser API | Synthesize sounds programmatically, no assets needed |
| [Tone.js](https://tonejs.github.io/) | JS library | Music synthesis and sequencing in the browser |

### Recommendation

**Kenney audio packs** for consistent game SFX (CC0). **jsfxr** for procedural retro SFX or as a JS library for runtime generation (zero download size). **Freesound** for specific one-off sounds. **Web Audio API / Tone.js** for procedural music if you want zero external audio files.

---

## 7. WebGPU-Specific Considerations

### Asset Format: glTF/GLB

**glTF is the correct format for WebGPU web games.** It is the "JPEG of 3D" -- an open standard designed for efficient real-time rendering.

- **GLB** = binary glTF (single file, includes geometry + textures + animations). Preferred for web delivery.
- **glTF** = JSON + separate binary/image files. Better for development/debugging.

Both Three.js and Babylon.js have mature glTF loaders with full WebGPU support.

### Compression Pipeline

| What | Tool | Savings | Notes |
|------|------|---------|-------|
| Mesh geometry | Draco compression | 60-90% vertex data reduction | Decompressed via WASM in Web Worker |
| Textures | KTX2 / Basis Universal | ~88% (22MB PNG -> 2.7MB KTX2 for 4K PBR) | GPU-transcoded on device, less GPU memory |
| Overall pipeline | [gltf-transform](https://gltf-transform.donmccurdy.com/) | N/A | CLI tool: applies Draco + KTX2 + optimization in one pass |

**Critical:** Always compress assets before deployment. A single uncompressed 4K PBR material set can be 80MB+. With KTX2 + Draco, the same content drops to under 10MB.

### Shader Language: WGSL

WebGPU uses **WGSL** (WebGPU Shading Language), not GLSL. Key differences:

- Stronger type system with built-in validation (blocks undefined behavior)
- No `#extension` macros -- cleaner, more predictable
- Both Three.js and Babylon.js 8.0 ship all core shaders in WGSL
- Custom shaders must be written in WGSL (no GLSL fallback in WebGPU)

### Framework Support

| Framework | WebGPU Status | glTF | WGSL Shaders | Notes |
|-----------|--------------|------|--------------|-------|
| [Three.js](https://threejs.org/) | Production (r165+) | GLTFLoader + Draco + KTX2 | TSL (compiles to WGSL) | Most popular, largest ecosystem |
| [Babylon.js 8.0](https://babylonjs.medium.com/introducing-babylon-js-8-0-77644b31e2f9) | Production | Full glTF 2.0 + extensions | Native WGSL + GLSL | Best tooling, GLB optimizer |
| [PlayCanvas](https://playcanvas.com/) | In development | Yes | Yes | Collaborative editor |
| [gpu-curtains](https://www.webgpu.com/showcase/gpu-curtains-webgpu-syncs-shaders-dom/) | Experimental | Limited | Yes | DOM-synced WebGPU |

### Performance Expectations

- **2-5x draw-call throughput** over WebGL2
- **~30% lower power draw** (important for mobile web)
- Compute shaders enable GPU-driven rendering, particle systems, physics
- Cold-start: full 3D app loads in <4 seconds vs ~12 seconds with WebGL

### Asset Pipeline Recommendation

```
AI Generator (Tripo/Meshy/Sloyd)
    |
    v
GLB export
    |
    v
gltf-transform optimize (Draco + KTX2)
    |
    v
CDN / Edge delivery
    |
    v
Three.js/Babylon.js GLTFLoader (WebGPU renderer)
    |
    v
WGSL shaders for custom effects
```

---

## 8. Practical Recommendations

### For a Solo Dev / Small Team Building a WebGPU Multiplayer Game

#### Tier 1: Zero-Cost Startup

Use entirely free resources to prototype and validate:

- **3D Models:** Kenney.nl + Quaternius (CC0, glTF ready) + Sloyd free tier (unlimited generations)
- **Textures:** GenPBR (free, in-browser) + Polycam (free, commercial license)
- **Sound:** Kenney audio (CC0) + jsfxr (procedural, zero download)
- **Music:** Pixabay Music (no attribution) or Web Audio API
- **Framework:** Three.js with WebGPU renderer (free, open source)
- **Total cost:** $0/month

#### Tier 2: Low-Budget Production ($30-50/month)

Add AI generation for custom assets:

- **3D Models:** Sloyd Plus ($15/mo, unlimited) for props + Tripo free tier for characters
- **Textures + 2D:** Scenario Pro ($30/mo) for consistent styled assets
- **Sound:** Same free sources + Freesound for specific needs
- **Total cost:** $45-65/month

#### Tier 3: Full Pipeline ($100-150/month)

Comprehensive AI-assisted production:

- **3D Models:** Sloyd ($15) + Tripo Pro ($15.90) + occasional Rodin for hero assets
- **Everything else:** Scenario Max ($50) for 2D, textures, 3D via integrated generators
- **Sound:** Consider a one-time SFX pack purchase (~$20-50)
- **Total cost:** ~$100-130/month

### Key Decisions

1. **Art style first.** Pick low-poly stylized (works great with Kenney/Quaternius/Sloyd) or realistic (needs Tripo/Rodin/Meshy). Low-poly is cheaper, faster to load, and more forgiving of AI artifacts.

2. **glTF/GLB is non-negotiable.** Every tool in this list supports it. Compress everything with Draco + KTX2 before shipping.

3. **Consistency matters more than fidelity.** A game with a coherent CC0 low-poly style looks better than a game mixing photorealistic AI models with cartoon UI. If you go AI-generated, use Scenario's custom model training to keep things consistent.

4. **Budget your time, not just money.** AI 3D generators save modeling time but add QA time -- you will need to clean up topology, fix UV maps, adjust materials. Budget 30-60 minutes of cleanup per AI-generated model for production use.

5. **Compress aggressively for web.** A multiplayer web game cannot afford 200MB of uncompressed assets. Target <20MB initial load, stream the rest. KTX2 textures and Draco meshes are not optional -- they are required.

---

## Sources

- [Scenario.com](https://www.scenario.com/) | [API Docs](https://docs.scenario.com/) | [API Pricing](https://docs.scenario.com/page/api-pricing) | [3D Models Comparison](https://help.scenario.com/en/articles/comparing-generative-3d-models/)
- [Meshy AI](https://www.meshy.ai/) | [Meshy Pricing](https://www.meshy.ai/pricing)
- [Tripo AI](https://www.tripo3d.ai/) | [Tripo Pricing](https://www.tripo3d.ai/pricing)
- [Rodin / Hyper3D](https://hyper3d.ai/)
- [Sloyd AI](https://www.sloyd.ai/) | [Pricing Comparison](https://www.sloyd.ai/blog/3d-ai-price-comparison)
- [Luma Genie](https://lumalabs.ai/)
- [Kenney.nl](https://kenney.nl/assets)
- [Quaternius](https://quaternius.com/)
- [Poly Pizza](https://poly.pizza/)
- [Kay Lousberg](https://www.kaylousberg.com/)
- [OpenGameArt](https://opengameart.org/)
- [GenPBR](https://genpbr.com/)
- [AI Textured](https://aitextured.com/)
- [Polycam Texture Generator](https://poly.cam/tools/ai-texture-generator)
- [Freesound](https://freesound.org/)
- [jsfxr](https://sfxr.me/) | [jsfxr JS Library](https://github.com/chr15m/jsfxr)
- [Three.js WebGPU Procedural Terrain](https://threejs.org/examples/webgpu_tsl_procedural_terrain.html)
- [Babylon.js 8.0](https://babylonjs.medium.com/introducing-babylon-js-8-0-77644b31e2f9)
- [WebGPU + WASM Deep Dive](https://faithforgelabs.com/blog_webgpu_wasm.php)
- [gltf-transform](https://gltf-transform.donmccurdy.com/)
- [glTF WebGPU Case Study](https://toji.dev/webgpu-gltf-case-study/)
- [Pixabay Sound Effects](https://pixabay.com/sound-effects/)
- [SoundImage.org](https://soundimage.org/)
