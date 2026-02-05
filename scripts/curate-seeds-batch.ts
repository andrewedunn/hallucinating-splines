// ABOUTME: Worker script that analyzes a range of seeds and outputs JSON.
// ABOUTME: Called by curate-seeds.ts to avoid OOM from processing all seeds in one process.

import { HeadlessGame } from '../src/headlessGame';

interface SeedInfo {
  seed: number;
  terrain: string;
  water_pct: number;
  buildable_pct: number;
  description: string;
}

function analyzeSeed(seed: number): SeedInfo {
  const game = HeadlessGame.fromSeed(seed);
  const map = game.getMap();
  const total = map.width * map.height;

  let water = 0, trees = 0, empty = 0;

  for (let i = 0; i < total; i++) {
    const tileId = map.tiles[i] & 0x3FF;
    if (tileId >= 2 && tileId <= 20) water++;
    else if (tileId >= 21 && tileId <= 39) trees++;
    else if (tileId === 0) empty++;
  }

  const waterPct = Math.round((water / total) * 100);
  const buildablePct = Math.round(((empty + trees) / total) * 100);

  let terrain = 'landlocked';
  if (waterPct > 30) terrain = 'island';
  else if (waterPct > 20) terrain = 'coastal';
  else if (waterPct > 10) terrain = 'river_valley';
  else if (waterPct > 5) terrain = 'peninsula';

  const descriptions: Record<string, string> = {
    island: `Island terrain with ${waterPct}% water, challenging build space`,
    coastal: `Coastal map with ${waterPct}% water and natural harbors`,
    river_valley: `River valley with ${waterPct}% water, good balance of land and water`,
    peninsula: `Mostly land with some water features (${waterPct}% water)`,
    landlocked: `Wide open terrain with minimal water (${waterPct}% water)`,
  };

  return { seed, terrain, water_pct: waterPct, buildable_pct: buildablePct, description: descriptions[terrain] };
}

const start = parseInt(process.argv[2]);
const end = parseInt(process.argv[3]);
const candidates: SeedInfo[] = [];

for (let seed = start; seed <= end; seed++) {
  const info = analyzeSeed(seed);
  if (info.buildable_pct >= 40 && info.buildable_pct <= 95) {
    candidates.push(info);
  }
}

console.log(JSON.stringify(candidates));
