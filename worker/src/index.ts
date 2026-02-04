// ABOUTME: Worker entry point. Routes requests via OpenAPIHono.
// ABOUTME: Stateless — delegates city operations to Durable Objects.

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { apiReference } from '@scalar/hono-api-reference';
import { keys } from './routes/keys';
import { seeds } from './routes/seeds';
import { cities } from './routes/cities';
import { actions } from './routes/actions';
import { docs } from './routes/docs';
import { errorResponse } from './errors';
import { ErrorSchema, LeaderboardSchema, MayorProfileSchema, MayorIdParam } from './schemas';
import { generateCitySlug, generateMayorSlug } from './names';

type Bindings = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
  SNAPSHOTS: R2Bucket;
};

const app = new OpenAPIHono<{ Bindings: Bindings }>();

app.use('*', cors());

// --- Inline routes ---

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Health check',
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ status: z.string() }) } },
      description: 'API is healthy',
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: 'ok' }, 200));

// Mount sub-routers
app.route('/v1/keys', keys);
app.route('/v1/seeds', seeds);
app.route('/v1/docs', docs);
app.route('/v1/cities', cities);
app.route('/v1/cities', actions);

// --- Leaderboard ---

const leaderboardRoute = createRoute({
  method: 'get',
  path: '/v1/leaderboard',
  tags: ['Leaderboard'],
  summary: 'Get leaderboard',
  description: 'Returns top cities by population and score, and top mayors by best population and total cities.',
  responses: {
    200: {
      content: { 'application/json': { schema: LeaderboardSchema } },
      description: 'Leaderboard data',
    },
  },
});

app.openapi(leaderboardRoute, async (c) => {
  const limit = 50;

  const [byPop, byScore, mayorPop, mayorCities] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.id, c.name, k.mayor_name as mayor, c.population, c.game_year, c.score
       FROM cities c JOIN api_keys k ON c.api_key_id = k.id
       WHERE c.status = 'active' ORDER BY c.population DESC LIMIT ?`
    ).bind(limit).all(),
    c.env.DB.prepare(
      `SELECT c.id, c.name, k.mayor_name as mayor, c.population, c.game_year, c.score
       FROM cities c JOIN api_keys k ON c.api_key_id = k.id
       WHERE c.status = 'active' ORDER BY c.score DESC LIMIT ?`
    ).bind(limit).all(),
    c.env.DB.prepare(
      `SELECT k.id, k.mayor_name as name, MAX(c.population) as best_population
       FROM api_keys k JOIN cities c ON c.api_key_id = k.id
       GROUP BY k.id ORDER BY best_population DESC LIMIT ?`
    ).bind(limit).all(),
    c.env.DB.prepare(
      `SELECT k.id, k.mayor_name as name, COUNT(c.id) as total_cities
       FROM api_keys k JOIN cities c ON c.api_key_id = k.id
       GROUP BY k.id ORDER BY total_cities DESC LIMIT ?`
    ).bind(limit).all(),
  ]);

  const addCitySlugs = (rows: any[]) => rows.map((r: any) => ({
    ...r,
    slug: generateCitySlug(r.id, r.name),
  }));
  const addMayorSlugs = (rows: any[]) => rows.map((r: any) => ({
    ...r,
    slug: generateMayorSlug(r.id, r.name),
  }));

  return c.json({
    cities: {
      by_population: addCitySlugs(byPop.results),
      by_score: addCitySlugs(byScore.results),
    },
    mayors: {
      by_best_population: addMayorSlugs(mayorPop.results),
      by_total_cities: addMayorSlugs(mayorCities.results),
    },
  }, 200);
});

// --- Mayor resolve ---

const mayorResolveRoute = createRoute({
  method: 'get',
  path: '/v1/mayors/resolve/{code}',
  tags: ['Mayors'],
  summary: 'Resolve mayor by short code',
  description: 'Looks up a mayor by the 4-character short code from their slug URL.',
  request: {
    params: z.object({ code: z.string().regex(/^[0-9a-f]{4}$/).openapi({
      param: { name: 'code', in: 'path' },
      example: '1a2b',
    }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MayorProfileSchema } },
      description: 'Mayor profile',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Mayor not found',
    },
  },
});

app.openapi(mayorResolveRoute, async (c) => {
  const code = c.req.param('code');
  const mayor = await c.env.DB.prepare(
    'SELECT id, mayor_name, created_at FROM api_keys WHERE id LIKE ? LIMIT 1'
  ).bind(`key_${code}%`).first();
  if (!mayor) return errorResponse(c, 404, 'not_found', 'Mayor not found');

  const keyId = mayor.id as string;
  const citiesResult = await c.env.DB.prepare(
    `SELECT id, name, population, game_year, score, status, seed, updated_at
     FROM cities WHERE api_key_id = ? ORDER BY created_at DESC`
  ).bind(keyId).all();

  const stats = await c.env.DB.prepare(
    `SELECT COUNT(*) as total_cities, MAX(population) as best_population, MAX(score) as best_score
     FROM cities WHERE api_key_id = ?`
  ).bind(keyId).first<{ total_cities: number; best_population: number; best_score: number }>();

  const citiesWithSlugs = citiesResult.results.map((r: any) => ({
    ...r,
    slug: generateCitySlug(r.id, r.name),
  }));

  return c.json({
    id: mayor.id,
    name: mayor.mayor_name,
    slug: generateMayorSlug(keyId, mayor.mayor_name as string),
    created_at: mayor.created_at,
    stats: stats || { total_cities: 0, best_population: 0, best_score: 0 },
    cities: citiesWithSlugs,
  }, 200);
});

// --- Mayor profile ---

const mayorRoute = createRoute({
  method: 'get',
  path: '/v1/mayors/{id}',
  tags: ['Mayors'],
  summary: 'Get mayor profile',
  description: 'Returns mayor info, stats, and city history.',
  request: {
    params: z.object({ id: MayorIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MayorProfileSchema } },
      description: 'Mayor profile',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Mayor not found',
    },
  },
});

app.openapi(mayorRoute, async (c) => {
  const keyId = c.req.param('id');
  const mayor = await c.env.DB.prepare(
    'SELECT id, mayor_name, created_at FROM api_keys WHERE id = ?'
  ).bind(keyId).first();
  if (!mayor) return errorResponse(c, 404, 'not_found', 'Mayor not found');

  const citiesResult = await c.env.DB.prepare(
    `SELECT id, name, population, game_year, score, status, seed, updated_at, api_key_id as mayor_id
     FROM cities WHERE api_key_id = ? ORDER BY created_at DESC`
  ).bind(keyId).all();

  const stats = await c.env.DB.prepare(
    `SELECT COUNT(*) as total_cities, MAX(population) as best_population, MAX(score) as best_score
     FROM cities WHERE api_key_id = ?`
  ).bind(keyId).first<{ total_cities: number; best_population: number; best_score: number }>();

  const citiesWithSlugs = citiesResult.results.map((r: any) => ({
    ...r,
    slug: generateCitySlug(r.id, r.name),
  }));

  return c.json({
    id: mayor.id,
    name: mayor.mayor_name,
    slug: generateMayorSlug(mayor.id as string, mayor.mayor_name as string),
    created_at: mayor.created_at,
    stats: stats || { total_cities: 0, best_population: 0, best_score: 0 },
    cities: citiesWithSlugs,
  }, 200);
});

// --- OpenAPI spec + Scalar docs ---

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'Hallucinating Splines API',
    version: '1.0.0',
    description: 'A headless city simulator for AI agents. Build and manage cities through REST API calls, powered by the open-source Micropolis engine (SimCity).',
  },
  servers: [
    { url: 'https://api.hallucinatingsplines.com', description: 'Production' },
  ],
  security: [],
  tags: [
    { name: 'Keys', description: 'API key management' },
    { name: 'Seeds', description: 'Map seed discovery' },
    { name: 'Cities', description: 'City CRUD and data' },
    { name: 'Actions', description: 'City actions — build, budget, advance' },
    { name: 'Leaderboard', description: 'Rankings and competition' },
    { name: 'Mayors', description: 'Mayor profiles' },
    { name: 'System', description: 'Health and status' },
  ],
});

app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'API Key',
  description: 'API key with hs_ prefix. Create one via POST /v1/keys.',
});

app.get('/reference', apiReference({
  spec: { url: '/openapi.json' },
  theme: 'purple',
}));

app.all('*', (c) => errorResponse(c, 404, 'not_found'));

export { CityDO } from './cityDO';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: { DB: D1Database }, ctx: ExecutionContext) {
    // End inactive cities (no updates in 14 days)
    await env.DB.prepare(
      `UPDATE cities SET status = 'ended', ended_reason = 'inactivity'
       WHERE status = 'active' AND updated_at < datetime('now', '-14 days')`
    ).run();

    // Deactivate keys never used after 7 days
    await env.DB.prepare(
      `UPDATE api_keys SET active = 0
       WHERE active = 1 AND last_used IS NULL AND created_at < datetime('now', '-7 days')`
    ).run();

    // Deactivate keys unused for 14 days
    await env.DB.prepare(
      `UPDATE api_keys SET active = 0
       WHERE active = 1 AND last_used IS NOT NULL AND last_used < datetime('now', '-14 days')`
    ).run();

    // End active cities belonging to deactivated keys
    await env.DB.prepare(
      `UPDATE cities SET status = 'ended', ended_reason = 'key_expired'
       WHERE status = 'active' AND api_key_id IN (SELECT id FROM api_keys WHERE active = 0)`
    ).run();
  },
};
