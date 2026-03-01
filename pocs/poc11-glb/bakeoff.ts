#!/usr/bin/env bun
/**
 * Bake-off: generate the same 3 test parts on Tripo, Meshy, and Rodin.
 * Compares quality, speed, file size, and face count.
 *
 * Usage:
 *   TRIPO_KEY=tsk_xxx MESHY_KEY=xxx RODIN_KEY=xxx bun bakeoff.ts
 *
 * Provide whichever API keys you have — missing keys skip that API.
 * Results saved to bakeoff-results/{api}/{partId}.glb
 */

import { writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { BAKEOFF_PARTS, getPrompt } from './prompts';

// ── Config ───────────────────────────────────────────────────────

const TRIPO_KEY = process.env.TRIPO_API_KEY ?? process.env.TRIPO_KEY ?? '';
const MESHY_KEY = process.env.MESHY_API_KEY ?? process.env.MESHY_KEY ?? '';
const RODIN_KEY = process.env.RODIN_API_KEY ?? process.env.RODIN_KEY ?? '';

const RESULTS_DIR = join(import.meta.dir, 'bakeoff-results');

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutes max wait

// ── Types ────────────────────────────────────────────────────────

interface GenerationResult {
  api: string;
  partId: string;
  glbPath: string;
  fileSizeKB: number;
  durationMs: number;
  error?: string;
}

// ── Tripo API ────────────────────────────────────────────────────

async function generateTripo(partId: string, prompt: string): Promise<GenerationResult> {
  const api = 'tripo';
  const outDir = join(RESULTS_DIR, api);
  mkdirSync(outDir, { recursive: true });
  const glbPath = join(outDir, `${partId}.glb`);
  const start = Date.now();

  try {
    // Create task
    // Docs: https://platform.tripo3d.ai/docs/introduction
    // Endpoint: POST https://api.tripo3d.ai/v2/openapi/task
    // Poll: GET https://api.tripo3d.ai/v2/openapi/task/{task_id}
    // GLB URL in response: data.output.model
    const createRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TRIPO_KEY}`,
      },
      body: JSON.stringify({
        type: 'text_to_model',
        prompt,
      }),
    });
    const createData = await createRes.json() as any;
    if (createData.code !== 0) {
      return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Create failed: ${JSON.stringify(createData)}` };
    }
    const taskId = createData.data.task_id;
    console.log(`  [tripo] ${partId}: task ${taskId} created, polling...`);

    // Poll for completion
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
        headers: { 'Authorization': `Bearer ${TRIPO_KEY}` },
      });
      const pollData = await pollRes.json() as any;
      const status = pollData.data?.status;

      if (status === 'success') {
        const glbUrl = pollData.data.output?.pbr_model ?? pollData.data.output?.model;
        if (!glbUrl) {
          console.log(`  [tripo] ${partId}: success but no model URL. Full output:`, JSON.stringify(pollData.data.output ?? pollData.data, null, 2));
          return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: 'No model URL in response' };
        }
        const glbRes = await fetch(glbUrl);
        const buffer = Buffer.from(await glbRes.arrayBuffer());
        writeFileSync(glbPath, buffer);
        const fileSizeKB = Math.round(buffer.length / 1024);
        return { api, partId, glbPath, fileSizeKB, durationMs: Date.now() - start };
      }
      if (status === 'failed') {
        return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Task failed: ${JSON.stringify(pollData.data)}` };
      }
      // Still processing...
    }
    return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: 'Timeout waiting for completion' };
  } catch (err: any) {
    return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: err.message };
  }
}

// ── Meshy API ────────────────────────────────────────────────────

async function meshyPollUntilDone(taskId: string): Promise<any> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_KEY}` },
    });
    const pollData = await pollRes.json() as any;
    if (pollData.status === 'SUCCEEDED') return { ok: true, data: pollData };
    if (pollData.status === 'FAILED') return { ok: false, error: pollData.message ?? 'unknown' };
  }
  return { ok: false, error: 'Timeout waiting for completion' };
}

async function generateMeshy(partId: string, prompt: string): Promise<GenerationResult> {
  const api = 'meshy';
  const outDir = join(RESULTS_DIR, api);
  mkdirSync(outDir, { recursive: true });
  const glbPath = join(outDir, `${partId}.glb`);
  const start = Date.now();

  try {
    // Stage 1: Preview (generates untextured geometry)
    // Docs: https://docs.meshy.ai/en/api/text-to-3d
    // Base URL: https://api.meshy.ai/openapi/v2/text-to-3d
    console.log(`  [meshy] ${partId}: creating preview task...`);
    const previewRes = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MESHY_KEY}`,
      },
      body: JSON.stringify({
        mode: 'preview',
        prompt,
        should_remesh: true,
        target_polycount: 5000,
        topology: 'triangle',
      }),
    });
    const previewData = await previewRes.json() as any;
    const previewTaskId = previewData.result;
    if (!previewTaskId) {
      return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Preview create failed: ${JSON.stringify(previewData)}` };
    }
    console.log(`  [meshy] ${partId}: preview task ${previewTaskId}, polling...`);

    const previewResult = await meshyPollUntilDone(previewTaskId);
    if (!previewResult.ok) {
      return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Preview failed: ${previewResult.error}` };
    }

    // Stage 2: Refine (adds PBR textures to the preview geometry)
    console.log(`  [meshy] ${partId}: preview done, creating refine task...`);
    const refineRes = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MESHY_KEY}`,
      },
      body: JSON.stringify({
        mode: 'refine',
        preview_task_id: previewTaskId,
      }),
    });
    const refineData = await refineRes.json() as any;
    const refineTaskId = refineData.result;
    if (!refineTaskId) {
      return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Refine create failed: ${JSON.stringify(refineData)}` };
    }
    console.log(`  [meshy] ${partId}: refine task ${refineTaskId}, polling...`);

    const refineResult = await meshyPollUntilDone(refineTaskId);
    if (!refineResult.ok) {
      return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Refine failed: ${refineResult.error}` };
    }

    // Download refined GLB (has PBR textures)
    const glbUrl = refineResult.data.model_urls?.glb;
    if (!glbUrl) {
      return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: 'No GLB URL in refine response' };
    }
    const glbRes = await fetch(glbUrl);
    const buffer = Buffer.from(await glbRes.arrayBuffer());
    writeFileSync(glbPath, buffer);
    const fileSizeKB = Math.round(buffer.length / 1024);
    return { api, partId, glbPath, fileSizeKB, durationMs: Date.now() - start };
  } catch (err: any) {
    return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: err.message };
  }
}

// ── Rodin API ────────────────────────────────────────────────────

async function generateRodin(partId: string, prompt: string): Promise<GenerationResult> {
  const api = 'rodin';
  const outDir = join(RESULTS_DIR, api);
  mkdirSync(outDir, { recursive: true });
  const glbPath = join(outDir, `${partId}.glb`);
  const start = Date.now();

  try {
    // Create generation task
    // Docs: https://developer.hyper3d.ai/get-started/readme-1
    // Base URL: https://api.hyper3d.com/api/v2/rodin
    // Note: API access requires Business subscription ($120/mo)
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('tier', 'Gen-2');
    formData.append('geometry_file_format', 'glb');
    formData.append('material', 'PBR');
    formData.append('quality', 'medium');
    formData.append('mesh_mode', 'Quad');

    const createRes = await fetch('https://api.hyper3d.com/api/v2/rodin', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RODIN_KEY}`,
      },
      body: formData,
    });
    const createData = await createRes.json() as any;
    const taskUuid = createData.uuid;
    if (!taskUuid) {
      return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Create failed: ${JSON.stringify(createData)}` };
    }
    const subscriptionKey = createData.jobs?.subscription_key;
    console.log(`  [rodin] ${partId}: task ${taskUuid} created, polling...`);

    // Poll for completion (Progress Check API)
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(`https://api.hyper3d.com/api/v2/rodin/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RODIN_KEY}`,
        },
        body: JSON.stringify({ uuid: taskUuid, subscription_key: subscriptionKey }),
      });
      const pollData = await pollRes.json() as any;
      const status = pollData.status;

      if (status === 'Done' || status === 'Completed') {
        // Download the GLB
        const downloadRes = await fetch(`https://api.hyper3d.com/api/v2/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RODIN_KEY}`,
          },
          body: JSON.stringify({ task_uuid: taskUuid }),
        });
        const downloadData = await downloadRes.json() as any;
        const glbUrl = downloadData.list?.find((f: any) => f.url?.endsWith('.glb'))?.url;
        if (!glbUrl) {
          return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `No GLB in download list: ${JSON.stringify(downloadData)}` };
        }
        const glbRes = await fetch(glbUrl);
        const buffer = Buffer.from(await glbRes.arrayBuffer());
        writeFileSync(glbPath, buffer);
        const fileSizeKB = Math.round(buffer.length / 1024);
        return { api, partId, glbPath, fileSizeKB, durationMs: Date.now() - start };
      }
      if (status === 'Failed') {
        return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: `Task failed: ${JSON.stringify(pollData)}` };
      }
    }
    return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: 'Timeout waiting for completion' };
  } catch (err: any) {
    return { api, partId, glbPath, fileSizeKB: 0, durationMs: Date.now() - start, error: err.message };
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

// ── Main ─────────────────────────────────────────────────────────

const apis = [
  { name: 'tripo', key: TRIPO_KEY, fn: generateTripo },
  { name: 'meshy', key: MESHY_KEY, fn: generateMeshy },
  { name: 'rodin', key: RODIN_KEY, fn: generateRodin },
].filter(a => {
  if (!a.key) {
    console.log(`⏭  Skipping ${a.name} (no API key — set ${a.name.toUpperCase()}_KEY)`);
    return false;
  }
  return true;
});

if (apis.length === 0) {
  console.error('No API keys provided. Set at least one of: TRIPO_KEY, MESHY_KEY, RODIN_KEY');
  process.exit(1);
}

console.log(`\n🔬 Bake-off: testing ${apis.length} API(s) with ${BAKEOFF_PARTS.length} parts each\n`);

const results: GenerationResult[] = [];

// Generate all parts on all APIs in parallel (within each API's concurrency)
const allPromises: Promise<GenerationResult>[] = [];

for (const partId of BAKEOFF_PARTS) {
  const partPrompt = getPrompt(partId);
  if (!partPrompt) {
    console.error(`No prompt for part: ${partId}`);
    continue;
  }

  for (const api of apis) {
    console.log(`▶ ${api.name} / ${partId}`);
    allPromises.push(api.fn(partId, partPrompt.prompt));
  }
}

const settled = await Promise.all(allPromises);
results.push(...settled);

// ── Report ───────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(80));
console.log('  BAKE-OFF RESULTS');
console.log('═'.repeat(80));

const COL_API = 8;
const COL_PART = 14;
const COL_TIME = 8;
const COL_SIZE = 10;
const COL_STATUS = 30;

console.log(
  'API'.padEnd(COL_API) +
  'Part'.padEnd(COL_PART) +
  'Time'.padEnd(COL_TIME) +
  'Size'.padEnd(COL_SIZE) +
  'Status',
);
console.log('─'.repeat(80));

for (const r of results) {
  const status = r.error ? `ERROR: ${r.error.slice(0, 120)}` : 'OK';
  console.log(
    r.api.padEnd(COL_API) +
    r.partId.padEnd(COL_PART) +
    formatDuration(r.durationMs).padEnd(COL_TIME) +
    (r.fileSizeKB > 0 ? `${r.fileSizeKB}KB` : '-').padEnd(COL_SIZE) +
    status,
  );
}

console.log('─'.repeat(80));
console.log(`\nGLBs saved to: ${RESULTS_DIR}/`);
console.log('Open them at: https://gltf-viewer.donmccurdy.com/');
console.log('');
