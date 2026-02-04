// ABOUTME: City action endpoints — place tools and advance time.
// ABOUTME: Forwards requests to the city's Durable Object and syncs stats to D1.

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../auth';
import { errorResponse } from '../errors';
import {
  CityIdParam, ErrorSchema, PlaceActionBodySchema, PlaceActionResponseSchema,
  BudgetBodySchema, BudgetResponseSchema, AdvanceBodySchema,
} from '../schemas';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace; SNAPSHOTS: R2Bucket };
type Variables = { keyId: string };

const actions = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

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

// Line/rect action names → engine tool names
const LINE_TOOL_MAP: Record<string, string> = {
  build_road_line: 'road',
  build_rail_line: 'rail',
  build_wire_line: 'wire',
};
const RECT_TOOL_MAP: Record<string, string> = {
  build_road_rect: 'road',
  build_rail_rect: 'rail',
  build_wire_rect: 'wire',
};

// --- POST /v1/cities/:id/actions ---

const placeActionRoute = createRoute({
  method: 'post',
  path: '/{id}/actions',
  tags: ['Actions'],
  summary: 'Place a tool',
  description: 'Places a building, zone, or bulldoze action at the given coordinates. Supports auto-infrastructure flags for automatic power, road, and bulldoze.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: CityIdParam }),
    body: { content: { 'application/json': { schema: PlaceActionBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PlaceActionResponseSchema } },
      description: 'Action result',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unauthorized',
    },
    403: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not your city or city not active',
    },
    429: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Rate limited (30 actions/min per city)',
    },
  },
});

actions.openapi(placeActionRoute, async (c) => {
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

  const cityId = c.req.param('id');

  if (!await verifyCityOwner(c, cityId)) {
    return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
  }

  const body = await c.req.json();
  const { action } = body;

  if (typeof action !== 'string') {
    return errorResponse(c, 400, 'bad_request', 'Missing action');
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);

  // Dispatch line actions
  const lineTool = LINE_TOOL_MAP[action];
  if (lineTool) {
    const { x1, y1, x2, y2 } = body;
    if (typeof x1 !== 'number' || typeof y1 !== 'number' || typeof x2 !== 'number' || typeof y2 !== 'number') {
      return errorResponse(c, 400, 'bad_request', 'Line actions need x1, y1, x2, y2');
    }
    const result = await stub.placeLineTool(lineTool, x1, y1, x2, y2);
    if (result.error === 'rate_limited') return errorResponse(c, 429, 'rate_limited', result.reason);
    if (result.stats) c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, result.stats));
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `INSERT INTO actions (city_id, game_year, action_type, params, result, cost) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(cityId, result.stats?.year || 0, action, JSON.stringify({ x1, y1, x2, y2 }), result.success ? 'success' : 'failed', result.cost || 0).run()
    );
    return c.json({ success: result.success, cost: result.cost, tiles_placed: result.tiles_placed, tiles_attempted: result.tiles_attempted, funds_remaining: result.stats?.funds }, 200);
  }

  // Dispatch rect actions
  const rectTool = RECT_TOOL_MAP[action];
  if (rectTool) {
    const { x, y, width, height } = body;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
      return errorResponse(c, 400, 'bad_request', 'Rect actions need x, y, width, height');
    }
    if (width < 1 || width > 120 || height < 1 || height > 100) {
      return errorResponse(c, 400, 'bad_request', 'Width must be 1-120 and height 1-100');
    }
    const result = await stub.placeRectTool(rectTool, x, y, width, height);
    if (result.error === 'rate_limited') return errorResponse(c, 429, 'rate_limited', result.reason);
    if (result.stats) c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, result.stats));
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `INSERT INTO actions (city_id, game_year, action_type, params, result, cost) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(cityId, result.stats?.year || 0, action, JSON.stringify({ x, y, width, height }), result.success ? 'success' : 'failed', result.cost || 0).run()
    );
    return c.json({ success: result.success, cost: result.cost, tiles_placed: result.tiles_placed, tiles_attempted: result.tiles_attempted, funds_remaining: result.stats?.funds }, 200);
  }

  // Standard point-placement actions
  const { x, y } = body;
  if (typeof x !== 'number' || typeof y !== 'number') {
    return errorResponse(c, 400, 'bad_request', 'Missing x or y');
  }

  const toolName = TOOL_MAP[action];
  if (!toolName) {
    return errorResponse(c, 400, 'bad_request', `Unknown action: ${action}`);
  }

  const auto_bulldoze = body.auto_bulldoze === true;
  const auto_power = body.auto_power === true;
  const auto_road = body.auto_road === true;
  const useAuto = auto_bulldoze || auto_power || auto_road;

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
  if (!result.success && result.reason) {
    response.reason = result.reason;
  }
  if (result.auto_actions) {
    response.auto_actions = result.auto_actions;
  }

  return c.json(response, 200);
});

// --- POST /v1/cities/:id/budget ---

const setBudgetRoute = createRoute({
  method: 'post',
  path: '/{id}/budget',
  tags: ['Actions'],
  summary: 'Update budget settings',
  description: 'Sets tax rate and service funding percentages. All fields are optional — only provided values are changed.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: CityIdParam }),
    body: { content: { 'application/json': { schema: BudgetBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BudgetResponseSchema } },
      description: 'Budget updated',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid values',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unauthorized',
    },
    403: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not your city or city not active',
    },
  },
});

actions.openapi(setBudgetRoute, async (c) => {
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

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
  }, 200);
});

// --- POST /v1/cities/:id/advance ---

const advanceRoute = createRoute({
  method: 'post',
  path: '/{id}/advance',
  tags: ['Actions'],
  summary: 'Advance time',
  description: 'Advances the city simulation by 1-24 months. Each month is 64 ticks of the simulation engine. Triggers snapshot creation.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: CityIdParam }),
    body: { content: { 'application/json': { schema: AdvanceBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Advance result with updated stats',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid months value',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unauthorized',
    },
    403: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not your city or city not active',
    },
    429: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Rate limited (10 advances/min per city)',
    },
  },
});

actions.openapi(advanceRoute, async (c) => {
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

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

  // Sync year/population/funds to D1
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
        "UPDATE cities SET status = 'ended', ended_reason = 'bankruptcy', updated_at = datetime('now') WHERE id = ?"
      ).bind(cityId).run()
    );
  }

  return c.json(result, 200);
});

// --- POST /v1/cities/:id/batch ---

const batchRoute = createRoute({
  method: 'post',
  path: '/{id}/batch',
  tags: ['Actions'],
  summary: 'Batch actions',
  description: 'Execute up to 50 actions in a single call. Counts as 1 action for rate limiting. Stops on first failure.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: CityIdParam }),
    body: { content: { 'application/json': { schema: z.object({
      actions: z.array(z.object({
        action: z.string(),
        x: z.number().int(),
        y: z.number().int(),
        auto_bulldoze: z.boolean().optional(),
        auto_power: z.boolean().optional(),
        auto_road: z.boolean().optional(),
      })).min(1).max(50),
    }) } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Batch result',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unauthorized',
    },
    403: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not your city or city not active',
    },
    429: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Rate limited',
    },
  },
});

actions.openapi(batchRoute, async (c) => {
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

  const cityId = c.req.param('id');

  if (!await verifyCityOwner(c, cityId)) {
    return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
  }

  const body = await c.req.json();
  const batchActions = body.actions;

  if (!Array.isArray(batchActions) || batchActions.length === 0 || batchActions.length > 50) {
    return errorResponse(c, 400, 'bad_request', 'actions must be an array of 1-50 items');
  }

  // Validate and map all actions upfront
  const mapped: Array<{ toolName: string; x: number; y: number; flags?: { auto_bulldoze?: boolean; auto_power?: boolean; auto_road?: boolean } }> = [];
  for (const a of batchActions) {
    const toolName = TOOL_MAP[a.action];
    if (!toolName) return errorResponse(c, 400, 'bad_request', `Unknown action: ${a.action}`);
    if (typeof a.x !== 'number' || typeof a.y !== 'number') {
      return errorResponse(c, 400, 'bad_request', 'Each action needs x and y coordinates');
    }
    const flags = (a.auto_bulldoze || a.auto_power || a.auto_road)
      ? { auto_bulldoze: a.auto_bulldoze === true, auto_power: a.auto_power === true, auto_road: a.auto_road === true }
      : undefined;
    mapped.push({ toolName, x: a.x, y: a.y, flags });
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const result = await stub.executeBatch(mapped);

  if (result.error === 'rate_limited') {
    return errorResponse(c, 429, 'rate_limited', result.reason);
  }

  // Sync stats to D1
  if (result.stats) {
    c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, result.stats));
  }

  // Log batch action to D1
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO actions (city_id, game_year, action_type, params, result, cost)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      cityId,
      result.stats?.year || 0,
      'batch',
      JSON.stringify({ count: batchActions.length }),
      result.completed === result.total ? 'success' : 'partial',
      result.total_cost || 0
    ).run()
  );

  return c.json({
    results: result.results,
    total_cost: result.total_cost,
    funds_remaining: result.funds_remaining,
    completed: result.completed,
    total: result.total,
  }, 200);
});

export { actions };
