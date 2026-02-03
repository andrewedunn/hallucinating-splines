// ABOUTME: City action endpoints — place tools and advance time.
// ABOUTME: Forwards requests to the city's Durable Object and syncs stats to D1.

import { Hono } from 'hono';
import { authMiddleware } from '../auth';
import { errorResponse } from '../errors';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace };
type Variables = { keyId: string };

const actions = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper: verify city ownership and active status
async function verifyCityOwner(c: any, cityId: string): Promise<boolean> {
  const row = await c.env.DB.prepare(
    "SELECT api_key_id, status FROM cities WHERE id = ?"
  ).bind(cityId).first<{ api_key_id: string; status: string }>();

  if (!row) return false;
  if (row.status !== 'active') return false;
  if (row.api_key_id !== c.get('keyId')) return false;
  return true;
}

// Helper: sync stats from DO to D1
async function syncStats(
  db: D1Database, cityId: string,
  stats: { year?: number; population?: number; funds?: number; score?: number }
): Promise<void> {
  await db.prepare(
    `UPDATE cities SET game_year = ?, population = ?, funds = ?, score = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(stats.year, stats.population, stats.funds, stats.score ?? 0, cityId).run();
}

// Map PRD action names to engine tool names
const TOOL_MAP: Record<string, string> = {
  zone_residential: 'residential',
  zone_commercial: 'commercial',
  zone_industrial: 'industrial',
  build_road: 'road',
  build_rail: 'rail',
  build_power_line: 'wire',
  build_park: 'park',
  build_fire_station: 'fire',
  build_police_station: 'police',
  build_coal_power: 'coal',
  build_nuclear_power: 'nuclear',
  build_seaport: 'port',
  build_airport: 'airport',
  build_stadium: 'stadium',
  bulldoze: 'bulldozer',
};

// POST /v1/cities/:id/actions — Place a tool
actions.post('/:id/actions', authMiddleware, async (c) => {
  const cityId = c.req.param('id');

  if (!await verifyCityOwner(c, cityId)) {
    return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
  }

  const body = await c.req.json();
  const { action, x, y } = body;

  if (typeof action !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
    return errorResponse(c, 400, 'bad_request', 'Missing action, x, or y');
  }

  const toolName = TOOL_MAP[action];
  if (!toolName) {
    return errorResponse(c, 400, 'bad_request', `Unknown action: ${action}`);
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const result = await stub.placeToolAction(toolName, x, y);

  // Sync stats to D1 (fire and forget)
  if (result.success && result.stats) {
    c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, result.stats));
  }

  return c.json({
    success: result.success,
    cost: result.cost,
    funds_remaining: result.stats?.funds,
  });
});

// POST /v1/cities/:id/advance — Advance time
actions.post('/:id/advance', authMiddleware, async (c) => {
  const cityId = c.req.param('id');

  if (!await verifyCityOwner(c, cityId)) {
    return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
  }

  const body = await c.req.json();
  const months = typeof body.months === 'number' ? body.months : 1;

  if (months < 1 || months > 24) {
    return errorResponse(c, 400, 'bad_request', 'months must be between 1 and 24');
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const result = await stub.advance(months);

  // Sync year/population/funds to D1 (advance doesn't return score)
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `UPDATE cities SET game_year = ?, population = ?, funds = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(result.year, result.population, result.funds, cityId).run()
  );

  return c.json(result);
});

export { actions };
