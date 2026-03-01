# Candidate APIs for 3D Part Generation

## Comparison

| Service | Signup | API Key Page | Free tier covers 3 tests? | Cost/model | Speed | Poly Control |
|---------|--------|-------------|--------------------------|------------|-------|--------------|
| **Tripo** | [tripo3d.ai/login](https://www.tripo3d.ai/login) | [platform.tripo3d.ai/api-keys](https://platform.tripo3d.ai/api-keys) | Yes (300 credits/mo) | ~$0.21 (Pro $12/mo) | 20s preview, few min full | Retopo API with `face_limit` |
| **Meshy** | [meshy.ai/supa/login](https://www.meshy.ai/supa/login) | [meshy.ai/settings/api](https://www.meshy.ai/settings/api) | Yes (100 credits/mo) | ~$0.40 (Pro $20/mo) | <1 min | Reduce slider 100-300K faces |
| **Rodin** | [hyper3d.ai/signup](https://hyper3d.ai/signup) | Dashboard after login | **No — API requires $120/mo Business plan** | ~$0.75 | 2-5 min | Native `quality_override` 500-1M faces |

## API Details (verified against docs)

### Tripo

- Keys prefixed `tsk_`. Auth: `Authorization: Bearer tsk_xxxxx`
- Create: `POST https://api.tripo3d.ai/v2/openapi/task` with `{ type: "text_to_model", prompt: "..." }`
- Poll: `GET https://api.tripo3d.ai/v2/openapi/task/{task_id}` → status: "success" / "failed"
- GLB URL in: `data.output.pbr_model` (with texture) or `data.output.model` (legacy)
- Docs: https://platform.tripo3d.ai/docs/introduction

### Meshy

- Keys prefixed `msy_`. Auth: `Authorization: Bearer msy_xxxxx`
- Create: `POST https://api.meshy.ai/openapi/v2/text-to-3d` with `{ mode: "preview", prompt: "..." }`
- Poll: `GET https://api.meshy.ai/openapi/v2/text-to-3d/{task_id}` → status: "SUCCEEDED" / "FAILED"
- GLB URL in: `model_urls.glb`
- Params: `target_polycount` (100-300K), `topology` ("quad"/"triangle"), `should_remesh`, `enable_pbr`
- Two-stage: preview (untextured) → refine (textured PBR). Refine needs `{ mode: "refine", preview_task_id: "..." }`
- Test key available: `msy_dummy_api_key_for_test_mode_12345678` (no credits consumed)
- Docs: https://docs.meshy.ai/en/api/text-to-3d

### Rodin

- Bearer token. Auth: `Authorization: Bearer YOUR_KEY`
- Create: `POST https://api.hyper3d.com/api/v2/rodin` (multipart/form-data with `prompt`, `tier`, `geometry_file_format`, etc.)
- Poll: `POST https://api.hyper3d.com/api/v2/rodin/status` with `{ uuid, subscription_key }`
- Download: `POST https://api.hyper3d.com/api/v2/download` with `{ task_uuid }` → returns `list[]` of URLs
- Docs: https://developer.hyper3d.ai/get-started/readme-1
- **API requires Business subscription ($120/mo)**

## Rodin API Access Workaround

Rodin gates API access behind the $120/mo Business plan. Options:
- Use web UI during 7-day free Creator trial to evaluate quality visually
- Use [fal.ai/models/fal-ai/hyper3d/rodin](https://fal.ai/models/fal-ai/hyper3d/rodin) as a pay-per-use proxy (no subscription)

## Signup Methods

- **Tripo**: Email or Google
- **Meshy**: Email (magic link), password, or Google
- **Rodin**: Email-based registration

## Output Format

All three output GLB (binary glTF) with PBR materials (albedo, normal, roughness, metallic maps).

## Connector / Attachment Point

None of the APIs embed attachment point metadata. The generated mesh has an arbitrary origin. The `normalize.ts` post-processing script handles this:

1. Compute bounding box of the generated mesh
2. Translate so bottom-center of bounding box is at origin (0,0,0) — this becomes the attachment point
3. Scale to target height (per part type, matching creature-builder.ts constants)
4. Orient to face +Z

Convention: **attachment point = mesh origin = base of part.** The creature-builder positions parts relative to parent's local origin, so this drops in without positioning changes. Per-part offset overrides available in the normalize script for meshes that come out off-center.

## Full Library Cost Estimate

45-75 models (15 part types × 3-5 variants):
- Tripo: ~$12-16 total (Pro $12/mo + credits)
- Meshy: ~$20-30 total (Pro $20/mo + credits)
- Rodin: ~$35-55 total ($0.75/model) + $120/mo subscription or fal.ai pay-per-use

May mix APIs (e.g., one API for bodies where quality matters, cheaper API for small parts).
