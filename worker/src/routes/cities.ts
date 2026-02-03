// ABOUTME: City CRUD endpoints — create, list, get, delete.
// ABOUTME: Creates Durable Objects for new cities, queries D1 for listings.

import { Hono } from 'hono';
import { authMiddleware } from '../auth';
import { generateCityName } from '../names';
import { errorResponse } from '../errors';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace };
type Variables = { keyId: string; mayorName: string };

const cities = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function generateCityId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `city_${hex}`;
}

// POST /v1/cities — Create a new city
cities.post('/', authMiddleware, async (c) => {
  const keyId = c.get('keyId');

  // Check active city count
  const countResult = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM cities WHERE api_key_id = ? AND status = 'active'"
  ).bind(keyId).first<{ count: number }>();

  if (countResult && countResult.count >= 5) {
    return errorResponse(c, 400, 'limit_reached', 'Maximum 5 active cities per API key');
  }

  const body = await c.req.json().catch(() => ({}));
  const seed = typeof body.seed === 'number' ? body.seed : Math.floor(Math.random() * 100000);

  const cityId = generateCityId();
  const cityName = generateCityName(cityId);

  // Create Durable Object and init game
  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const initStats = await stub.init(cityId, seed);

  // Insert city row in D1
  await c.env.DB.prepare(
    `INSERT INTO cities (id, api_key_id, name, seed, game_year, population, funds, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cityId, keyId, cityName, seed,
    initStats.year, initStats.population, initStats.funds, initStats.score
  ).run();

  return c.json({
    id: cityId,
    name: cityName,
    seed,
    game_year: initStats.year,
    funds: initStats.funds,
    population: initStats.population,
    demand: initStats.demand,
  }, 201);
});

// GET /v1/cities — List cities (public)
cities.get('/', async (c) => {
  const sort = c.req.query('sort') || 'newest';
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
  const offset = parseInt(c.req.query('offset') || '0');

  let orderBy: string;
  switch (sort) {
    case 'population': orderBy = 'c.population DESC'; break;
    case 'score': orderBy = 'c.score DESC'; break;
    default: orderBy = 'c.created_at DESC'; break;
  }

  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, k.mayor_name as mayor, c.population, c.game_year, c.score, c.status, c.seed
     FROM cities c JOIN api_keys k ON c.api_key_id = k.id
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  const total = await c.env.DB.prepare('SELECT COUNT(*) as count FROM cities').first<{ count: number }>();

  return c.json({
    cities: rows.results,
    total: total?.count || 0,
  });
});

// GET /v1/cities/:id — Get city summary (public)
cities.get('/:id', async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT c.*, k.mayor_name as mayor
     FROM cities c JOIN api_keys k ON c.api_key_id = k.id
     WHERE c.id = ?`
  ).bind(cityId).first();

  if (!row) {
    return errorResponse(c, 404, 'not_found', 'City not found');
  }

  return c.json(row);
});

// DELETE /v1/cities/:id — Delete city (owner only)
cities.delete('/:id', authMiddleware, async (c) => {
  const cityId = c.req.param('id');
  const keyId = c.get('keyId');

  const row = await c.env.DB.prepare(
    'SELECT api_key_id FROM cities WHERE id = ?'
  ).bind(cityId).first<{ api_key_id: string }>();

  if (!row) {
    return errorResponse(c, 404, 'not_found', 'City not found');
  }

  if (row.api_key_id !== keyId) {
    return errorResponse(c, 403, 'forbidden', 'You do not own this city');
  }

  // Delete from DO
  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  await stub.deleteCity();

  // Mark as ended in D1
  await c.env.DB.prepare(
    "UPDATE cities SET status = 'ended', updated_at = datetime('now') WHERE id = ?"
  ).bind(cityId).run();

  return c.json({ deleted: true });
});

export { cities };
