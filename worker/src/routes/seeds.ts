// ABOUTME: GET /v1/seeds endpoint returning curated map seeds with terrain metadata.
// ABOUTME: Seeds analyzed offline by scripts/curate-seeds.ts.

import { Hono } from 'hono';
import seedData from '../seedData.json';

const seeds = new Hono();

seeds.get('/', (c) => {
  return c.json({ seeds: seedData, total: seedData.length });
});

export { seeds };
