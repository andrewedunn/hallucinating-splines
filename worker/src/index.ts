// ABOUTME: Worker entry point. Routes requests via Hono.
// ABOUTME: Stateless — delegates city operations to Durable Objects.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { keys } from './routes/keys';
import { seeds } from './routes/seeds';
import { cities } from './routes/cities';
import { actions } from './routes/actions';
import { errorResponse } from './errors';

type Bindings = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
  SNAPSHOTS: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/v1/keys', keys);
app.route('/v1/seeds', seeds);
app.route('/v1/cities', cities);
app.route('/v1/cities', actions);

app.get('/v1/leaderboard', async (c) => {
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

  return c.json({
    cities: {
      by_population: byPop.results,
      by_score: byScore.results,
    },
    mayors: {
      by_best_population: mayorPop.results,
      by_total_cities: mayorCities.results,
    },
  });
});

app.get('/v1/mayors/:id', async (c) => {
  const keyId = c.req.param('id');
  const mayor = await c.env.DB.prepare(
    'SELECT id, mayor_name, created_at FROM api_keys WHERE id = ?'
  ).bind(keyId).first();
  if (!mayor) return errorResponse(c, 404, 'not_found', 'Mayor not found');

  const citiesResult = await c.env.DB.prepare(
    `SELECT id, name, population, game_year, score, status, seed
     FROM cities WHERE api_key_id = ? ORDER BY created_at DESC`
  ).bind(keyId).all();

  const stats = await c.env.DB.prepare(
    `SELECT COUNT(*) as total_cities, MAX(population) as best_population, MAX(score) as best_score
     FROM cities WHERE api_key_id = ?`
  ).bind(keyId).first<{ total_cities: number; best_population: number; best_score: number }>();

  return c.json({
    id: mayor.id,
    name: mayor.mayor_name,
    created_at: mayor.created_at,
    stats: stats || { total_cities: 0, best_population: 0, best_score: 0 },
    cities: citiesResult.results,
  });
});

app.all('*', (c) => errorResponse(c, 404, 'not_found', 'Endpoint not found'));

export { CityDO } from './cityDO';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: { DB: D1Database }, ctx: ExecutionContext) {
    await env.DB.prepare(
      `UPDATE cities SET status = 'ended'
       WHERE status = 'active' AND updated_at < datetime('now', '-14 days')`
    ).run();
  },
};
