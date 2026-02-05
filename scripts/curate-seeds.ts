// ABOUTME: Analyzes map seeds to find good ones with diverse terrain.
// ABOUTME: Run with: npx tsx scripts/curate-seeds.ts > worker/src/seedData.json

import { execSync } from 'child_process';
import * as path from 'path';

interface SeedInfo {
  seed: number;
  terrain: string;
  water_pct: number;
  buildable_pct: number;
  description: string;
}

const BATCH_SIZE = 1000;
const MAX_SEED = 10000;
const PER_TERRAIN = 50;
const TOTAL_CAP = 200;

const workerScript = path.join(import.meta.dirname!, 'curate-seeds-batch.ts');
const candidates: SeedInfo[] = [];

for (let start = 1; start <= MAX_SEED; start += BATCH_SIZE) {
  const end = Math.min(start + BATCH_SIZE - 1, MAX_SEED);
  const result = execSync(
    `npx tsx "${workerScript}" ${start} ${end}`,
    { cwd: path.join(import.meta.dirname!, '..'), maxBuffer: 50 * 1024 * 1024 },
  );
  const batch: SeedInfo[] = JSON.parse(result.toString());
  candidates.push(...batch);
  process.stderr.write(`Processed seeds ${start}-${end}: ${batch.length} candidates (${candidates.length} total)\n`);
}

const byTerrain: Record<string, SeedInfo[]> = {};
for (const c of candidates) {
  (byTerrain[c.terrain] ??= []).push(c);
}

const selected: SeedInfo[] = [];
for (const [, seeds] of Object.entries(byTerrain)) {
  seeds.sort((a, b) => b.buildable_pct - a.buildable_pct);
  selected.push(...seeds.slice(0, PER_TERRAIN));
}

selected.sort((a, b) => a.seed - b.seed);
console.log(JSON.stringify(selected.slice(0, TOTAL_CAP), null, 2));
