// ABOUTME: City CRUD endpoints — create, list, get, delete.
// ABOUTME: Creates Durable Objects for new cities, queries D1 for listings.

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware, hashKey } from '../auth';
import { generateCityName, generateCitySlug, generateMayorSlug } from '../names';
import { errorResponse } from '../errors';
import {
  CityIdParam, ErrorSchema, CityListSchema, CreateCityBodySchema,
  CreateCityResponseSchema, RetireCityResponseSchema, CityListQuerySchema,
  PaginationQuerySchema, BuildableQuerySchema, RegionQuerySchema, SnapshotYearParam,
} from '../schemas';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace; SNAPSHOTS: R2Bucket };
type Variables = { keyId: string; mayorName: string };

const cities = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

function generateCityId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `city_${hex}`;
}

// --- POST /v1/cities ---

const createCityRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Cities'],
  summary: 'Create a new city',
  description: 'Creates a new city with optional seed. Max 5 active cities per API key.',
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateCityBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: CreateCityResponseSchema } },
      description: 'City created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Limit reached',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unauthorized',
    },
  },
});

cities.openapi(createCityRoute, async (c) => {
  // Auth middleware runs via .use() below — but for openapi routes we call it manually
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

  const keyId = c.get('keyId');

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

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const initStats = await stub.init(cityId, seed);

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

// --- GET /v1/cities ---

const listCitiesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Cities'],
  summary: 'List cities',
  description: 'Returns a paginated list of all cities, sortable by newest, active, population, or score.',
  request: {
    query: CityListQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CityListSchema } },
      description: 'City list',
    },
  },
});

cities.openapi(listCitiesRoute, async (c) => {
  const sort = c.req.query('sort') || 'newest';
  const status = c.req.query('status') || 'all';
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
  const offset = parseInt(c.req.query('offset') || '0');
  const mine = c.req.query('mine') === 'true';

  // If ?mine=true, try to resolve the API key to filter by owner
  let keyId: string | null = null;
  if (mine) {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const key = authHeader.slice(7);
      const hash = await hashKey(key);
      const result = await c.env.DB.prepare(
        'SELECT id FROM api_keys WHERE key_hash = ? AND active = 1'
      ).bind(hash).first<{ id: string }>();
      if (result) keyId = result.id;
    }
    if (!keyId) {
      return c.json({ cities: [], total: 0 }, 200);
    }
  }

  let orderBy: string;
  switch (sort) {
    case 'population': orderBy = 'c.population DESC'; break;
    case 'score': orderBy = 'c.score DESC'; break;
    case 'active': orderBy = 'c.updated_at DESC'; break;
    default: orderBy = 'c.created_at DESC'; break;
  }

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  // Always exclude cities whose game data was wiped (legacy retirements)
  conditions.push("COALESCE(c.ended_reason, '') != 'data_wiped'");

  if (keyId) {
    conditions.push('c.api_key_id = ?');
    bindings.push(keyId);
  }
  if (status === 'active' || status === 'ended') {
    conditions.push('c.status = ?');
    bindings.push(status);
  }

  // For "active" sort, exclude cities that haven't progressed past initial state
  if (sort === 'active') {
    conditions.push('c.game_year > 1900');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  bindings.push(limit, offset);

  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, k.mayor_name as mayor, k.id as mayor_id, c.population, c.game_year, c.score, c.funds, c.status, c.seed, c.updated_at
     FROM cities c JOIN api_keys k ON c.api_key_id = k.id
     ${whereClause}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...bindings).all();

  const countConditions = [...conditions];
  const countBindings = bindings.slice(0, -2);
  const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';
  const totalQuery = c.env.DB.prepare(`SELECT COUNT(*) as count FROM cities c ${countWhere}`);
  const total = countBindings.length > 0
    ? await totalQuery.bind(...countBindings).first<{ count: number }>()
    : await totalQuery.first<{ count: number }>();

  const citiesWithSlugs = rows.results.map((row: any) => ({
    ...row,
    slug: generateCitySlug(row.id, row.name),
    mayor_slug: row.mayor_id ? generateMayorSlug(row.mayor_id, row.mayor) : undefined,
  }));

  return c.json({
    cities: citiesWithSlugs,
    total: total?.count || 0,
  }, 200);
});

// --- GET /v1/cities/:id/stats ---

const getCityStatsRoute = createRoute({
  method: 'get',
  path: '/{id}/stats',
  tags: ['Cities'],
  summary: 'Get live city stats',
  description: 'Returns live stats from the Durable Object (population, funds, demand, etc.).',
  request: {
    params: z.object({ id: CityIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Live city stats',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getCityStatsRoute, async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  try {
    const stats = await stub.getStats();
    return c.json(stats, 200);
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }
});

// --- GET /v1/cities/:id/map ---

const getCityMapRoute = createRoute({
  method: 'get',
  path: '/{id}/map',
  tags: ['Cities'],
  summary: 'Get full tile map',
  description: 'Returns the complete 120x100 tile map as a flat array.',
  request: {
    params: z.object({ id: CityIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Full tile map data',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getCityMapRoute, async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  try {
    const mapData = await stub.getMapData();
    return c.json(mapData, 200);
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }
});

// --- GET /v1/cities/:id/map/image ---

const getMapImageRoute = createRoute({
  method: 'get',
  path: '/{id}/map/image',
  tags: ['Cities'],
  summary: 'Get map as PNG image',
  description: 'Returns the city map as a colored-pixel PNG. Each tile = 1 pixel, scaled up by scale factor.',
  request: {
    params: z.object({ id: CityIdParam }),
    query: z.object({
      scale: z.string().optional().default('1'),
    }),
  },
  responses: {
    200: {
      content: { 'image/png': { schema: z.any() } },
      description: 'PNG image',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getMapImageRoute, async (c) => {
  const cityId = c.req.param('id');
  const scale = Math.min(Math.max(parseInt(c.req.query('scale') || '1'), 1), 8);

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  let mapData: any;
  try {
    mapData = await stub.getMapData();
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }

  const { generateMapImage } = await import('../mapImage');
  const png = await generateMapImage(mapData.tiles, mapData.width, mapData.height, scale);

  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60',
    },
  });
});

// --- GET /v1/cities/:id/map/summary ---

const getMapSummaryRoute = createRoute({
  method: 'get',
  path: '/{id}/map/summary',
  tags: ['Cities'],
  summary: 'Get semantic map analysis',
  description: 'Returns zone counts, power coverage, and other high-level map metrics.',
  request: {
    params: z.object({ id: CityIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Semantic map analysis',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getMapSummaryRoute, async (c) => {
  const cityId = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');
  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  try {
    const summary = await stub.getMapSummary();
    return c.json(summary, 200);
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }
});

// --- GET /v1/cities/:id/map/buildable ---

const getBuildableRoute = createRoute({
  method: 'get',
  path: '/{id}/map/buildable',
  tags: ['Cities'],
  summary: 'Get buildable positions',
  description: 'Returns valid placement positions for a given action type.',
  request: {
    params: z.object({ id: CityIdParam }),
    query: BuildableQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Buildable positions',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad request',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getBuildableRoute, async (c) => {
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
  try {
    const result = await stub.getBuildablePositions(toolName);
    return c.json({ action, ...result }, 200);
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }
});

// --- GET /v1/cities/:id/map/region ---

const getMapRegionRoute = createRoute({
  method: 'get',
  path: '/{id}/map/region',
  tags: ['Cities'],
  summary: 'Get tile subregion',
  description: 'Returns a rectangular subregion of the map. Max 40x40 tiles.',
  request: {
    params: z.object({ id: CityIdParam }),
    query: RegionQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Tile subregion data',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getMapRegionRoute, async (c) => {
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
  try {
    const region = await stub.getMapRegion(x, y, w, h);
    return c.json(region, 200);
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }
});

// --- GET /v1/cities/:id/demand ---

const getDemandRoute = createRoute({
  method: 'get',
  path: '/{id}/demand',
  tags: ['Cities'],
  summary: 'Get RCI demand',
  description: 'Returns residential, commercial, and industrial demand values. Positive means the city wants more of that zone type.',
  request: {
    params: z.object({ id: CityIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'RCI demand data',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getDemandRoute, async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  try {
    const demand = await stub.getDemandData();
    return c.json(demand, 200);
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }
});

// --- GET /v1/cities/:id/snapshots ---

const listSnapshotsRoute = createRoute({
  method: 'get',
  path: '/{id}/snapshots',
  tags: ['Cities'],
  summary: 'List snapshots',
  description: 'Returns a paginated list of city snapshots (one per game year).',
  request: {
    params: z.object({ id: CityIdParam }),
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Snapshot list',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(listSnapshotsRoute, async (c) => {
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
  }, 200);
});

// --- GET /v1/cities/:id/snapshots/:year ---

const getSnapshotRoute = createRoute({
  method: 'get',
  path: '/{id}/snapshots/{year}',
  tags: ['Cities'],
  summary: 'Get snapshot tile data',
  description: 'Returns tile map data for a specific snapshot year from R2 storage.',
  request: {
    params: z.object({ id: CityIdParam, year: SnapshotYearParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Snapshot tile data',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid year',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Snapshot not found',
    },
  },
});

cities.openapi(getSnapshotRoute, async (c) => {
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
  return c.json(data, 200);
});

// --- GET /v1/cities/:id/history ---

const getHistoryRoute = createRoute({
  method: 'get',
  path: '/{id}/history',
  tags: ['Cities'],
  summary: 'Get census history',
  description: 'Returns population, commercial, industrial, and other census history arrays from the simulation.',
  request: {
    params: z.object({ id: CityIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Census history arrays',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getHistoryRoute, async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  try {
    const history = await stub.getCensusHistory();
    return c.json(history, 200);
  } catch {
    return errorResponse(c, 404, 'no_game_state', 'City game state is no longer available');
  }
});

// --- GET /v1/cities/:id/actions ---

const listActionsRoute = createRoute({
  method: 'get',
  path: '/{id}/actions',
  tags: ['Cities'],
  summary: 'Get action history',
  description: 'Returns a paginated list of actions taken on this city.',
  request: {
    params: z.object({ id: CityIdParam }),
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'Action history',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(listActionsRoute, async (c) => {
  const cityId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const actionsResult = await c.env.DB.prepare(
    `SELECT id, game_year, action_type, params, result, cost, created_at
     FROM actions WHERE city_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(cityId, limit, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM actions WHERE city_id = ?'
  ).bind(cityId).first<{ count: number }>();

  return c.json({
    actions: actionsResult.results.map((a: any) => ({
      ...a,
      params: JSON.parse(a.params),
    })),
    total: total?.count || 0,
  }, 200);
});

// --- GET /v1/cities/resolve/:code ---

const resolveCityRoute = createRoute({
  method: 'get',
  path: '/resolve/{code}',
  tags: ['Cities'],
  summary: 'Resolve city by short code',
  description: 'Looks up a city by the 4-character short code from its slug URL.',
  request: {
    params: z.object({ code: z.string().regex(/^[0-9a-f]{4}$/).openapi({
      param: { name: 'code', in: 'path' },
      example: 'a1b2',
    }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'City summary',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(resolveCityRoute, async (c) => {
  const code = c.req.param('code');

  const row = await c.env.DB.prepare(
    `SELECT c.*, k.mayor_name as mayor, k.id as mayor_id
     FROM cities c JOIN api_keys k ON c.api_key_id = k.id
     WHERE c.id LIKE ?
     ORDER BY c.created_at DESC LIMIT 1`
  ).bind(`city_${code}%`).first<any>();

  if (!row) {
    return errorResponse(c, 404, 'not_found', 'City not found');
  }

  return c.json({
    ...row,
    slug: generateCitySlug(row.id, row.name),
    mayor_slug: generateMayorSlug(row.mayor_id, row.mayor),
  }, 200);
});

// --- GET /v1/cities/:id ---

const getCityRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Cities'],
  summary: 'Get city summary',
  description: 'Returns city metadata including name, mayor, population, score, status, and seed.',
  request: {
    params: z.object({ id: CityIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.any() } },
      description: 'City summary',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(getCityRoute, async (c) => {
  const cityId = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT c.*, k.mayor_name as mayor, k.id as mayor_id
     FROM cities c JOIN api_keys k ON c.api_key_id = k.id
     WHERE c.id = ?`
  ).bind(cityId).first<any>();

  if (!row) {
    return errorResponse(c, 404, 'not_found', 'City not found');
  }

  return c.json({
    ...row,
    slug: generateCitySlug(row.id, row.name),
    mayor_slug: generateMayorSlug(row.mayor_id, row.mayor),
  }, 200);
});

// --- DELETE /v1/cities/:id ---

const deleteCityRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Cities'],
  summary: 'Retire a city',
  description: 'Retires an active city you own. History is preserved. This action cannot be undone.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: CityIdParam }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RetireCityResponseSchema } },
      description: 'City retired',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City already ended',
    },
    401: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Unauthorized',
    },
    403: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not your city',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'City not found',
    },
  },
});

cities.openapi(deleteCityRoute, async (c) => {
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

  const cityId = c.req.param('id');
  const keyId = c.get('keyId');

  const row = await c.env.DB.prepare(
    'SELECT api_key_id, status FROM cities WHERE id = ?'
  ).bind(cityId).first<{ api_key_id: string; status: string }>();

  if (!row) {
    return errorResponse(c, 404, 'not_found', 'City not found');
  }

  if (row.api_key_id !== keyId) {
    return errorResponse(c, 403, 'forbidden', 'You do not own this city');
  }

  if (row.status !== 'active') {
    return errorResponse(c, 400, 'bad_request', 'City is already ended');
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  await stub.deleteCity();

  await c.env.DB.prepare(
    "UPDATE cities SET status = 'ended', ended_reason = 'retired', updated_at = datetime('now') WHERE id = ?"
  ).bind(cityId).run();

  return c.json({ retired: true, message: 'City retired. History preserved.' }, 200);
});

export { cities };
