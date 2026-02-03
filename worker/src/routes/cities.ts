// ABOUTME: City CRUD endpoints — create, list, get, delete.
// ABOUTME: Creates Durable Objects for new cities, queries D1 for listings.

import { Hono } from 'hono';
import { authMiddleware } from '../auth';
import { generateCityName } from '../names';
import { errorResponse } from '../errors';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace; SNAPSHOTS: R2Bucket };
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

// GET /v1/cities/:id/stats — Live stats from DO
cities.get('/:id/stats', async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const stats = await stub.getStats();
  return c.json(stats);
});

// GET /v1/cities/:id/map — Full tile map
cities.get('/:id/map', async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const mapData = await stub.getMapData();
  return c.json(mapData);
});

// GET /v1/cities/:id/map/summary — Semantic map analysis
cities.get('/:id/map/summary', async (c) => {
  const cityId = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');
  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const summary = await stub.getMapSummary();
  return c.json(summary);
});

// GET /v1/cities/:id/map/buildable — Buildability mask
cities.get('/:id/map/buildable', async (c) => {
  const cityId = c.req.param('id');
  const action = c.req.query('action');
  if (!action) return errorResponse(c, 400, 'bad_request', 'Missing action query parameter');

  const TOOL_MAP: Record<string, string> = {
    zone_residential: 'residential', zone_commercial: 'commercial', zone_industrial: 'industrial',
    build_road: 'road', build_rail: 'rail', build_power_line: 'wire', build_park: 'park',
    build_fire_station: 'fire', build_police_station: 'police',
    build_coal_power: 'coal', build_nuclear_power: 'nuclear',
    build_seaport: 'port', build_airport: 'airport', build_stadium: 'stadium', bulldoze: 'bulldozer',
  };
  const toolName = TOOL_MAP[action];
  if (!toolName) return errorResponse(c, 400, 'bad_request', `Unknown action: ${action}`);

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const result = await stub.getBuildablePositions(toolName);
  return c.json({ action, ...result });
});

// GET /v1/cities/:id/map/region — Tile subregion
cities.get('/:id/map/region', async (c) => {
  const cityId = c.req.param('id');
  const x = parseInt(c.req.query('x') || '0');
  const y = parseInt(c.req.query('y') || '0');
  const w = Math.min(parseInt(c.req.query('w') || '20'), 40);
  const h = Math.min(parseInt(c.req.query('h') || '20'), 40);

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const region = await stub.getMapRegion(x, y, w, h);
  return c.json(region);
});

// GET /v1/cities/:id/demand — RCI demand
cities.get('/:id/demand', async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const demand = await stub.getDemandData();
  return c.json(demand);
});

// GET /v1/cities/:id/snapshots — List snapshots
cities.get('/:id/snapshots', async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const snapshots = await c.env.DB.prepare(
    `SELECT game_year, population, funds, created_at FROM snapshots
     WHERE city_id = ? ORDER BY game_year ASC LIMIT ? OFFSET ?`
  ).bind(cityId, limit, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM snapshots WHERE city_id = ?'
  ).bind(cityId).first<{ count: number }>();

  return c.json({
    snapshots: snapshots.results,
    total: total?.count || 0,
  });
});

// GET /v1/cities/:id/snapshots/:year — Get snapshot tile data from R2
cities.get('/:id/snapshots/:year', async (c) => {
  const cityId = c.req.param('id');
  const year = parseInt(c.req.param('year'));

  if (isNaN(year)) return errorResponse(c, 400, 'bad_request', 'Invalid year');

  const meta = await c.env.DB.prepare(
    'SELECT r2_key FROM snapshots WHERE city_id = ? AND game_year = ?'
  ).bind(cityId, year).first<{ r2_key: string }>();

  if (!meta) return errorResponse(c, 404, 'not_found', 'Snapshot not found');

  const object = await c.env.SNAPSHOTS.get(meta.r2_key);
  if (!object) return errorResponse(c, 404, 'not_found', 'Snapshot data missing');

  const data = await object.json();
  return c.json(data);
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
