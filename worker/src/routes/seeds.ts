// ABOUTME: GET /v1/seeds endpoint returning curated map seeds.
// ABOUTME: Hardcoded list for Phase 2a; will be expanded with terrain metadata later.

import { Hono } from 'hono';

const seeds = new Hono();

const SEED_LIST = [
  { seed: 42, terrain: 'river_valley', description: 'Classic river valley with good buildable land' },
  { seed: 99, terrain: 'coastal', description: 'Coastal map with moderate water' },
  { seed: 1337, terrain: 'river_valley', description: 'Wide river with large buildable plateaus' },
  { seed: 2024, terrain: 'landlocked', description: 'Mostly land with small lakes' },
  { seed: 9001, terrain: 'peninsula', description: 'Peninsula with natural harbor' },
];

seeds.get('/', (c) => {
  return c.json({ seeds: SEED_LIST, total: SEED_LIST.length });
});

export { seeds };
