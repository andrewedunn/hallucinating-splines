// ABOUTME: GET /v1/seeds endpoint returning curated map seeds with terrain metadata.
// ABOUTME: Seeds analyzed offline by scripts/curate-seeds.ts.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { SeedsResponseSchema } from '../schemas';
import seedData from '../seedData.json';

const seeds = new OpenAPIHono();

const getSeedsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Seeds'],
  summary: 'List curated map seeds',
  description: 'Returns a list of curated map seeds with terrain metadata. Use a seed when creating a city for a specific map layout.',
  responses: {
    200: {
      content: { 'application/json': { schema: SeedsResponseSchema } },
      description: 'List of curated seeds',
    },
  },
});

seeds.openapi(getSeedsRoute, (c) => {
  return c.json({ seeds: seedData, total: seedData.length }, 200);
});

export { seeds };
