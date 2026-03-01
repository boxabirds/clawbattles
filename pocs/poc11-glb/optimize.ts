#!/usr/bin/env bun
/**
 * Optimize GLB meshes: weld, deduplicate, simplify, compress.
 *
 * Takes normalized GLBs (or any GLBs) and aggressively reduces them
 * for real-time game use. Target: ~100-200KB per part, 500-3000 faces.
 *
 * Pipeline:
 *   1. weld()     — merge duplicate vertices at seams
 *   2. simplify() — reduce face count via meshoptimizer
 *   3. dedup()    — remove duplicate accessors/textures
 *   4. quantize() — reduce vertex attribute precision
 *
 * Usage:
 *   bun optimize.ts [input-dir] [output-dir]
 *
 * Defaults:
 *   input:  bakeoff-results/
 *   output: optimized/
 */

import { readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename, relative, dirname } from 'path';
import { NodeIO } from '@gltf-transform/core';
import { weld, simplify, dedup, quantize, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// ── Config ───────────────────────────────────────────────────────

const BASE_DIR = import.meta.dir;
const DEFAULT_INPUT_DIR = join(BASE_DIR, 'bakeoff-results');
const DEFAULT_OUTPUT_DIR = join(BASE_DIR, 'optimized');

/**
 * Target ratio of faces to keep (0.0 = maximum reduction, 1.0 = no reduction).
 * 0.02 = keep 2% of faces. For a 100K face mesh → 2K faces.
 */
const SIMPLIFY_RATIO = 0.02;

/** Maximum geometric error allowed during simplification (fraction of mesh bounds). */
const SIMPLIFY_ERROR = 0.01;

/** Weld tolerance — vertices within this distance are merged. */
const WELD_TOLERANCE = 0.0001;

// ── Helpers ──────────────────────────────────────────────────────

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

function countFaces(doc: any): number {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        total += indices.getCount() / 3;
      } else {
        const pos = prim.getAttribute('POSITION');
        if (pos) total += pos.getCount() / 3;
      }
    }
  }
  return Math.round(total);
}

// ── Main ─────────────────────────────────────────────────────────

const inputDir = process.argv[2] ?? DEFAULT_INPUT_DIR;
const outputDir = process.argv[3] ?? DEFAULT_OUTPUT_DIR;

const glbFiles = findGlbs(inputDir);

if (glbFiles.length === 0) {
  console.error(`No .glb files found in ${inputDir}`);
  process.exit(1);
}

// meshoptimizer needs WASM init
await MeshoptSimplifier.ready;

console.log(`\nOptimizing ${glbFiles.length} GLB(s) from ${inputDir}`);
console.log(`  Target ratio: ${SIMPLIFY_RATIO} (keep ${(SIMPLIFY_RATIO * 100).toFixed(0)}% of faces)`);
console.log(`  Max error: ${SIMPLIFY_ERROR}\n`);

const io = new NodeIO();

for (const glbPath of glbFiles) {
  const relPath = relative(inputDir, glbPath);
  const outPath = join(outputDir, relPath);
  mkdirSync(dirname(outPath), { recursive: true });

  try {
    const doc = await io.read(glbPath);
    const facesBefore = countFaces(doc);
    const sizeBefore = statSync(glbPath).size;

    await doc.transform(
      weld({ tolerance: WELD_TOLERANCE }),
      simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: SIMPLIFY_ERROR }),
      dedup(),
      quantize(),
    );

    await io.write(outPath, doc);

    const facesAfter = countFaces(doc);
    const sizeAfter = statSync(outPath).size;

    console.log(
      `  ${relPath}: ` +
      `${(sizeBefore / 1024).toFixed(0)}KB → ${(sizeAfter / 1024).toFixed(0)}KB  ` +
      `(${facesBefore} → ${facesAfter} faces, ` +
      `${((1 - sizeAfter / sizeBefore) * 100).toFixed(0)}% smaller)`
    );
  } catch (err: any) {
    console.log(`  ${relPath}: ERROR ${err.message}`);
  }
}

console.log(`\nOptimized GLBs saved to: ${outputDir}/\n`);
