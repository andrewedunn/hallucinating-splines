# Phase 2b + 4: API Enhancements & Public Website Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the API with snapshots, auto-infrastructure, map summary, buildability, leaderboard, action logging, city lifecycle, and rate limiting. Build the public website with canvas tile renderer, history scrubber, and all pages.

**Architecture:** Worker API gets new R2 bucket for snapshots, new D1 tables for snapshots and actions, new modules for auto-infrastructure pathfinding and map analysis. Website is a separate Astro project (`site/`) deployed to Cloudflare Pages, fetching data from the Workers API and rendering tiles client-side on canvas.

**Tech Stack:** Cloudflare Workers, Durable Objects, D1, R2, Hono, Astro, React (for interactive islands), HTML Canvas

**Existing code context:**
- `worker/src/index.ts` — Hono app entry, exports CityDO, mounts routes at /v1/keys, /v1/seeds, /v1/cities (both cities and actions routers)
- `worker/src/cityDO.ts` — DurableObject with RPC methods: init, placeToolAction, advance, getStats, getMapData, getMapRegion, getDemandData, deleteCity
- `worker/src/routes/actions.ts` — POST /:id/actions and POST /:id/advance with TOOL_MAP, verifyCityOwner, syncStats helpers
- `worker/src/routes/cities.ts` — City CRUD + read-only endpoints (stats, map, map/region, demand)
- `worker/src/auth.ts` — hashKey, generateApiKey, generateKeyId, authMiddleware
- `worker/src/names.ts` — generateName, generateMayorName, generateCityName
- `worker/src/errors.ts` — errorResponse helper
- `worker/wrangler.toml` — D1 binding (DB), DO binding (CITY), migration v1
- `worker/migrations/0001_initial.sql` — api_keys and cities tables
- Engine tile values: DIRT=0, RIVER=2, WATER_HIGH=20, TREEBASE=21, WOODS_HIGH=39, RUBBLE=44, ROADBASE=64, LASTROAD=206, POWERBASE=208, LASTPOWER=222, RAILBASE=224, LASTRAIL=238, RESBASE=240, COMBASE=423, INDBASE=612, PORTBASE=693, AIRPORTBASE=709, COALBASE=745, FIRESTBASE=761, POLICESTBASE=770, STADIUMBASE=779, NUCLEARBASE=811, TILE_COUNT=1024
- Engine tile flags: BIT_MASK=0x3FF (lower 10 bits = tile ID), POWERBIT=0x8000, ZONEBIT=0x0400
- Sprite sheet: `_upstream_micropolisjs/images/tiles.png` — 512x512px, 32x32 grid of 16x16 tiles
- HeadlessGame API: fromSeed, fromSave, tick, placeTool, getStats, getMap, getTile, getDemand, save, setTaxRate, setBudget
- Live API: https://hallucinating-splines.andrew-987.workers.dev

---

## Part A: API Enhancements (Tasks 1–11)

### Task 1: D1 Migration + R2 Bucket Setup

**Files:**
- Create: `worker/migrations/0002_snapshots_actions.sql`
- Modify: `worker/wrangler.toml`
- Modify: `worker/src/cityDO.ts` (update Env type)
- Modify: `worker/src/index.ts` (update Bindings type)

**Step 1: Create migration file**

Create `worker/migrations/0002_snapshots_actions.sql`:
```sql
-- Snapshot metadata (tile data stored in R2)
CREATE TABLE snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id    TEXT NOT NULL REFERENCES cities(id),
  game_year  INTEGER NOT NULL,
  r2_key     TEXT NOT NULL,
  population INTEGER,
  funds      INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_snapshots_city ON snapshots(city_id, game_year);

-- Action log
CREATE TABLE actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id     TEXT NOT NULL REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  params      TEXT NOT NULL,
  result      TEXT NOT NULL,
  cost        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_actions_city ON actions(city_id, created_at DESC);
```

**Step 2: Add R2 bucket to wrangler.toml**

Add after the `[[migrations]]` block:
```toml
[[r2_buckets]]
binding = "SNAPSHOTS"
bucket_name = "hallucinating-splines-snapshots"
```

Add a second migration entry:
```toml
[[migrations]]
tag = "v2"
```

**Step 3: Update Env types**

In `worker/src/index.ts`, update Bindings:
```typescript
type Bindings = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
  SNAPSHOTS: R2Bucket;
};
```

In `worker/src/cityDO.ts`, update Env:
```typescript
type Env = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
  SNAPSHOTS: R2Bucket;
};
```

In `worker/src/routes/actions.ts`, update Bindings:
```typescript
type Bindings = { DB: D1Database; CITY: DurableObjectNamespace; SNAPSHOTS: R2Bucket };
```

In `worker/src/routes/cities.ts`, update Bindings:
```typescript
type Bindings = { DB: D1Database; CITY: DurableObjectNamespace; SNAPSHOTS: R2Bucket };
```

**Step 4: Apply migration locally and verify**

Run:
```bash
cd worker && npx wrangler d1 migrations apply hallucinating-splines-db --local
```
Expected: Migration v2 applied successfully.

**Step 5: Verify dev server starts**

Run:
```bash
cd worker && npx wrangler dev
```
Expected: Server starts, R2 bucket available locally.

**Step 6: Commit**

```bash
git add worker/migrations/0002_snapshots_actions.sql worker/wrangler.toml worker/src/index.ts worker/src/cityDO.ts worker/src/routes/actions.ts worker/src/routes/cities.ts
git commit -m "feat: add D1 migration for snapshots/actions tables and R2 bucket binding"
```

---

### Task 2: R2 Snapshot Saving on Advance

**Files:**
- Modify: `worker/src/cityDO.ts` — add getSnapshotData RPC method
- Modify: `worker/src/routes/actions.ts` — save snapshot after advance

**Step 1: Add getSnapshotData RPC to CityDO**

In `worker/src/cityDO.ts`, add after `getDemandData()`:
```typescript
async getSnapshotData(): Promise<any> {
  const game = await this.ensureGame();
  const stats = this.game!.getStats();
  const mapData = this.game!.getMap();
  return {
    city_id: this.cityId,
    game_year: stats.year,
    population: stats.population,
    funds: stats.funds,
    score: stats.score,
    tiles: mapData.tiles,
  };
}
```

**Step 2: Save snapshot in advance route**

In `worker/src/routes/actions.ts`, modify the advance handler. After `const result = await stub.advance(months);`, add snapshot saving:

```typescript
// Save snapshot to R2 and metadata to D1 (fire and forget)
c.executionCtx.waitUntil((async () => {
  const snapshot = await stub.getSnapshotData();
  const r2Key = `snapshots/${cityId}/${snapshot.game_year}.json`;
  await c.env.SNAPSHOTS.put(r2Key, JSON.stringify(snapshot));
  await c.env.DB.prepare(
    `INSERT INTO snapshots (city_id, game_year, r2_key, population, funds) VALUES (?, ?, ?, ?, ?)`
  ).bind(cityId, snapshot.game_year, r2Key, snapshot.population, snapshot.funds).run();
})());
```

**Step 3: Test locally**

```bash
cd worker && npx wrangler dev
```
Create a key, create a city, advance time. Check `.wrangler/state/` for R2 objects and query D1 for snapshot rows.

**Step 4: Commit**

```bash
git add worker/src/cityDO.ts worker/src/routes/actions.ts
git commit -m "feat: save tile snapshots to R2 on every advance call"
```

---

### Task 3: Snapshot List + Retrieval Endpoints

**Files:**
- Modify: `worker/src/routes/cities.ts` — add snapshot endpoints

**Step 1: Add snapshot list endpoint**

In `worker/src/routes/cities.ts`, add before the `GET /:id` route (so it doesn't get caught by the catch-all):

```typescript
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
```

**Step 2: Add snapshot retrieval endpoint**

```typescript
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
```

**Step 3: Test locally**

Create city, advance a few times, then:
- `GET /v1/cities/:id/snapshots` should list snapshots
- `GET /v1/cities/:id/snapshots/1901` should return tile data

**Step 4: Commit**

```bash
git add worker/src/routes/cities.ts
git commit -m "feat: add snapshot list and retrieval endpoints"
```

---

### Task 4: Auto-Infrastructure Helpers

**Files:**
- Create: `worker/src/autoInfra.ts`
- Modify: `worker/src/cityDO.ts` — add placeToolWithAuto RPC
- Modify: `worker/src/routes/actions.ts` — pass auto flags through

**Step 1: Create autoInfra.ts**

Create `worker/src/autoInfra.ts`:
```typescript
// ABOUTME: Auto-infrastructure helpers for automatic bulldozing, power connection, and road connection.
// ABOUTME: Uses BFS pathfinding on the tile grid to find shortest paths to existing infrastructure.

import { HeadlessGame } from '../../src/headlessGame';
import * as TV from '../../src/engine/tileValues';
import { BIT_MASK, POWERBIT } from '../../src/engine/tileFlags';

interface AutoAction {
  type: string;
  path?: number[][];
  tiles?: number[][];
  cost: number;
  failed?: boolean;
  reason?: string;
}

const MAX_PATH_LENGTH = 50;

function getTileId(rawValue: number): number {
  return rawValue & BIT_MASK;
}

function isPowered(rawValue: number): boolean {
  return (rawValue & POWERBIT) !== 0;
}

function isWater(tileId: number): boolean {
  return tileId >= TV.RIVER && tileId <= TV.WATER_HIGH;
}

function isTree(tileId: number): boolean {
  return tileId >= TV.TREEBASE && tileId <= TV.WOODS_HIGH;
}

function isRubble(tileId: number): boolean {
  return tileId >= TV.RUBBLE && tileId <= TV.LASTRUBBLE;
}

function isRoad(tileId: number): boolean {
  return tileId >= TV.ROADBASE && tileId <= TV.LASTROAD;
}

function isPowerLine(tileId: number): boolean {
  return tileId >= TV.POWERBASE && tileId <= TV.LASTPOWER;
}

function isBuildable(tileId: number): boolean {
  return tileId === TV.DIRT || isTree(tileId) || isRubble(tileId);
}

function isConductive(tileId: number): boolean {
  return isRoad(tileId) || isPowerLine(tileId);
}

// BFS to find nearest tile matching predicate, returning path
function bfsPath(
  map: { width: number; height: number; tiles: number[] },
  startX: number, startY: number,
  targetPredicate: (tileId: number, rawValue: number, x: number, y: number) => boolean,
  passablePredicate: (tileId: number) => boolean,
): number[][] | null {
  const { width, height, tiles } = map;
  const visited = new Set<number>();
  const parent = new Map<number, number>();
  const queue: number[] = [];

  const key = (x: number, y: number) => y * width + x;
  const startKey = key(startX, startY);
  visited.add(startKey);
  queue.push(startKey);

  let found: number | null = null;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const cx = current % width;
    const cy = Math.floor(current / width);

    // Check distance limit
    const dist = Math.abs(cx - startX) + Math.abs(cy - startY);
    if (dist > MAX_PATH_LENGTH) continue;

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      visited.add(nk);

      const raw = tiles[nk];
      const tileId = getTileId(raw);

      if (targetPredicate(tileId, raw, nx, ny)) {
        parent.set(nk, current);
        found = nk;
        break;
      }

      if (passablePredicate(tileId)) {
        parent.set(nk, current);
        queue.push(nk);
      }
    }
    if (found !== null) break;
  }

  if (found === null) return null;

  // Reconstruct path (exclude start and target)
  const path: number[][] = [];
  let cur = found;
  while (parent.has(cur) && cur !== startKey) {
    const prev = parent.get(cur)!;
    if (prev !== startKey) {
      path.unshift([prev % width, Math.floor(prev / width)]);
    }
    cur = prev;
  }
  return path;
}

export function autoBulldoze(
  game: HeadlessGame, x: number, y: number, toolSize: number
): AutoAction {
  const map = game.getMap();
  const clearedTiles: number[][] = [];
  let totalCost = 0;

  // Scan footprint area (toolSize x toolSize centered on x,y for 3x3, or offset for 4x4)
  const halfSize = Math.floor(toolSize / 2);
  const startX = x - halfSize;
  const startY = y - halfSize;

  for (let dy = 0; dy < toolSize; dy++) {
    for (let dx = 0; dx < toolSize; dx++) {
      const tx = startX + dx;
      const ty = startY + dy;
      if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) continue;
      const tileId = getTileId(map.tiles[ty * map.width + tx]);
      if (isTree(tileId) || isRubble(tileId)) {
        const result = game.placeTool('bulldozer', tx, ty);
        if (result.success) {
          clearedTiles.push([tx, ty]);
          totalCost += result.cost;
        }
      }
    }
  }

  return { type: 'bulldoze', tiles: clearedTiles, cost: totalCost };
}

export function autoPower(
  game: HeadlessGame, x: number, y: number
): AutoAction {
  const map = game.getMap();

  // BFS from (x,y) to find nearest powered tile
  const path = bfsPath(
    map, x, y,
    (_tileId, rawValue) => isPowered(rawValue),
    (tileId) => isBuildable(tileId) || isConductive(tileId),
  );

  if (!path || path.length === 0) {
    return { type: 'power_line', path: [], cost: 0, failed: true, reason: 'No path to powered tile' };
  }

  // Place power lines along path
  let totalCost = 0;
  const placedPath: number[][] = [];
  for (const [px, py] of path) {
    const tileId = getTileId(map.tiles[py * map.width + px]);
    if (isBuildable(tileId)) {
      const result = game.placeTool('wire', px, py);
      if (result.success) {
        placedPath.push([px, py]);
        totalCost += result.cost;
      }
    }
  }

  return { type: 'power_line', path: placedPath, cost: totalCost };
}

export function autoRoad(
  game: HeadlessGame, x: number, y: number
): AutoAction {
  const map = game.getMap();

  // BFS from (x,y) to find nearest road tile
  const path = bfsPath(
    map, x, y,
    (tileId) => isRoad(tileId),
    (tileId) => isBuildable(tileId) || isConductive(tileId) || isRoad(tileId),
  );

  if (!path || path.length === 0) {
    return { type: 'road', path: [], cost: 0, failed: true, reason: 'No path to road' };
  }

  let totalCost = 0;
  const placedPath: number[][] = [];
  for (const [px, py] of path) {
    const tileId = getTileId(map.tiles[py * map.width + px]);
    if (isBuildable(tileId)) {
      const result = game.placeTool('road', px, py);
      if (result.success) {
        placedPath.push([px, py]);
        totalCost += result.cost;
      }
    }
  }

  return { type: 'road', path: placedPath, cost: totalCost };
}
```

**Step 2: Add placeToolWithAuto RPC to CityDO**

In `worker/src/cityDO.ts`, add import and new method:
```typescript
import { autoBulldoze, autoPower, autoRoad } from './autoInfra';
```

Add after `placeToolAction`:
```typescript
async placeToolWithAuto(
  toolName: string, x: number, y: number,
  opts: { auto_bulldoze?: boolean; auto_power?: boolean; auto_road?: boolean }
): Promise<any> {
  const game = await this.ensureGame();
  const autoActions: any[] = [];

  // Auto-bulldoze before placement
  if (opts.auto_bulldoze) {
    const toolSizes: Record<string, number> = {
      residential: 3, commercial: 3, industrial: 3,
      coal: 4, nuclear: 4, fire: 3, police: 3,
      port: 4, airport: 6, stadium: 4,
    };
    const size = toolSizes[toolName] || 1;
    const result = autoBulldoze(game, x, y, size);
    if (result.tiles && result.tiles.length > 0) autoActions.push(result);
  }

  // Primary placement
  const placeResult = game.placeTool(toolName, x, y);

  if (placeResult.success) {
    // Auto-power after placement
    if (opts.auto_power) {
      const result = autoPower(game, x, y);
      autoActions.push(result);
    }

    // Auto-road after placement
    if (opts.auto_road) {
      const result = autoRoad(game, x, y);
      autoActions.push(result);
    }

    await this.persist();
  }

  const autoCost = autoActions.reduce((sum, a) => sum + a.cost, 0);
  return {
    ...placeResult,
    cost: placeResult.cost + autoCost,
    auto_actions: autoActions,
    stats: this.getStatsInternal(),
  };
}
```

**Step 3: Update actions route to pass auto flags**

In `worker/src/routes/actions.ts`, modify the POST /:id/actions handler. After parsing `action, x, y` from body, also read auto flags:

```typescript
const auto_bulldoze = body.auto_bulldoze === true;
const auto_power = body.auto_power === true;
const auto_road = body.auto_road === true;
const useAuto = auto_bulldoze || auto_power || auto_road;
```

Replace the DO call:
```typescript
const result = useAuto
  ? await stub.placeToolWithAuto(toolName, x, y, { auto_bulldoze, auto_power, auto_road })
  : await stub.placeToolAction(toolName, x, y);
```

Update the response to include auto_actions:
```typescript
return c.json({
  success: result.success,
  cost: result.cost,
  funds_remaining: result.stats?.funds,
  auto_actions: result.auto_actions || [],
});
```

**Step 4: Test locally**

Create a city, place a coal power plant, then place a residential zone with `auto_power: true, auto_road: true`. Verify auto_actions in response.

**Step 5: Commit**

```bash
git add worker/src/autoInfra.ts worker/src/cityDO.ts worker/src/routes/actions.ts
git commit -m "feat: add auto-infrastructure helpers (bulldoze, power, road)"
```

---

### Task 5: Semantic Map Summary Endpoint

**Files:**
- Create: `worker/src/mapAnalysis.ts`
- Modify: `worker/src/cityDO.ts` — add getMapSummary RPC
- Modify: `worker/src/routes/cities.ts` — add GET /:id/map/summary

**Step 1: Create mapAnalysis.ts**

Create `worker/src/mapAnalysis.ts`:
```typescript
// ABOUTME: Analyzes tile data to produce a semantic map summary for LLMs.
// ABOUTME: Classifies tiles, detects buildings, and identifies issues like unpowered zones.

import * as TV from '../../src/engine/tileValues';
import { BIT_MASK, POWERBIT, ZONEBIT } from '../../src/engine/tileFlags';

interface Building {
  type: string;
  x: number;
  y: number;
  powered: boolean;
}

interface MapSummary {
  terrain: { water_tiles: number; tree_tiles: number; empty_tiles: number };
  buildings: Building[];
  infrastructure: { road_tiles: number; rail_tiles: number; power_line_tiles: number };
  analysis: {
    unpowered_buildings: number;
    unroaded_zones: number;
    largest_empty_area: { x: number; y: number; approx_size: string } | null;
  };
}

function getTileId(raw: number): number { return raw & BIT_MASK; }
function hasPower(raw: number): boolean { return (raw & POWERBIT) !== 0; }
function isZone(raw: number): boolean { return (raw & ZONEBIT) !== 0; }

function classifyBuilding(tileId: number): string | null {
  if (tileId >= TV.RESBASE && tileId < TV.COMBASE) return 'residential';
  if (tileId >= TV.COMBASE && tileId < TV.INDBASE) return 'commercial';
  if (tileId >= TV.INDBASE && tileId < TV.PORTBASE) return 'industrial';
  if (tileId >= TV.PORTBASE && tileId <= 708) return 'seaport';
  if (tileId >= TV.AIRPORTBASE && tileId < TV.COALBASE) return 'airport';
  if (tileId >= TV.COALBASE && tileId <= TV.LASTPOWERPLANT) return 'coal_power';
  if (tileId >= TV.FIRESTBASE && tileId < TV.POLICESTBASE) return 'fire_station';
  if (tileId >= TV.POLICESTBASE && tileId < TV.STADIUMBASE) return 'police_station';
  if (tileId >= TV.STADIUMBASE && tileId < TV.NUCLEARBASE) return 'stadium';
  if (tileId >= TV.NUCLEARBASE && tileId <= TV.LASTZONE) return 'nuclear_power';
  return null;
}

function findLargestEmpty(
  tiles: number[], width: number, height: number
): { x: number; y: number; approx_size: string } | null {
  const visited = new Set<number>();
  let bestSize = 0;
  let bestX = 0, bestY = 0, bestW = 0, bestH = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      if (visited.has(k)) continue;
      const tileId = getTileId(tiles[k]);
      if (tileId !== TV.DIRT && !(tileId >= TV.TREEBASE && tileId <= TV.WOODS_HIGH)) continue;

      // Flood fill to find connected empty area
      const queue = [k];
      visited.add(k);
      let minX = x, maxX = x, minY = y, maxY = y;
      let count = 0;

      while (queue.length > 0) {
        const cur = queue.shift()!;
        const cx = cur % width;
        const cy = Math.floor(cur / width);
        count++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nk = ny * width + nx;
          if (visited.has(nk)) continue;
          const nTileId = getTileId(tiles[nk]);
          if (nTileId === TV.DIRT || (nTileId >= TV.TREEBASE && nTileId <= TV.WOODS_HIGH)) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }

      if (count > bestSize) {
        bestSize = count;
        bestX = minX;
        bestY = minY;
        bestW = maxX - minX + 1;
        bestH = maxY - minY + 1;
      }
    }
  }

  if (bestSize === 0) return null;
  return { x: bestX, y: bestY, approx_size: `${bestW}x${bestH}` };
}

export function analyzeMap(tiles: number[], width: number, height: number): MapSummary {
  let waterTiles = 0, treeTiles = 0, emptyTiles = 0;
  let roadTiles = 0, railTiles = 0, powerLineTiles = 0;
  const buildings: Building[] = [];
  let unpoweredBuildings = 0;

  // Count road tiles adjacent to each zone center for unroaded check
  const zoneCenters: { x: number; y: number }[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const raw = tiles[y * width + x];
      const tileId = getTileId(raw);

      // Terrain
      if (tileId >= TV.RIVER && tileId <= TV.WATER_HIGH) { waterTiles++; continue; }
      if (tileId >= TV.TREEBASE && tileId <= TV.WOODS_HIGH) { treeTiles++; continue; }
      if (tileId === TV.DIRT) { emptyTiles++; continue; }

      // Infrastructure
      if (tileId >= TV.ROADBASE && tileId <= TV.LASTROAD) { roadTiles++; continue; }
      if (tileId >= TV.RAILBASE && tileId <= TV.LASTRAIL) { railTiles++; continue; }
      if (tileId >= TV.POWERBASE && tileId <= TV.LASTPOWER) { powerLineTiles++; continue; }

      // Buildings (only zone centers to avoid duplicates)
      if (isZone(raw)) {
        const bType = classifyBuilding(tileId);
        if (bType) {
          const powered = hasPower(raw);
          buildings.push({ type: bType, x, y, powered });
          if (!powered) unpoweredBuildings++;
          zoneCenters.push({ x, y });
        }
      }
    }
  }

  // Check for unroaded zones: zone center with no road tile within 3 tiles
  let unroadedZones = 0;
  for (const { x, y } of zoneCenters) {
    let hasRoad = false;
    for (let dy = -3; dy <= 3 && !hasRoad; dy++) {
      for (let dx = -3; dx <= 3 && !hasRoad; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nTileId = getTileId(tiles[ny * width + nx]);
        if (nTileId >= TV.ROADBASE && nTileId <= TV.LASTROAD) hasRoad = true;
      }
    }
    if (!hasRoad) unroadedZones++;
  }

  const largestEmpty = findLargestEmpty(tiles, width, height);

  return {
    terrain: { water_tiles: waterTiles, tree_tiles: treeTiles, empty_tiles: emptyTiles },
    buildings,
    infrastructure: { road_tiles: roadTiles, rail_tiles: railTiles, power_line_tiles: powerLineTiles },
    analysis: {
      unpowered_buildings: unpoweredBuildings,
      unroaded_zones: unroadedZones,
      largest_empty_area: largestEmpty,
    },
  };
}
```

**Step 2: Add getMapSummary RPC to CityDO**

In `worker/src/cityDO.ts`, add import and method:
```typescript
import { analyzeMap } from './mapAnalysis';
```

```typescript
async getMapSummary(): Promise<any> {
  const game = await this.ensureGame();
  const mapData = game.getMap();
  return analyzeMap(mapData.tiles, mapData.width, mapData.height);
}
```

**Step 3: Add route**

In `worker/src/routes/cities.ts`, add before `/:id/map/region`:
```typescript
// GET /v1/cities/:id/map/summary — Semantic map summary
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
```

**Step 4: Test locally, then commit**

```bash
git add worker/src/mapAnalysis.ts worker/src/cityDO.ts worker/src/routes/cities.ts
git commit -m "feat: add semantic map summary endpoint"
```

---

### Task 6: Buildability Mask Endpoint

**Files:**
- Modify: `worker/src/cityDO.ts` — add getBuildablePositions RPC
- Modify: `worker/src/routes/cities.ts` — add GET /:id/map/buildable

**Step 1: Add getBuildablePositions to CityDO**

In `worker/src/cityDO.ts`, add:
```typescript
async getBuildablePositions(toolName: string, maxResults: number = 200): Promise<any> {
  const game = await this.ensureGame();
  const mapData = game.getMap();
  const { width, height, tiles } = mapData;

  // Tool footprint sizes
  const toolSizes: Record<string, number> = {
    residential: 3, commercial: 3, industrial: 3,
    coal: 4, nuclear: 4, fire: 3, police: 3,
    port: 4, airport: 6, stadium: 4,
    road: 1, rail: 1, wire: 1, park: 1, bulldozer: 1,
  };
  const size = toolSizes[toolName] || 1;
  const halfSize = Math.floor(size / 2);

  const validPositions: number[][] = [];

  for (let y = halfSize; y < height - halfSize; y++) {
    for (let x = halfSize; x < width - halfSize; x++) {
      let allClear = true;
      for (let dy = -halfSize; dy < size - halfSize && allClear; dy++) {
        for (let dx = -halfSize; dx < size - halfSize && allClear; dx++) {
          const tx = x + dx, ty = y + dy;
          const tileId = tiles[ty * width + tx] & 0x3FF;
          // Buildable = dirt or trees (not water, not existing buildings)
          if (tileId !== 0 && !(tileId >= 21 && tileId <= 39)) {
            allClear = false;
          }
        }
      }
      if (allClear) validPositions.push([x, y]);
    }
  }

  // Sample if too many
  let sampled = validPositions;
  if (validPositions.length > maxResults) {
    sampled = [];
    const step = Math.floor(validPositions.length / maxResults);
    for (let i = 0; i < validPositions.length && sampled.length < maxResults; i += step) {
      sampled.push(validPositions[i]);
    }
  }

  return {
    tool: toolName,
    size: { width: size, height: size },
    valid_positions: sampled.map(([x, y]) => ({ x, y })),
    total_valid: validPositions.length,
  };
}
```

**Step 2: Add route**

In `worker/src/routes/cities.ts`, add before `/:id/map/region`:
```typescript
// GET /v1/cities/:id/map/buildable — Where can I build?
cities.get('/:id/map/buildable', async (c) => {
  const cityId = c.req.param('id');
  const action = c.req.query('action');

  if (!action) return errorResponse(c, 400, 'bad_request', 'Missing action query parameter');

  // Map PRD action names to engine tool names
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
```

**Step 3: Test and commit**

```bash
git add worker/src/cityDO.ts worker/src/routes/cities.ts
git commit -m "feat: add buildability mask endpoint"
```

---

### Task 7: Action Logging + History Endpoint

**Files:**
- Modify: `worker/src/routes/actions.ts` — log actions to D1
- Modify: `worker/src/routes/cities.ts` — add GET /:id/actions

**Step 1: Add action logging to the actions route**

In `worker/src/routes/actions.ts`, after the successful placement sync, also log the action:

In the POST /:id/actions handler, after the syncStats waitUntil block, add:
```typescript
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
```

Similarly for advance, after the D1 sync:
```typescript
c.executionCtx.waitUntil(
  c.env.DB.prepare(
    `INSERT INTO actions (city_id, game_year, action_type, params, result, cost)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(cityId, result.year, 'advance', JSON.stringify({ months }), 'success', 0).run()
);
```

**Step 2: Add action history endpoint**

In `worker/src/routes/cities.ts`, add before `/:id`:
```typescript
// GET /v1/cities/:id/actions — Action history
cities.get('/:id/actions', async (c) => {
  const cityId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const row = await c.env.DB.prepare('SELECT id FROM cities WHERE id = ?')
    .bind(cityId).first();
  if (!row) return errorResponse(c, 404, 'not_found', 'City not found');

  const actions = await c.env.DB.prepare(
    `SELECT id, game_year, action_type, params, result, cost, created_at
     FROM actions WHERE city_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(cityId, limit, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM actions WHERE city_id = ?'
  ).bind(cityId).first<{ count: number }>();

  return c.json({
    actions: actions.results.map((a: any) => ({
      ...a,
      params: JSON.parse(a.params),
    })),
    total: total?.count || 0,
  });
});
```

**Step 3: Test and commit**

```bash
git add worker/src/routes/actions.ts worker/src/routes/cities.ts
git commit -m "feat: add action logging and history endpoint"
```

---

### Task 8: City Lifecycle (Bankruptcy + Inactivity Cron)

**Files:**
- Modify: `worker/src/cityDO.ts` — track zero-funds months, check bankruptcy after advance
- Modify: `worker/src/index.ts` — add scheduled handler for inactivity
- Modify: `worker/wrangler.toml` — add cron trigger

**Step 1: Track bankruptcy in CityDO**

In `worker/src/cityDO.ts`, add to CityState:
```typescript
interface CityState {
  seed: number;
  cityId: string;
  saveData: any;
  zeroFundsMonths: number;
}
```

Update `persist()` to include `zeroFundsMonths`:
```typescript
private zeroFundsMonths: number = 0;
```

In `ensureGame()`, restore it:
```typescript
this.zeroFundsMonths = stored.zeroFundsMonths || 0;
```

In `persist()`:
```typescript
const state: CityState = {
  seed: this.seed,
  cityId: this.cityId,
  saveData: this.game.save(),
  zeroFundsMonths: this.zeroFundsMonths,
};
```

Modify `advance()` to check bankruptcy:
```typescript
async advance(months: number): Promise<any> {
  const game = await this.ensureGame();
  const tickResult = game.tick(months);

  // Track bankruptcy
  const stats = game.getStats();
  if (stats.funds === 0) {
    this.zeroFundsMonths += months;
  } else {
    this.zeroFundsMonths = 0;
  }

  const bankrupt = this.zeroFundsMonths >= 12;

  await this.persist();
  return {
    months_advanced: months,
    ...tickResult,
    demand: game.getDemand(),
    city_ended: bankrupt,
    ended_reason: bankrupt ? 'bankruptcy' : undefined,
  };
}
```

**Step 2: Handle bankruptcy in advance route**

In `worker/src/routes/actions.ts`, in the advance handler, after getting the result:
```typescript
// If bankrupt, mark city as ended
if (result.city_ended) {
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      "UPDATE cities SET status = 'ended', updated_at = datetime('now') WHERE id = ?"
    ).bind(cityId).run()
  );
}
```

**Step 3: Add scheduled handler for inactivity**

In `worker/src/index.ts`, add a scheduled export:
```typescript
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Mark inactive cities as ended (no API activity for 14 days)
    await env.DB.prepare(
      `UPDATE cities SET status = 'ended'
       WHERE status = 'active' AND updated_at < datetime('now', '-14 days')`
    ).run();
  },
};
```

Note: Remove the `export default app;` line and replace with the object export above. Keep the CityDO export.

**Step 4: Add cron trigger to wrangler.toml**

```toml
[triggers]
crons = ["0 0 * * *"]
```

**Step 5: Test and commit**

```bash
git add worker/src/cityDO.ts worker/src/routes/actions.ts worker/src/index.ts worker/wrangler.toml
git commit -m "feat: add city lifecycle (bankruptcy detection, inactivity cron)"
```

---

### Task 9: Per-City Rate Limiting

**Files:**
- Modify: `worker/src/cityDO.ts` — add rate limiting to RPC methods

**Step 1: Add rate limiter to CityDO**

In `worker/src/cityDO.ts`, add rate limiting state and helper:
```typescript
private actionTimestamps: number[] = [];
private advanceTimestamps: number[] = [];

private checkRateLimit(timestamps: number[], maxPerMinute: number): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  // Remove old entries
  while (timestamps.length > 0 && timestamps[0] < oneMinuteAgo) {
    timestamps.shift();
  }
  if (timestamps.length >= maxPerMinute) {
    return false; // Rate limited
  }
  timestamps.push(now);
  return true;
}
```

**Step 2: Apply rate limits**

In `placeToolAction` and `placeToolWithAuto`, add at the top:
```typescript
if (!this.checkRateLimit(this.actionTimestamps, 30)) {
  return { success: false, error: 'rate_limited', reason: 'Max 30 actions per minute' };
}
```

In `advance`, add at the top:
```typescript
if (!this.checkRateLimit(this.advanceTimestamps, 10)) {
  return { error: 'rate_limited', reason: 'Max 10 advances per minute' };
}
```

**Step 3: Handle rate limit in routes**

In `worker/src/routes/actions.ts`, check for rate_limited in responses:
```typescript
if (result.error === 'rate_limited') {
  return errorResponse(c, 429, 'rate_limited', result.reason);
}
```

Add this check in both the actions and advance handlers, right after the DO call.

**Step 4: Test and commit**

```bash
git add worker/src/cityDO.ts worker/src/routes/actions.ts
git commit -m "feat: add per-city rate limiting (30 actions/min, 10 advances/min)"
```

---

### Task 10: Leaderboard Endpoint

**Files:**
- Modify: `worker/src/routes/cities.ts` — add leaderboard route
- Modify: `worker/src/index.ts` — mount leaderboard route

**Step 1: Add leaderboard to cities router**

Since the leaderboard is at `/v1/leaderboard` (not under /cities), create a new route file or add to index. Simplest: add a route in index.ts.

In `worker/src/index.ts`, add before the catch-all:
```typescript
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
```

**Step 2: Test and commit**

```bash
git add worker/src/index.ts
git commit -m "feat: add leaderboard endpoint"
```

---

### Task 11: Seed Curation Script

**Files:**
- Create: `scripts/curate-seeds.ts`
- Modify: `worker/src/routes/seeds.ts` — load expanded seed list

**Step 1: Create seed curation script**

Create `scripts/curate-seeds.ts`:
```typescript
// ABOUTME: Analyzes map seeds to find good ones with diverse terrain.
// ABOUTME: Run with: npx tsx scripts/curate-seeds.ts > worker/src/seedData.json

import { HeadlessGame } from '../src/headlessGame';
import { withSeed } from '../src/seededRandom';
import * as TV from '../src/engine/tileValues';
import { BIT_MASK } from '../src/engine/tileFlags';

interface SeedInfo {
  seed: number;
  terrain: string;
  water_pct: number;
  buildable_pct: number;
  description: string;
}

function analyzeSeed(seed: number): SeedInfo {
  const game = withSeed(seed, () => HeadlessGame.fromSeed(seed));
  const map = game.getMap();
  const total = map.width * map.height;

  let water = 0, trees = 0, empty = 0;

  for (let i = 0; i < total; i++) {
    const tileId = map.tiles[i] & BIT_MASK;
    if (tileId >= TV.RIVER && tileId <= TV.WATER_HIGH) water++;
    else if (tileId >= TV.TREEBASE && tileId <= TV.WOODS_HIGH) trees++;
    else if (tileId === TV.DIRT) empty++;
  }

  const waterPct = Math.round((water / total) * 100);
  const buildablePct = Math.round(((empty + trees) / total) * 100);

  // Classify terrain
  let terrain = 'landlocked';
  if (waterPct > 30) terrain = 'island';
  else if (waterPct > 20) terrain = 'coastal';
  else if (waterPct > 10) terrain = 'river_valley';
  else if (waterPct > 5) terrain = 'peninsula';

  // Simple description
  const descriptions: Record<string, string> = {
    island: `Island terrain with ${waterPct}% water, challenging build space`,
    coastal: `Coastal map with ${waterPct}% water and natural harbors`,
    river_valley: `River valley with ${waterPct}% water, good balance of land and water`,
    peninsula: `Mostly land with some water features (${waterPct}% water)`,
    landlocked: `Wide open terrain with minimal water (${waterPct}% water)`,
  };

  return {
    seed,
    terrain,
    water_pct: waterPct,
    buildable_pct: buildablePct,
    description: descriptions[terrain],
  };
}

// Scan seeds and pick 50 good ones
const candidates: SeedInfo[] = [];
for (let seed = 1; seed <= 5000; seed++) {
  const info = analyzeSeed(seed);
  // Filter: want reasonable buildable space (40-95%) and some variety
  if (info.buildable_pct >= 40 && info.buildable_pct <= 95) {
    candidates.push(info);
  }
}

// Pick diverse set: ~10 per terrain type, max 50
const byTerrain: Record<string, SeedInfo[]> = {};
for (const c of candidates) {
  (byTerrain[c.terrain] ??= []).push(c);
}

const selected: SeedInfo[] = [];
const perType = 10;
for (const [, seeds] of Object.entries(byTerrain)) {
  // Sort by buildable_pct descending, take top N
  seeds.sort((a, b) => b.buildable_pct - a.buildable_pct);
  selected.push(...seeds.slice(0, perType));
}

// Sort final list by seed
selected.sort((a, b) => a.seed - b.seed);

console.log(JSON.stringify(selected.slice(0, 50), null, 2));
```

**Step 2: Run the script and save output**

```bash
cd /path/to/hallucinating-splines && npx tsx scripts/curate-seeds.ts > worker/src/seedData.json
```

**Step 3: Update seeds route to use the data**

Modify `worker/src/routes/seeds.ts`:
```typescript
// ABOUTME: GET /v1/seeds endpoint returning curated map seeds with terrain metadata.
// ABOUTME: Seeds analyzed offline by scripts/curate-seeds.ts.

import { Hono } from 'hono';
import seedData from '../seedData.json';

const seeds = new Hono();

seeds.get('/', (c) => {
  return c.json({ seeds: seedData, total: seedData.length });
});

export { seeds };
```

**Step 4: Test and commit**

```bash
git add scripts/curate-seeds.ts worker/src/seedData.json worker/src/routes/seeds.ts
git commit -m "feat: curate ~50 map seeds with terrain metadata"
```

---

## Part B: Public Website (Tasks 12–19)

### Task 12: Astro Project Scaffold + Cloudflare Pages

**Files:**
- Create: `site/` directory with Astro project

**Step 1: Scaffold Astro project**

```bash
cd /path/to/hallucinating-splines
npm create astro@latest site -- --template minimal --no-install --no-git
cd site && npm install
npm install @astrojs/react @astrojs/cloudflare react react-dom
npm install -D @types/react @types/react-dom
```

**Step 2: Configure Astro**

Create `site/astro.config.mjs`:
```javascript
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  integrations: [react()],
  output: 'static',
});
```

**Step 3: Create base layout**

Create `site/src/layouts/Base.astro`:
```astro
---
// ABOUTME: Base layout shell with nav, footer, and meta tags.
// ABOUTME: All pages wrap their content in this layout.
interface Props {
  title: string;
  description?: string;
}
const { title, description = 'AI agents build cities' } = Astro.props;
---
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content={description} />
  <title>{title} | Hallucinating Splines</title>
  <link rel="stylesheet" href="/styles/global.css" />
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-logo">Hallucinating Splines</a>
    <div class="nav-links">
      <a href="/">Cities</a>
      <a href="/leaderboard">Leaderboard</a>
      <a href="/docs">API Docs</a>
    </div>
  </nav>
  <main>
    <slot />
  </main>
  <footer class="footer">
    <p>Built on <a href="https://github.com/graememcc/micropolisJS">micropolisJS</a> (GPL v3) &middot; <a href="/docs">API</a></p>
  </footer>
</body>
</html>
```

**Step 4: Create global styles**

Create `site/public/styles/global.css`:
```css
/* ABOUTME: Global styles for the Hallucinating Splines website. */
/* ABOUTME: Minimal dark theme with accent colors. */

:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --border: #2a2d37;
  --text: #e4e4e7;
  --text-muted: #9ca3af;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --green: #22c55e;
  --red: #ef4444;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.nav-logo {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text);
}

.nav-links { display: flex; gap: 1.5rem; }

main { max-width: 1200px; margin: 0 auto; padding: 2rem; }

.footer {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
}
```

**Step 5: Create API helper**

Create `site/src/lib/api.ts`:
```typescript
// ABOUTME: Fetch wrapper for the Hallucinating Splines Workers API.
// ABOUTME: Used by all pages to load city data, stats, maps, and leaderboards.

const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://hallucinating-splines.andrew-987.workers.dev';

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}
```

**Step 6: Create placeholder index page**

Create `site/src/pages/index.astro`:
```astro
---
// ABOUTME: Homepage showing a gallery of cities sorted by population, score, or newest.
// ABOUTME: Fetches city list from the API and renders as a card grid.
import Base from '../layouts/Base.astro';
---
<Base title="Home">
  <h1>Hallucinating Splines</h1>
  <p>AI agents build cities. Watch them grow.</p>
</Base>
```

**Step 7: Copy sprite sheet**

```bash
cp _upstream_micropolisjs/images/tiles.png site/public/tiles.png
```

**Step 8: Verify it builds**

```bash
cd site && npm run build
```

**Step 9: Commit**

```bash
git add site/
git commit -m "feat: scaffold Astro website project with base layout and styles"
```

---

### Task 13: Canvas Tile Renderer

**Files:**
- Create: `site/src/lib/tileRenderer.ts`
- Create: `site/src/lib/sprites.ts`
- Create: `site/src/components/MapViewer.tsx`

**Step 1: Create sprite sheet loader**

Create `site/src/lib/sprites.ts`:
```typescript
// ABOUTME: Loads the Micropolis sprite sheet and maps tile IDs to sprite coordinates.
// ABOUTME: Sprite sheet is 512x512px with 32x32 grid of 16x16 tiles.

export const TILE_SIZE = 16;
export const TILES_PER_ROW = 32;
export const BIT_MASK = 0x3FF;

export async function loadSpriteSheet(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function tileIdFromRaw(rawValue: number): number {
  return rawValue & BIT_MASK;
}

export function spriteCoords(tileId: number): { sx: number; sy: number } {
  const col = tileId % TILES_PER_ROW;
  const row = Math.floor(tileId / TILES_PER_ROW);
  return { sx: col * TILE_SIZE, sy: row * TILE_SIZE };
}
```

**Step 2: Create tile renderer**

Create `site/src/lib/tileRenderer.ts`:
```typescript
// ABOUTME: Renders a grid of tiles onto an HTML canvas using the Micropolis sprite sheet.
// ABOUTME: Supports rendering full maps (120x100) or partial regions.

import { TILE_SIZE, TILES_PER_ROW, tileIdFromRaw, spriteCoords } from './sprites';

export function renderMap(
  ctx: CanvasRenderingContext2D,
  spriteSheet: HTMLImageElement,
  tiles: number[],
  mapWidth: number,
  mapHeight: number,
): void {
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const raw = tiles[y * mapWidth + x];
      const tileId = tileIdFromRaw(raw);
      const { sx, sy } = spriteCoords(tileId);
      ctx.drawImage(
        spriteSheet,
        sx, sy, TILE_SIZE, TILE_SIZE,
        x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE,
      );
    }
  }
}
```

**Step 3: Create MapViewer component**

Create `site/src/components/MapViewer.tsx`:
```tsx
// ABOUTME: Interactive canvas component that renders city tile maps.
// ABOUTME: Supports pan (drag) and zoom (scroll). React island hydrated client-side.

import { useRef, useEffect, useState, useCallback } from 'react';
import { loadSpriteSheet, TILE_SIZE } from '../lib/sprites';
import { renderMap } from '../lib/tileRenderer';

interface Props {
  tiles: number[];
  width: number;
  height: number;
}

export default function MapViewer({ tiles, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [spriteSheet, setSpriteSheet] = useState<HTMLImageElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    loadSpriteSheet('/tiles.png').then(setSpriteSheet);
  }, []);

  useEffect(() => {
    if (!spriteSheet || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    const mapPixelW = width * TILE_SIZE;
    const mapPixelH = height * TILE_SIZE;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    // Fit map initially
    const scaleX = canvas.width / mapPixelW;
    const scaleY = canvas.height / mapPixelH;
    const fitScale = Math.min(scaleX, scaleY);

    if (zoom === 1) {
      ctx.scale(fitScale, fitScale);
    }

    renderMap(ctx, spriteSheet, tiles, width, height);
    ctx.restore();
  }, [spriteSheet, tiles, width, height, offset, zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(4, z * delta)));
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '500px', overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
}
```

**Step 4: Verify build**

```bash
cd site && npm run build
```

**Step 5: Commit**

```bash
git add site/src/lib/ site/src/components/MapViewer.tsx
git commit -m "feat: add canvas tile renderer with pan and zoom"
```

---

### Task 14: Homepage / Gallery

**Files:**
- Create: `site/src/components/CityCard.astro`
- Modify: `site/src/pages/index.astro`

**Step 1: Create CityCard component**

Create `site/src/components/CityCard.astro`:
```astro
---
// ABOUTME: Card component displaying a city's name, mayor, population, and status.
// ABOUTME: Links to the city detail page.
interface Props {
  id: string;
  name: string;
  mayor: string;
  population: number;
  game_year: number;
  score: number;
  status: string;
}
const { id, name, mayor, population, game_year, score, status } = Astro.props;
---
<a href={`/cities/${id}`} class="city-card">
  <div class="card-header">
    <span class="city-name">{name}</span>
    <span class={`status ${status}`}>{status}</span>
  </div>
  <div class="card-mayor">{mayor}</div>
  <div class="card-stats">
    <div class="stat">
      <span class="stat-value">{population.toLocaleString()}</span>
      <span class="stat-label">pop</span>
    </div>
    <div class="stat">
      <span class="stat-value">{game_year}</span>
      <span class="stat-label">year</span>
    </div>
    <div class="stat">
      <span class="stat-value">{score}</span>
      <span class="stat-label">score</span>
    </div>
  </div>
</a>

<style>
.city-card {
  display: block;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  color: var(--text);
  transition: border-color 0.2s;
}
.city-card:hover { border-color: var(--accent); }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; }
.city-name { font-weight: 600; font-size: 1.1rem; }
.status { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 9999px; background: var(--border); }
.status.active { background: #166534; color: #86efac; }
.status.ended { background: #7f1d1d; color: #fca5a5; }
.card-mayor { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 0.75rem; }
.card-stats { display: flex; gap: 1.5rem; }
.stat { display: flex; flex-direction: column; }
.stat-value { font-weight: 600; font-size: 1rem; }
.stat-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; }
</style>
```

**Step 2: Build the homepage**

Update `site/src/pages/index.astro`:
```astro
---
// ABOUTME: Homepage showing a gallery of cities sorted by population, score, or newest.
// ABOUTME: Fetches city list from the API and renders as a card grid.
import Base from '../layouts/Base.astro';
import CityCard from '../components/CityCard.astro';
import { apiFetch } from '../lib/api';

const sort = Astro.url.searchParams.get('sort') || 'newest';
const data = await apiFetch<{ cities: any[]; total: number }>(`/v1/cities?sort=${sort}&limit=20`);
---
<Base title="Home">
  <div class="gallery-header">
    <h1>Cities</h1>
    <div class="sort-tabs">
      <a href="/?sort=newest" class:list={[{ active: sort === 'newest' }]}>Newest</a>
      <a href="/?sort=population" class:list={[{ active: sort === 'population' }]}>Population</a>
      <a href="/?sort=score" class:list={[{ active: sort === 'score' }]}>Score</a>
    </div>
  </div>

  {data.cities.length === 0 ? (
    <p class="empty">No cities yet. Create one via the API!</p>
  ) : (
    <div class="city-grid">
      {data.cities.map((city: any) => (
        <CityCard {...city} />
      ))}
    </div>
  )}
</Base>

<style>
.gallery-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.sort-tabs { display: flex; gap: 0.5rem; }
.sort-tabs a {
  padding: 0.4rem 1rem;
  border-radius: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.875rem;
}
.sort-tabs a.active { background: var(--accent); color: white; border-color: var(--accent); }
.city-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.empty { color: var(--text-muted); text-align: center; padding: 3rem; }
</style>
```

**Step 3: Verify build and commit**

```bash
cd site && npm run build
git add site/src/
git commit -m "feat: add homepage gallery with city cards"
```

---

### Task 15: City Detail Page

**Files:**
- Create: `site/src/pages/cities/[id].astro`
- Create: `site/src/components/StatsPanel.astro`
- Create: `site/src/components/HistoryScrubber.tsx`

**Step 1: Create StatsPanel**

Create `site/src/components/StatsPanel.astro`:
```astro
---
// ABOUTME: Displays city statistics panel — population, funds, year, demand bars.
// ABOUTME: Used on the city detail page.
interface Props {
  population: number;
  funds: number;
  year: number;
  score: number;
  demand: { residential: number; commercial: number; industrial: number };
  classification: string;
}
const { population, funds, year, score, demand, classification } = Astro.props;

function demandPct(val: number): number {
  return Math.max(0, Math.min(100, (val / 2000) * 50 + 50));
}
---
<div class="stats-panel">
  <div class="stat-row">
    <span class="label">Population</span>
    <span class="value">{population.toLocaleString()}</span>
  </div>
  <div class="stat-row">
    <span class="label">Funds</span>
    <span class="value">${funds.toLocaleString()}</span>
  </div>
  <div class="stat-row">
    <span class="label">Year</span>
    <span class="value">{year}</span>
  </div>
  <div class="stat-row">
    <span class="label">Score</span>
    <span class="value">{score}</span>
  </div>
  <div class="stat-row">
    <span class="label">Class</span>
    <span class="value">{classification}</span>
  </div>

  <h3 class="demand-title">Demand</h3>
  <div class="demand-bars">
    <div class="demand-bar">
      <span class="demand-label">R</span>
      <div class="bar-track"><div class="bar-fill res" style={`width: ${demandPct(demand.residential)}%`}></div></div>
    </div>
    <div class="demand-bar">
      <span class="demand-label">C</span>
      <div class="bar-track"><div class="bar-fill com" style={`width: ${demandPct(demand.commercial)}%`}></div></div>
    </div>
    <div class="demand-bar">
      <span class="demand-label">I</span>
      <div class="bar-track"><div class="bar-fill ind" style={`width: ${demandPct(demand.industrial)}%`}></div></div>
    </div>
  </div>
</div>

<style>
.stats-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; }
.stat-row { display: flex; justify-content: space-between; padding: 0.3rem 0; }
.label { color: var(--text-muted); }
.value { font-weight: 600; }
.demand-title { margin-top: 1rem; margin-bottom: 0.5rem; font-size: 0.875rem; color: var(--text-muted); text-transform: uppercase; }
.demand-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
.demand-label { width: 1rem; font-weight: 600; font-size: 0.875rem; }
.bar-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
.bar-fill.res { background: #22c55e; }
.bar-fill.com { background: #3b82f6; }
.bar-fill.ind { background: #eab308; }
</style>
```

**Step 2: Create HistoryScrubber**

Create `site/src/components/HistoryScrubber.tsx`:
```tsx
// ABOUTME: Timeline slider for scrubbing through city history snapshots.
// ABOUTME: Loads snapshot list, fetches tile data on demand when user scrubs.

import { useState, useEffect, useCallback } from 'react';

interface Snapshot {
  game_year: number;
  population: number;
  funds: number;
}

interface Props {
  cityId: string;
  apiBase: string;
  onSnapshotLoad: (tiles: number[]) => void;
}

export default function HistoryScrubber({ cityId, apiBase, onSnapshotLoad }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/v1/cities/${cityId}/snapshots?limit=100`)
      .then(r => r.json())
      .then((data: any) => {
        setSnapshots(data.snapshots || []);
        if (data.snapshots?.length > 0) {
          setSelectedIndex(data.snapshots.length - 1);
        }
      });
  }, [cityId, apiBase]);

  const loadSnapshot = useCallback(async (index: number) => {
    if (index < 0 || index >= snapshots.length) return;
    setSelectedIndex(index);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/v1/cities/${cityId}/snapshots/${snapshots[index].game_year}`);
      const data = await res.json();
      onSnapshotLoad(data.tiles);
    } finally {
      setLoading(false);
    }
  }, [snapshots, cityId, apiBase, onSnapshotLoad]);

  if (snapshots.length === 0) return null;

  const current = snapshots[selectedIndex] || snapshots[snapshots.length - 1];

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
        <span>Year {current.game_year}</span>
        <span>Pop: {current.population.toLocaleString()}</span>
        <span>{loading ? 'Loading...' : `${selectedIndex + 1} / ${snapshots.length}`}</span>
      </div>
      <input
        type="range"
        min={0}
        max={snapshots.length - 1}
        value={selectedIndex}
        onChange={(e) => loadSnapshot(parseInt(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}
```

**Step 3: Create city detail page**

Create `site/src/pages/cities/[id].astro`:
```astro
---
// ABOUTME: City detail page showing live map, stats panel, and history scrubber.
// ABOUTME: Fetches city summary, live stats, and map data from the API.
import Base from '../../layouts/Base.astro';
import StatsPanel from '../../components/StatsPanel.astro';
import { apiFetch } from '../../lib/api';

const { id } = Astro.params;
const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://hallucinating-splines.andrew-987.workers.dev';

const [city, stats, mapData] = await Promise.all([
  apiFetch<any>(`/v1/cities/${id}`),
  apiFetch<any>(`/v1/cities/${id}/stats`),
  apiFetch<any>(`/v1/cities/${id}/map`),
]);
---
<Base title={city.name}>
  <div class="city-header">
    <div>
      <h1>{city.name}</h1>
      <p class="mayor">{city.mayor}</p>
    </div>
    <span class={`status ${city.status}`}>{city.status}</span>
  </div>

  <div class="city-layout">
    <div class="map-column">
      <div id="map-container" data-tiles={JSON.stringify(mapData.tiles)} data-width={mapData.width} data-height={mapData.height} data-city-id={id} data-api-base={API_BASE}>
      </div>
      <div id="scrubber-container"></div>
    </div>
    <div class="stats-column">
      <StatsPanel
        population={stats.population}
        funds={stats.funds}
        year={stats.year}
        score={stats.score}
        demand={stats.demand}
        classification={stats.classification}
      />
    </div>
  </div>
</Base>

<script>
  import { createElement } from 'react';
  import { createRoot } from 'react-dom/client';
  import MapViewer from '../../components/MapViewer';
  import HistoryScrubber from '../../components/HistoryScrubber';

  const mapEl = document.getElementById('map-container')!;
  const tiles = JSON.parse(mapEl.dataset.tiles!);
  const width = parseInt(mapEl.dataset.width!);
  const height = parseInt(mapEl.dataset.height!);
  const cityId = mapEl.dataset.cityId!;
  const apiBase = mapEl.dataset.apiBase!;

  let currentTiles = tiles;

  const mapRoot = createRoot(mapEl);
  const scrubberRoot = createRoot(document.getElementById('scrubber-container')!);

  function renderMap(t: number[]) {
    mapRoot.render(createElement(MapViewer, { tiles: t, width, height }));
  }

  renderMap(currentTiles);

  scrubberRoot.render(createElement(HistoryScrubber, {
    cityId,
    apiBase,
    onSnapshotLoad: (snapshotTiles: number[]) => {
      currentTiles = snapshotTiles;
      renderMap(currentTiles);
    },
  }));
</script>

<style>
.city-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 1.5rem; }
.mayor { color: var(--text-muted); }
.status { font-size: 0.875rem; padding: 0.25rem 0.75rem; border-radius: 9999px; background: var(--border); }
.status.active { background: #166534; color: #86efac; }
.status.ended { background: #7f1d1d; color: #fca5a5; }
.city-layout { display: grid; grid-template-columns: 1fr 300px; gap: 1.5rem; }
.map-column { min-width: 0; }
@media (max-width: 768px) { .city-layout { grid-template-columns: 1fr; } }
</style>
```

**Step 4: Verify build and commit**

```bash
cd site && npm run build
git add site/src/
git commit -m "feat: add city detail page with map viewer, stats panel, and history scrubber"
```

---

### Task 16: Mayor Profile Page

**Files:**
- Create: `site/src/pages/mayors/[id].astro`

Note: The mayor ID is the `api_key_id` from the cities table. We need to add an endpoint or query to get mayor info. Since we don't have a dedicated mayor endpoint, the page will fetch cities filtered by mayor. We need to add a query parameter to the cities list endpoint, or add a simple mayor lookup.

**Step 1: Add mayor endpoint to the Worker API**

In `worker/src/index.ts`, add before the catch-all:
```typescript
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
```

**Step 2: Create mayor profile page**

Create `site/src/pages/mayors/[id].astro`:
```astro
---
// ABOUTME: Mayor profile page showing mayor stats and all their cities.
// ABOUTME: Fetches mayor data from the API.
import Base from '../../layouts/Base.astro';
import CityCard from '../../components/CityCard.astro';
import { apiFetch } from '../../lib/api';

const { id } = Astro.params;
const mayor = await apiFetch<any>(`/v1/mayors/${id}`);
---
<Base title={mayor.name}>
  <h1>{mayor.name}</h1>
  <div class="mayor-stats">
    <div class="stat">
      <span class="stat-value">{mayor.stats.total_cities}</span>
      <span class="stat-label">Cities Built</span>
    </div>
    <div class="stat">
      <span class="stat-value">{(mayor.stats.best_population || 0).toLocaleString()}</span>
      <span class="stat-label">Best Population</span>
    </div>
    <div class="stat">
      <span class="stat-value">{mayor.stats.best_score || 0}</span>
      <span class="stat-label">Best Score</span>
    </div>
  </div>

  <h2>Cities</h2>
  {mayor.cities.length === 0 ? (
    <p class="empty">No cities yet.</p>
  ) : (
    <div class="city-grid">
      {mayor.cities.map((city: any) => (
        <CityCard {...city} mayor={mayor.name} />
      ))}
    </div>
  )}
</Base>

<style>
.mayor-stats { display: flex; gap: 2rem; margin: 1.5rem 0; }
.stat { display: flex; flex-direction: column; }
.stat-value { font-size: 1.5rem; font-weight: 700; }
.stat-label { color: var(--text-muted); font-size: 0.875rem; }
h2 { margin-bottom: 1rem; }
.city-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.empty { color: var(--text-muted); }
</style>
```

**Step 3: Commit**

```bash
git add worker/src/index.ts site/src/pages/mayors/
git commit -m "feat: add mayor profile page and API endpoint"
```

---

### Task 17: Leaderboard Page

**Files:**
- Create: `site/src/pages/leaderboard.astro`

**Step 1: Create leaderboard page**

Create `site/src/pages/leaderboard.astro`:
```astro
---
// ABOUTME: Leaderboard page showing top cities and mayors.
// ABOUTME: Fetches from GET /v1/leaderboard.
import Base from '../layouts/Base.astro';
import { apiFetch } from '../lib/api';

const data = await apiFetch<any>('/v1/leaderboard');
---
<Base title="Leaderboard">
  <h1>Leaderboard</h1>

  <div class="boards">
    <section>
      <h2>Top Cities by Population</h2>
      <table>
        <thead><tr><th>#</th><th>City</th><th>Mayor</th><th>Population</th><th>Year</th></tr></thead>
        <tbody>
          {data.cities.by_population.map((c: any, i: number) => (
            <tr>
              <td>{i + 1}</td>
              <td><a href={`/cities/${c.id}`}>{c.name}</a></td>
              <td>{c.mayor}</td>
              <td>{c.population.toLocaleString()}</td>
              <td>{c.game_year}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Top Cities by Score</h2>
      <table>
        <thead><tr><th>#</th><th>City</th><th>Mayor</th><th>Score</th></tr></thead>
        <tbody>
          {data.cities.by_score.map((c: any, i: number) => (
            <tr>
              <td>{i + 1}</td>
              <td><a href={`/cities/${c.id}`}>{c.name}</a></td>
              <td>{c.mayor}</td>
              <td>{c.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Top Mayors by Best Population</h2>
      <table>
        <thead><tr><th>#</th><th>Mayor</th><th>Best Population</th></tr></thead>
        <tbody>
          {data.mayors.by_best_population.map((m: any, i: number) => (
            <tr>
              <td>{i + 1}</td>
              <td><a href={`/mayors/${m.id}`}>{m.name}</a></td>
              <td>{(m.best_population || 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </div>
</Base>

<style>
.boards { display: flex; flex-direction: column; gap: 2rem; }
section h2 { margin-bottom: 0.75rem; font-size: 1.1rem; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 8px; overflow: hidden; }
th, td { padding: 0.6rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 500; }
td:first-child, th:first-child { width: 3rem; text-align: center; }
</style>
```

**Step 2: Commit**

```bash
git add site/src/pages/leaderboard.astro
git commit -m "feat: add leaderboard page"
```

---

### Task 18: API Docs Page

**Files:**
- Create: `site/src/pages/docs.astro`

**Step 1: Create docs page**

Create `site/src/pages/docs.astro` — a static reference page covering all endpoints, authentication, quick start guide, and action names. This is a straightforward Astro page with HTML content. Include:

- Quick Start (create key, create city, place buildings, advance time)
- Authentication (Bearer token)
- All endpoints with method, path, auth requirement, and description
- Action names table
- Rate limits
- Link to the GitHub repo

Keep it concise and scannable — this is reference documentation, not a tutorial.

**Step 2: Commit**

```bash
git add site/src/pages/docs.astro
git commit -m "feat: add API documentation page"
```

---

### Task 19: Deploy Website + Redeploy API

**Files:**
- Modify: `worker/` — deploy updated API
- Deploy: `site/` — to Cloudflare Pages

**Step 1: Create R2 bucket on Cloudflare**

```bash
cd worker && npx wrangler r2 bucket create hallucinating-splines-snapshots
```

**Step 2: Apply D1 migration remotely**

```bash
cd worker && npx wrangler d1 migrations apply hallucinating-splines-db --remote
```

**Step 3: Deploy updated Worker API**

```bash
cd worker && npx wrangler deploy
```

**Step 4: Verify API endpoints**

Test new endpoints: leaderboard, snapshots, map/summary, map/buildable, actions history, mayor endpoint.

**Step 5: Build and deploy website**

```bash
cd site && npm run build
```

For Cloudflare Pages deployment:
```bash
cd site && npx wrangler pages deploy dist --project-name hallucinating-splines-site
```

Or connect to git via the Cloudflare dashboard for automatic deploys.

**Step 6: Verify website**

Open the Pages URL in a browser. Check:
- Homepage loads and shows cities (may be empty if no cities exist)
- Leaderboard page loads
- API docs page loads
- If cities exist, city detail page renders the map

**Step 7: Commit any deployment config changes**

```bash
git add -A && git commit -m "deploy: update API and deploy website to Cloudflare Pages"
```

---

### Task 20: End-to-End Smoke Test

**Step 1: Full lifecycle test against live API**

```bash
# Create API key
curl -X POST https://hallucinating-splines.andrew-987.workers.dev/v1/keys

# Create a city
curl -X POST https://hallucinating-splines.andrew-987.workers.dev/v1/cities \
  -H "Authorization: Bearer hs_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"seed": 42}'

# Place coal power with auto_road
curl -X POST https://hallucinating-splines.andrew-987.workers.dev/v1/cities/CITY_ID/actions \
  -H "Authorization: Bearer hs_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "build_coal_power", "x": 10, "y": 10}'

# Place residential with auto_power and auto_road
curl -X POST https://hallucinating-splines.andrew-987.workers.dev/v1/cities/CITY_ID/actions \
  -H "Authorization: Bearer hs_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "zone_residential", "x": 19, "y": 10, "auto_power": true, "auto_road": true}'

# Advance time
curl -X POST https://hallucinating-splines.andrew-987.workers.dev/v1/cities/CITY_ID/advance \
  -H "Authorization: Bearer hs_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"months": 12}'

# Check snapshots
curl https://hallucinating-splines.andrew-987.workers.dev/v1/cities/CITY_ID/snapshots

# Check map summary
curl https://hallucinating-splines.andrew-987.workers.dev/v1/cities/CITY_ID/map/summary

# Check buildable positions
curl "https://hallucinating-splines.andrew-987.workers.dev/v1/cities/CITY_ID/map/buildable?action=zone_residential"

# Check action history
curl https://hallucinating-splines.andrew-987.workers.dev/v1/cities/CITY_ID/actions

# Check leaderboard
curl https://hallucinating-splines.andrew-987.workers.dev/v1/leaderboard

# Check mayor profile
curl https://hallucinating-splines.andrew-987.workers.dev/v1/mayors/KEY_ID
```

**Step 2: Verify website pages**

Open the website and check:
- Homepage shows the city you just created
- Click into city detail — map renders with tiles
- History scrubber shows the snapshot from the advance
- Leaderboard shows your city
- API docs page is readable

**Step 3: Final commit**

```bash
git add -A && git commit -m "test: verify end-to-end smoke test passes on live deployment"
```
