# AI-Driven WebGL Shaders & Textures for SWARM

Research: how to use AI to generate WebGL shaders with texture and bump maps for creature visual variation.

## Summary

**Build-time generation with runtime parameterization.** Don't generate shaders at runtime — it's slow, unpredictable, and risky. Instead, use Claude to generate a library of parameterized GLSL shaders at build time, then drive creature variation through uniforms at runtime.

---

## 1. Shader Generation

### LLM-Based (Production-Adjacent)

Claude is the most consistent model for GLSL generation per [14islands' comparative testing](https://www.14islands.com/journal/ai-generated-glsl-shaders). The [AI Co-Artist paper](https://arxiv.org/abs/2512.08951) (Nov 2025) showed <3% compilation errors after retries with a 5-retry fallback.

**What works:**

- Generate 8-12 material archetype shaders at build time (organic, chitinous, metallic, crystalline, fungal, etc.)
- Each shader accepts 10-15 uniforms for variation
- One "chitinous" shader produces thousands of visual variations through parameter space
- **Evolutionary mutation**: pass existing shaders back to the LLM for "creatively modified but structurally similar variants" — directly applicable for expanding creature material libraries

**Prompt engineering patterns:**

- Assign expert role: "You are a world-recognized artist and shader programmer"
- Specify algorithms (SDF, Voronoi, fBM) rather than just describing visual output
- Explicitly request performance constraints: "avoid deep loops, especially when doing raymarching"
- Two-step generation (plan, then code) reduces errors
- Temperature adjustment produces dramatic variation from identical prompts

**Fundamental limitation:** LLMs cannot see their output. They compose noise functions based on pattern matching, not visual judgment. Generated shaders require visual validation.

**Tools:**

- [llm-shader-toy](https://github.com/johnPertoft/llm-shader-toy) — open source, writes WebGL shaders with LLMs
- [ChatGL](https://chatgl.ai/) — GPT-4 powered GLSL generator with live preview

### Neural Shaders (Not Viable)

[Neural shading](https://dl.acm.org/doi/10.1145/3721241.3733999) (SIGGRAPH 2025 course) and [ShaderNN](https://github.com/inferenceengine/shadernn) exist but running inference per-pixel in a fragment shader is prohibitive for a browser game with many creatures on screen.

---

## 2. Texture & Material Generation

### AI Texture Generators (Build-Time)

**Ubisoft CHORD** ([GitHub](https://github.com/ubisoft/ubisoft-laforge-chord), open-sourced Dec 2025, SIGGRAPH Asia 2025) — takes a single RGB texture image and produces a full PBR material set:

- Base color, normal map, height map, roughness map, metalness map
- Available as Python API, Gradio web interface, and [ComfyUI nodes](https://github.com/ubisoft/ComfyUI-Chord)
- [HuggingFace weights](https://huggingface.co/Ubisoft/ubisoft-laforge-chord)

**Pipeline:** Stable Diffusion generates base texture → CHORD decomposes into PBR channels → compress to KTX2.

**Other tools:**

- [GenPBR](https://genpbr.com/) — free online PBR texture generator from text prompts
- [Scenario](https://www.scenario.com/blog/ai-texture-generation) — AI models producing coherent PBR map sets
- Stable Diffusion XL with tiling — 1024x1024 base generation, stitchable to 4K

**None of these run in real-time in a browser.** They are build-time or server-side pipeline tools.

### Normal/Bump Map Generation

- [DeepBump](https://github.com/HugoTini/DeepBump) — ML-driven normal and height map generation from single images. **Runs in the browser** via WebGL. Could generate normal maps from procedural diffuse textures at load time.
- [NormalMap-Online](https://cpetry.github.io/NormalMap-Online/) — algorithmic (non-AI) normal map generation, fully client-side

### Procedural Textures in GLSL (Runtime)

Core building blocks for creature skin variation:

| Noise Type | Use Case |
|---|---|
| Voronoi/Worley | Scales, chitin plates, compound eyes |
| fBM (fractal Brownian motion) | Organic surfaces, skin, membrane |
| Turbulence fBM | Sharper, chaotic patterns (damage, scarring) |
| Simplex | Cheaper than Perlin, fewer directional artifacts |

**Libraries:**

- [glNoise](https://farazzshaikh.github.io/glNoise/) — ES Module GLSL noise library, works with Three.js
- [ashima/webgl-noise](https://github.com/ashima/webgl-noise) — canonical WebGL noise shaders
- [LYGIA](https://lygia.xyz/) — reusable GLSL function library including generative patterns

**Techniques:**

- `floor(noiseSample * N) / N` for stepped/quantized patterns (scales, plates)
- Mix noise with UV coordinates for directional patterns (stripes, veins)
- Memory-efficient: no texture storage, everything computed per-pixel

---

## 3. WebGL Considerations

### Performance

- Do work in **vertex shader** where possible, not fragment shader (per-vertex vs per-pixel)
- Avoid loops, conditionals, and trig in fragment shaders
- Use **depth prepass** for complex fragment shaders
- **Instanced rendering** is mandatory: 50 creatures x 5 parts = 250 draw calls without it, ~10-20 with

### Texture Atlas

- Pack all body part textures into a single 2048x2048 or 4096x4096 atlas
- UV offset/scale to select correct sub-texture per part
- Power-of-2 dimensions for memory efficiency and compatibility

### Parameterized Shaders

One shader, many looks via uniforms and per-instance attributes:

```glsl
uniform vec3 u_primaryColor;
uniform vec3 u_secondaryColor;
uniform float u_patternScale;
uniform float u_patternSeed;
uniform float u_roughness;
uniform float u_metallic;
uniform float u_wearAmount;

float pattern = voronoi(vUv * u_patternScale + u_patternSeed);
float wear = fbm(vUv * 8.0 + u_patternSeed) * u_wearAmount;
vec3 baseColor = mix(u_primaryColor, u_secondaryColor, pattern);
baseColor = mix(baseColor, vec3(0.4), wear);
```

Use [InstancedUniformsMesh (Troika)](https://protectwise.github.io/troika/three-instanced-uniforms-mesh/) for per-instance shader uniforms in Three.js.

### WebGL 2.0 vs WebGPU

| Feature | WebGL 2.0 | WebGPU |
|---|---|---|
| Browser support | ~96% | All major browsers (Nov 2025+) |
| Instanced rendering | Native | Native |
| Compute shaders | **No** | **Yes** |
| 3D textures | Yes | Yes |

WebGL 2.0 has **no compute shader support** (spec was abandoned for WebGPU). If runtime GPU texture generation is needed, target WebGPU.

**Recommendation:** Target WebGL 2.0 as floor, WebGPU as enhanced path.

---

## 4. Architecture for SWARM

### Creature Property → Shader Mapping

```
Creature Property          Shader Uniform(s)
─────────────────────────  ──────────────────────────────────
bodySize                   patternScale (larger = coarser pattern)
material (organic/metal)   shader selection + metallic, roughness
aggression                 secondaryColor saturation, pattern sharpness
age                        wearAmount, color desaturation
health                     emissiveIntensity (glow when healthy)
damage                     crackDensity, damageUV offset into damage atlas
species                    noiseOctaves, patternType (Voronoi vs fBM)
rarity                     iridescence, subsurfaceScattering toggle
```

### Per-Part Variation

Each limb/part can have different wear/color. Two approaches:

- **Data texture lookup** (recommended): small texture where row = creature ID, column = part index, RGBA = color/wear/damage/seed. Sample in vertex shader using `gl_InstanceID`.
- **Separate materials per part**: easier to author but costs more draw calls. Only viable if <20 creatures on screen.

### Texture Memory Budget

```
Asset                      Resolution   Format    Size (compressed)
────────────────────────   ──────────   ────────  ─────────────────
Creature texture atlas     2048x2048    KTX2      ~3 MB
Normal map atlas           2048x2048    KTX2      ~3 MB
Roughness/metallic atlas   1024x1024    KTX2      ~0.8 MB
Damage/wear overlay        512x512      KTX2      ~0.2 MB
Per-creature data texture  256x64       RGBA8     ~64 KB
────────────────────────────────────────────────────────────────
Total per creature set:                           ~7 MB
```

10 material archetypes = ~70MB total. Comfortable within mobile budgets.

### Pipeline

```
BUILD TIME:
  1. Claude generates N base material shaders per archetype
  2. Automated validation: compile, render, performance profile
  3. Manual curation: keep the good ones
  4. AI texture generation (CHORD/StableDiffusion) for base textures
  5. Pack textures into atlases, compress to KTX2/Basis Universal

RUNTIME:
  1. Creature DNA determines: material_type, color_palette, pattern_seed,
     roughness, metallic, wear, damage, age
  2. Select base shader from material_type
  3. Set uniforms from creature properties
  4. Per-instance attributes enable batched instanced rendering
  5. LOD: reduce noise octaves and drop normal mapping at distance
```

---

## 5. What NOT to Do

- **Runtime LLM shader generation for gameplay** — 1-5s latency, unpredictable compilation, performance hazards
- **Neural shaders per-pixel** — overhead kills framerate with multiple creatures
- **Per-creature unique textures at runtime** — memory explodes. Use parameterized shaders instead.

---

## 6. Key Resources

| Resource | What |
|---|---|
| [Ubisoft CHORD](https://github.com/ubisoft/ubisoft-laforge-chord) | Single image → full PBR material set |
| [glNoise](https://farazzshaikh.github.io/glNoise/) | Production-ready GLSL noise library |
| [AI Co-Artist](https://arxiv.org/abs/2512.08951) | Evolutionary shader generation via LLM |
| [DeepBump](https://github.com/HugoTini/DeepBump) | Neural normal maps, runs in browser |
| [GenPBR](https://genpbr.com/) | Free PBR textures from text prompts |
| [Troika InstancedUniformsMesh](https://protectwise.github.io/troika/three-instanced-uniforms-mesh/) | Per-instance shader uniforms in Three.js |
| [ashima/webgl-noise](https://github.com/ashima/webgl-noise) | Canonical WebGL noise shaders |
| [The Book of Shaders: Noise](https://thebookofshaders.com/11/) | Noise function reference |
| [Inigo Quilez](https://iquilezles.org/articles/voronoise/) | Voronoi noise and SDF techniques |
| [llm-shader-toy](https://github.com/johnPertoft/llm-shader-toy) | WebGL shader generation with LLMs |
