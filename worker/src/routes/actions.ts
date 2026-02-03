// ABOUTME: City action endpoints — place tools and advance time.
// ABOUTME: Forwards requests to the city's Durable Object and syncs stats to D1.

import { Hono } from 'hono';
import { authMiddleware } from '../auth';
import { errorResponse } from '../errors';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace; SNAPSHOTS: R2Bucket };
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

  const auto_bulldoze = body.auto_bulldoze === true;
  const auto_power = body.auto_power === true;
  const auto_road = body.auto_road === true;
  const useAuto = auto_bulldoze || auto_power || auto_road;

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const result = useAuto
    ? await stub.placeToolWithAuto(toolName, x, y, { auto_bulldoze, auto_power, auto_road })
    : await stub.placeToolAction(toolName, x, y);

  if (result.error === 'rate_limited') {
    return errorResponse(c, 429, 'rate_limited', result.reason);
  }

  // Sync stats to D1 (fire and forget)
  if (result.success && result.stats) {
    c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, result.stats));
  }

  // Log action to D1 (fire and forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO actions (city_id, game_year, action_type, params, result, cost)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      cityId,
      result.stats?.year || 0,
      action,
      JSON.stringify({ x, y, auto_bulldoze, auto_power, auto_road }),
      result.success ? 'success' : 'failed',
      result.cost || 0
    ).run()
  );

  const response: any = {
    success: result.success,
    cost: result.cost,
    funds_remaining: result.stats?.funds,
  };
  if (result.auto_actions) {
    response.auto_actions = result.auto_actions;
  }

  return c.json(response);
});

// POST /v1/cities/:id/budget — Update budget settings
actions.post('/:id/budget', authMiddleware, async (c) => {
  const cityId = c.req.param('id');

  if (!await verifyCityOwner(c, cityId)) {
    return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
  }

  const body = await c.req.json();
  const { tax_rate, fire_percent, police_percent, road_percent } = body;

  // Validate ranges
  if (tax_rate !== undefined && (typeof tax_rate !== 'number' || tax_rate < 0 || tax_rate > 20)) {
    return errorResponse(c, 400, 'bad_request', 'tax_rate must be 0-20');
  }
  if (fire_percent !== undefined && (typeof fire_percent !== 'number' || fire_percent < 0 || fire_percent > 100)) {
    return errorResponse(c, 400, 'bad_request', 'fire_percent must be 0-100');
  }
  if (police_percent !== undefined && (typeof police_percent !== 'number' || police_percent < 0 || police_percent > 100)) {
    return errorResponse(c, 400, 'bad_request', 'police_percent must be 0-100');
  }
  if (road_percent !== undefined && (typeof road_percent !== 'number' || road_percent < 0 || road_percent > 100)) {
    return errorResponse(c, 400, 'bad_request', 'road_percent must be 0-100');
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const stats = await stub.setBudgetSettings({
    taxRate: tax_rate,
    fire: fire_percent,
    police: police_percent,
    road: road_percent,
  });

  // Log action
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO actions (city_id, game_year, action_type, params, result, cost)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      cityId,
      stats?.year || 0,
      'set_budget',
      JSON.stringify({ tax_rate, fire_percent, police_percent, road_percent }),
      'success',
      0
    ).run()
  );

  // Sync stats
  if (stats) {
    c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, stats));
  }

  return c.json({
    success: true,
    budget: stats?.budget,
    funds: stats?.funds,
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

  if (result.error === 'rate_limited') {
    return errorResponse(c, 429, 'rate_limited', result.reason);
  }

  // Sync year/population/funds to D1 (advance doesn't return score)
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `UPDATE cities SET game_year = ?, population = ?, funds = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(result.year, result.population, result.funds, cityId).run()
  );

  // Log advance action to D1 (fire and forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO actions (city_id, game_year, action_type, params, result, cost)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(cityId, result.year, 'advance', JSON.stringify({ months }), 'success', 0).run()
  );

  // Save snapshot to R2 and metadata to D1 (fire and forget)
  c.executionCtx.waitUntil((async () => {
    const snapshot = await stub.getSnapshotData();
    const r2Key = `snapshots/${cityId}/${snapshot.game_year}.json`;
    await c.env.SNAPSHOTS.put(r2Key, JSON.stringify(snapshot));
    await c.env.DB.prepare(
      `INSERT INTO snapshots (city_id, game_year, r2_key, population, funds) VALUES (?, ?, ?, ?, ?)`
    ).bind(cityId, snapshot.game_year, r2Key, snapshot.population, snapshot.funds).run();
  })());

  // End city on bankruptcy
  if (result.city_ended) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        "UPDATE cities SET status = 'ended', updated_at = datetime('now') WHERE id = ?"
      ).bind(cityId).run()
    );
  }

  return c.json(result);
});

export { actions };
