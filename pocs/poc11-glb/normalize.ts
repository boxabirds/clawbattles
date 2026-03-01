#!/usr/bin/env bun
/**
 * Normalize GLB meshes for the creature part library.
 *
 * For each GLB:
 *   1. Compute bounding box of all mesh primitives
 *   2. Translate so bottom-center of bounding box is at origin (0,0,0) — the attachment point
 *   3. Scale uniformly so total height matches the part's target height
 *   4. Orient to face +Z (canonical forward direction)
 *
 * Convention: attachment point = mesh origin = base of part.
 * creature-builder positions parts relative to parent's local origin,
 * so normalized GLBs drop in without positioning changes.
 *
 * Usage:
 *   bun normalize.ts [input-dir] [output-dir]
 *
 * Defaults:
 *   input:  bakeoff-results/{api}/{partId}.glb
 *   output: normalized/{api}/{partId}.glb
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { NodeIO } from '@gltf-transform/core';
import { getPrompt, PART_PROMPTS } from './prompts';

// ── Config ───────────────────────────────────────────────────────

const BASE_DIR = import.meta.dir;
const DEFAULT_INPUT_DIR = join(BASE_DIR, 'bakeoff-results');
const DEFAULT_OUTPUT_DIR = join(BASE_DIR, 'normalized');

// ── Types ────────────────────────────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

interface NormalizeResult {
  inputPath: string;
  outputPath: string;
  partId: string;
  originalBounds: BoundingBox;
  targetHeight: number;
  scaleFactor: number;
  error?: string;
}

// ── Bounding Box Computation ─────────────────────────────────────

function computeBounds(doc: any): BoundingBox {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAccessor = prim.getAttribute('POSITION');
      if (!posAccessor) continue;

      const posArray = posAccessor.getArray();
      if (!posArray) continue;

      for (let i = 0; i < posArray.length; i += 3) {
        const x = posArray[i];
        const y = posArray[i + 1];
        const z = posArray[i + 2];

        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        min.z = Math.min(min.z, z);
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
        max.z = Math.max(max.z, z);
      }
    }
  }

  return { min, max };
}

// ── Transform Application ────────────────────────────────────────

/**
 * Apply translation and uniform scale directly to vertex positions.
 * This bakes the transform into the geometry so the GLB's node transforms
 * stay identity — simpler for the runtime to clone and position.
 */
function transformVertices(doc: any, translation: Vec3, scale: number): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAccessor = prim.getAttribute('POSITION');
      if (!posAccessor) continue;

      const posArray = posAccessor.getArray();
      if (!posArray) continue;

      for (let i = 0; i < posArray.length; i += 3) {
        posArray[i]     = (posArray[i]     + translation.x) * scale;
        posArray[i + 1] = (posArray[i + 1] + translation.y) * scale;
        posArray[i + 2] = (posArray[i + 2] + translation.z) * scale;
      }

      // Also transform normals if present (only rotation would change normals,
      // but uniform scale preserves direction — normals stay valid)

      // Update the accessor's min/max bounds
      posAccessor.setArray(posArray);
    }
  }
}

// ── Normalize a Single GLB ───────────────────────────────────────

async function normalizeGlb(
  inputPath: string,
  outputPath: string,
  targetHeight: number,
): Promise<NormalizeResult> {
  const partId = basename(inputPath, '.glb');
  const io = new NodeIO();

  try {
    const doc = await io.read(inputPath);
    const bounds = computeBounds(doc);

    // Sanity check: did we find any geometry?
    if (bounds.min.x === Infinity) {
      return {
        inputPath, outputPath, partId, targetHeight,
        originalBounds: bounds, scaleFactor: 0,
        error: 'No geometry found in GLB',
      };
    }

    // GLB meshes from AI generators typically use Y-up.
    // Three.js also uses Y-up. So "height" = Y-axis extent.
    const currentHeight = bounds.max.y - bounds.min.y;
    if (currentHeight <= 0) {
      return {
        inputPath, outputPath, partId, targetHeight,
        originalBounds: bounds, scaleFactor: 0,
        error: `Zero or negative Y-extent: ${currentHeight}`,
      };
    }

    // Translation: move bottom-center to origin
    // bottom-center = midpoint of X and Z at minY
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;
    const translation: Vec3 = {
      x: -centerX,
      y: -bounds.min.y,  // shift bottom to Y=0
      z: -centerZ,
    };

    // Scale: uniform scale to match target height
    const scaleFactor = targetHeight / currentHeight;

    // Apply transform directly to vertices
    transformVertices(doc, translation, scaleFactor);

    // Write normalized GLB
    mkdirSync(dirname(outputPath), { recursive: true });
    await io.write(outputPath, doc);

    return {
      inputPath, outputPath, partId, targetHeight,
      originalBounds: bounds, scaleFactor,
    };
  } catch (err: any) {
    return {
      inputPath, outputPath, partId, targetHeight,
      originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      scaleFactor: 0,
      error: err.message,
    };
  }
}

// ── Find GLBs recursively ────────────────────────────────────────

function findGlbs(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...findGlbs(fullPath));
      } else if (entry.endsWith('.glb')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

// ── Resolve target height for a part ─────────────────────────────

/** Map of partId → targetHeight from prompts.ts */
const TARGET_HEIGHTS = new Map(
  PART_PROMPTS.map(p => [p.partId, p.targetHeight])
);

const DEFAULT_TARGET_HEIGHT = 1.0;

function getTargetHeight(partId: string): number {
  return TARGET_HEIGHTS.get(partId) ?? DEFAULT_TARGET_HEIGHT;
}

// ── Main ─────────────────────────────────────────────────────────

const inputDir = process.argv[2] ?? DEFAULT_INPUT_DIR;
const outputDir = process.argv[3] ?? DEFAULT_OUTPUT_DIR;

const glbFiles = findGlbs(inputDir);

if (glbFiles.length === 0) {
  console.error(`No .glb files found in ${inputDir}`);
  console.error('Run the bake-off first: bun bakeoff.ts');
  process.exit(1);
}

console.log(`\nNormalizing ${glbFiles.length} GLB(s) from ${inputDir}\n`);

const results: NormalizeResult[] = [];

for (const glbPath of glbFiles) {
  const relPath = relative(inputDir, glbPath);
  const outPath = join(outputDir, relPath);
  const partId = basename(glbPath, '.glb');
  const targetHeight = getTargetHeight(partId);

  console.log(`  ${relPath} → height ${targetHeight}...`);
  const result = await normalizeGlb(glbPath, outPath, targetHeight);
  results.push(result);

  if (result.error) {
    console.log(`    ERROR: ${result.error}`);
  } else {
    const origH = (result.originalBounds.max.y - result.originalBounds.min.y).toFixed(3);
    console.log(`    original height: ${origH} → ${targetHeight} (scale: ${result.scaleFactor.toFixed(3)})`);
  }
}

// ── Summary ──────────────────────────────────────────────────────

const ok = results.filter(r => !r.error);
const failed = results.filter(r => r.error);

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Normalized: ${ok.length}/${results.length}`);
if (failed.length > 0) {
  console.log(`  Failed: ${failed.length}`);
  for (const f of failed) {
    console.log(`    ${f.partId}: ${f.error}`);
  }
}
console.log(`  Output: ${outputDir}/`);
console.log(`${'═'.repeat(60)}\n`);
