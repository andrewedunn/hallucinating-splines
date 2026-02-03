# Phase 2a: Cloudflare API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the headless SimCity engine as a working API on Cloudflare Workers with Durable Objects and D1.

**Architecture:** Hono router in a Worker handles auth and routing. Each city is a Durable Object holding a HeadlessGame instance. D1 stores API keys and city metadata. The engine code lives in `src/` and is imported by the worker at `worker/`.

**Tech Stack:** Cloudflare Workers, Durable Objects (SQLite storage), D1, Hono, TypeScript, Wrangler

---

### Task 1: Install Wrangler and Scaffold Worker Project

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`

**Step 1: Install wrangler globally (or confirm it's available)**

Run:
```bash
npm install -g wrangler
wrangler --version
```
Expected: Version number printed (3.x+)

**Step 2: Create worker/package.json**

```json
{
  "name": "hallucinating-splines-api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "wrangler": "^3.0.0",
    "typescript": "^5.5.0"
  }
}
```

Run: `cd worker && npm install`

**Step 3: Create worker/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "~engine/*": ["../src/*"]
    }
  },
  "include": ["src/**/*.ts", "../src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create worker/wrangler.toml**

```toml
name = "hallucinating-splines"
main = "src/index.ts"
compatibility_date = "2026-01-16"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "hallucinating-splines-db"

[durable_objects]
bindings = [
  { name = "CITY", class_name = "CityDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CityDO"]
```

Note: `database_id` will be auto-filled by wrangler on first deploy. For local dev, wrangler creates a local D1 automatically.

**Step 5: Create minimal worker/src/index.ts**

```typescript
import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
```

**Step 6: Verify local dev server starts**

Run:
```bash
cd worker && npx wrangler dev
```
Expected: Dev server starts on localhost:8787. Hit http://localhost:8787/health and get `{"status":"ok"}`.

**Step 7: Commit**

```bash
git add worker/
git commit -m "feat: scaffold Cloudflare Workers project with Hono"
```

---

### Task 2: Confirm Engine Imports Work in Workers

This is the compatibility spike. We need to confirm that `HeadlessGame` can be instantiated inside the Workers runtime.

**Files:**
- Modify: `worker/src/index.ts`

**Step 1: Add a test endpoint that creates a game**

Add to `worker/src/index.ts` before `export default app`:

```typescript
import { HeadlessGame } from '../../src/headlessGame';
import { withSeed } from '../../src/seededRandom';

app.get('/spike', (c) => {
  const game = HeadlessGame.fromSeed(42);
  game.placeTool('coal', 10, 10);
  game.tick(1);
  const stats = game.getStats();
  return c.json(stats);
});
```

**Step 2: Test it**

Run: `cd worker && npx wrangler dev`
Hit: http://localhost:8787/spike
Expected: JSON with population, funds, year, etc. If this works, the engine runs in Workers.

**Step 3: Note any issues**

If there are import errors or runtime failures, we'll need to fix them before proceeding. Common issues:
- `Math.random` might behave differently (shouldn't matter, we seed it)
- Any stray Node.js-isms in the engine files
- Module resolution problems (wrangler uses esbuild, should handle parent dir imports)

**Step 4: Remove the spike endpoint and commit**

Remove the `/spike` route and the engine imports (we'll add them properly later in the DO).

```bash
git add worker/src/index.ts
git commit -m "spike: confirm engine runs in Workers runtime"
```

---

### Task 3: D1 Schema Migration

**Files:**
- Create: `worker/migrations/0001_initial.sql`

**Step 1: Write the migration**

```sql
-- API keys for authentication
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  key_hash     TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  mayor_name   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used    TEXT
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- City directory
CREATE TABLE cities (
  id          TEXT PRIMARY KEY,
  api_key_id  TEXT NOT NULL REFERENCES api_keys(id),
  name        TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  game_year   INTEGER NOT NULL DEFAULT 1900,
  population  INTEGER NOT NULL DEFAULT 0,
  funds       INTEGER NOT NULL DEFAULT 20000,
  score       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cities_api_key ON cities(api_key_id);
CREATE INDEX idx_cities_population ON cities(population DESC);
CREATE INDEX idx_cities_score ON cities(score DESC);
CREATE INDEX idx_cities_status ON cities(status);
```

**Step 2: Apply migration locally**

Run:
```bash
cd worker && npx wrangler d1 migrations apply hallucinating-splines-db --local
```
Expected: Migration applied successfully.

**Step 3: Verify tables exist**

Run:
```bash
cd worker && npx wrangler d1 execute hallucinating-splines-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```
Expected: Shows `api_keys` and `cities` tables.

**Step 4: Commit**

```bash
git add worker/migrations/
git commit -m "feat: add D1 schema for api_keys and cities"
```

---

### Task 4: Name Generator

**Files:**
- Create: `worker/src/names.ts`
- Create: `worker/test/names.test.ts` (if we set up vitest — otherwise manual test via endpoint)

**Step 1: Create the name generator**

```typescript
// ABOUTME: Two-word name generator for mayors and cities.
// ABOUTME: Deterministic from a seed string (hashed to pick words).

const ADJECTIVES = [
  'Cosmic', 'Neon', 'Turbo', 'Dizzy', 'Fuzzy', 'Mighty', 'Snappy', 'Jolly',
  'Brave', 'Crafty', 'Dapper', 'Groovy', 'Happy', 'Lucky', 'Nimble', 'Plucky',
  'Quirky', 'Rustic', 'Savvy', 'Witty', 'Zesty', 'Bold', 'Calm', 'Eager',
  'Fierce', 'Gentle', 'Hasty', 'Keen', 'Lively', 'Merry', 'Noble', 'Proud',
  'Quick', 'Rapid', 'Sleek', 'Tough', 'Vivid', 'Warm', 'Young', 'Zippy',
  'Atomic', 'Blazing', 'Chill', 'Daring', 'Epic', 'Funky', 'Grand', 'Hyper',
  'Iron', 'Jade', 'Kinetic', 'Lunar', 'Mystic', 'Nova', 'Omega', 'Pixel',
  'Quantum', 'Retro', 'Solar', 'Titan', 'Ultra', 'Velvet', 'Warp', 'Xenon',
];

const NOUNS = [
  'Waffle', 'Penguin', 'Badger', 'Llama', 'Otter', 'Panda', 'Falcon', 'Tiger',
  'Dolphin', 'Raven', 'Cobra', 'Mantis', 'Bison', 'Crane', 'Gecko', 'Heron',
  'Jaguar', 'Koala', 'Lemur', 'Moose', 'Newt', 'Osprey', 'Puffin', 'Quail',
  'Robin', 'Stork', 'Toucan', 'Viper', 'Wolf', 'Yak', 'Zebra', 'Hawk',
  'Maple', 'Cedar', 'Aspen', 'Birch', 'Coral', 'Drift', 'Ember', 'Frost',
  'Gale', 'Haze', 'Isle', 'Jetty', 'Knoll', 'Marsh', 'Oasis', 'Peak',
  'Ridge', 'Storm', 'Tide', 'Vale', 'Wisp', 'Blaze', 'Crest', 'Dune',
  'Flint', 'Glen', 'Harbor', 'Inlet', 'Lagoon', 'Mesa', 'Nexus', 'Plume',
];

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function generateName(seed: string): string {
  const h = simpleHash(seed);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 8) % NOUNS.length];
  return `${adj} ${noun}`;
}

export function generateMayorName(seed: string): string {
  return `Mayor ${generateName(seed)}`;
}

export function generateCityName(seed: string): string {
  return generateName(seed);
}
```

**Step 2: Test manually via a temporary endpoint**

Add to index.ts:
```typescript
app.get('/test-names', (c) => {
  return c.json({
    mayor: generateMayorName('key_abc123'),
    city: generateCityName('city_abc123'),
  });
});
```

Run: `cd worker && npx wrangler dev`, hit /test-names. Verify names look reasonable. Remove test endpoint.

**Step 3: Commit**

```bash
git add worker/src/names.ts
git commit -m "feat: add two-word name generator for mayors and cities"
```

---

### Task 5: Auth Middleware and Key Generation

**Files:**
- Create: `worker/src/auth.ts`
- Create: `worker/src/errors.ts`
- Create: `worker/src/routes/keys.ts`
- Modify: `worker/src/index.ts`

**Step 1: Create error helpers**

`worker/src/errors.ts`:
```typescript
// ABOUTME: Standardized JSON error responses for the API.
// ABOUTME: Used across all route handlers for consistent error formatting.

import type { Context } from 'hono';

export function errorResponse(c: Context, status: number, error: string, reason?: string) {
  return c.json({ error, reason }, status);
}
```

**Step 2: Create auth module**

`worker/src/auth.ts`:
```typescript
// ABOUTME: API key generation, hashing, and middleware for request authentication.
// ABOUTME: Uses SHA-256 via Web Crypto API for key hashing.

import type { Context, Next } from 'hono';
import { errorResponse } from './errors';

type Env = { Bindings: { DB: D1Database } };

export async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `hs_${hex}`;
}

export function generateKeyId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `key_${hex}`;
}

export async function authMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(c, 401, 'unauthorized', 'Missing or invalid Authorization header');
  }

  const key = authHeader.slice(7);
  const hash = await hashKey(key);

  const result = await c.env.DB.prepare(
    'SELECT id, mayor_name FROM api_keys WHERE key_hash = ?'
  ).bind(hash).first();

  if (!result) {
    return errorResponse(c, 401, 'unauthorized', 'Invalid API key');
  }

  // Update last_used (fire and forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE api_keys SET last_used = datetime(\'now\') WHERE id = ?')
      .bind(result.id)
      .run()
  );

  c.set('keyId', result.id);
  c.set('mayorName', result.mayor_name);

  await next();
}
```

**Step 3: Create keys route**

`worker/src/routes/keys.ts`:
```typescript
// ABOUTME: POST /v1/keys endpoint for API key generation.
// ABOUTME: Creates a new key, hashes it, stores in D1, returns plaintext key once.

import { Hono } from 'hono';
import { generateApiKey, generateKeyId, hashKey } from '../auth';
import { generateMayorName } from '../names';

type Bindings = { DB: D1Database };

const keys = new Hono<{ Bindings: Bindings }>();

keys.post('/', async (c) => {
  const keyId = generateKeyId();
  const rawKey = generateApiKey();
  const hash = await hashKey(rawKey);
  const prefix = rawKey.slice(0, 11); // "hs_" + first 8 hex chars
  const mayorName = generateMayorName(keyId);

  await c.env.DB.prepare(
    'INSERT INTO api_keys (id, key_hash, prefix, mayor_name) VALUES (?, ?, ?, ?)'
  ).bind(keyId, hash, prefix, mayorName).run();

  return c.json({
    key: rawKey,
    mayor: mayorName,
    note: 'Store this key. It will not be shown again.',
  }, 201);
});

export { keys };
```

**Step 4: Wire routes into index.ts**

Update `worker/src/index.ts`:
```typescript
// ABOUTME: Worker entry point. Routes requests and applies auth middleware.
// ABOUTME: Stateless — delegates city operations to Durable Objects.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { keys } from './routes/keys';
import { authMiddleware } from './auth';

export type Bindings = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/v1/keys', keys);

export default app;
```

**Step 5: Test key generation**

Run: `cd worker && npx wrangler dev`

```bash
curl -X POST http://localhost:8787/v1/keys
```

Expected: 201 response with `key`, `mayor`, and `note` fields.

**Step 6: Test auth middleware manually**

Add a temporary protected route to verify auth works:
```typescript
app.get('/v1/me', authMiddleware, (c) => {
  return c.json({ keyId: c.get('keyId'), mayor: c.get('mayorName') });
});
```

```bash
# Get a key
KEY=$(curl -s -X POST http://localhost:8787/v1/keys | jq -r '.key')

# Use it
curl -H "Authorization: Bearer $KEY" http://localhost:8787/v1/me
```

Expected: 200 with keyId and mayor name.

Remove the `/v1/me` test route.

**Step 7: Commit**

```bash
git add worker/src/
git commit -m "feat: add API key generation and auth middleware"
```

---

### Task 6: Seeds Endpoint

**Files:**
- Create: `worker/src/routes/seeds.ts`
- Modify: `worker/src/index.ts`

**Step 1: Create a hardcoded seed list**

We need to test a few seeds with the engine to find ones that have decent buildable areas. For now, use seeds we know work from our tests (42, 99).

`worker/src/routes/seeds.ts`:
```typescript
// ABOUTME: GET /v1/seeds endpoint returning curated map seeds.
// ABOUTME: Hardcoded list for Phase 2a; will be expanded with terrain metadata later.

import { Hono } from 'hono';

const seeds = new Hono();

const SEED_LIST = [
  { seed: 42, terrain: 'river_valley', description: 'Classic river valley with good buildable land' },
  { seed: 99, terrain: 'coastal', description: 'Coastal map with moderate water' },
  { seed: 1337, terrain: 'river_valley', description: 'Wide river with large buildable plateaus' },
  { seed: 2024, terrain: 'landlocked', description: 'Mostly land with small lakes' },
  { seed: 9001, terrain: 'peninsula', description: 'Peninsula with natural harbor' },
];

seeds.get('/', (c) => {
  return c.json({ seeds: SEED_LIST, total: SEED_LIST.length });
});

export { seeds };
```

**Step 2: Wire into index.ts**

Add to imports and routes:
```typescript
import { seeds } from './routes/seeds';
app.route('/v1/seeds', seeds);
```

**Step 3: Test**

Run: `curl http://localhost:8787/v1/seeds`
Expected: JSON with seeds array.

**Step 4: Commit**

```bash
git add worker/src/routes/seeds.ts worker/src/index.ts
git commit -m "feat: add seeds endpoint with curated seed list"
```

---

### Task 7: CityDO Durable Object

This is the core of the system — the Durable Object that holds a HeadlessGame instance.

**Files:**
- Create: `worker/src/cityDO.ts`
- Modify: `worker/src/index.ts` (export the DO class)

**Step 1: Create the Durable Object class**

`worker/src/cityDO.ts`:
```typescript
// ABOUTME: Durable Object that holds one HeadlessGame instance per city.
// ABOUTME: Persists game state to DO storage, restores on wake from hibernation.

import { DurableObject } from 'cloudflare:workers';
import { HeadlessGame } from '../../src/headlessGame';
import { withSeed } from '../../src/seededRandom';

interface CityState {
  seed: number;
  cityId: string;
  saveData: any;
}

export class CityDO extends DurableObject<{ DB: D1Database; CITY: DurableObjectNamespace }> {
  private game: HeadlessGame | null = null;
  private cityId: string | null = null;
  private seed: number | null = null;

  private async ensureGame(): Promise<HeadlessGame> {
    if (this.game) return this.game;

    const stored = await this.ctx.storage.get<CityState>('state');
    if (stored) {
      this.cityId = stored.cityId;
      this.seed = stored.seed;
      this.game = HeadlessGame.fromSave(stored.saveData);
      // Tick once to normalize census after load
      this.game.tick(0);
    }

    if (!this.game) {
      throw new Error('CityDO has no game state. Call init() first.');
    }

    return this.game;
  }

  private async persist(): Promise<void> {
    if (!this.game || !this.cityId || this.seed === null) return;
    const state: CityState = {
      seed: this.seed,
      cityId: this.cityId,
      saveData: this.game.save(),
    };
    await this.ctx.storage.put('state', state);
  }

  // --- RPC methods called by the Worker ---

  async init(cityId: string, seed: number): Promise<any> {
    this.cityId = cityId;
    this.seed = seed;
    this.game = withSeed(seed, () => HeadlessGame.fromSeed(seed));
    await this.persist();
    return this.getStatsInternal();
  }

  async placeToolAction(toolName: string, x: number, y: number): Promise<any> {
    const game = await this.ensureGame();
    const result = game.placeTool(toolName, x, y);
    if (result.success) {
      await this.persist();
    }
    return { ...result, stats: this.getStatsInternal() };
  }

  async advance(months: number): Promise<any> {
    const game = await this.ensureGame();
    const tickResult = game.tick(months);
    await this.persist();
    return {
      months_advanced: months,
      ...tickResult,
      demand: game.getDemand(),
    };
  }

  async getStats(): Promise<any> {
    await this.ensureGame();
    return this.getStatsInternal();
  }

  async getMapData(): Promise<any> {
    const game = await this.ensureGame();
    return game.getMap();
  }

  async getMapRegion(x: number, y: number, w: number, h: number): Promise<any> {
    const game = await this.ensureGame();
    const fullMap = game.getMap();
    const tiles: number[][] = [];
    for (let row = y; row < y + h && row < fullMap.height; row++) {
      const rowTiles: number[] = [];
      for (let col = x; col < x + w && col < fullMap.width; col++) {
        rowTiles.push(fullMap.tiles[row * fullMap.width + col]);
      }
      tiles.push(rowTiles);
    }
    return { x, y, width: w, height: h, tiles };
  }

  async getDemandData(): Promise<any> {
    const game = await this.ensureGame();
    return game.getDemand();
  }

  async deleteCity(): Promise<void> {
    this.game = null;
    await this.ctx.storage.deleteAll();
  }

  private getStatsInternal(): any {
    if (!this.game) return null;
    const stats = this.game.getStats();
    const demand = this.game.getDemand();
    return { ...stats, demand };
  }
}
```

**Step 2: Export from index.ts**

Add to `worker/src/index.ts`:
```typescript
export { CityDO } from './cityDO';
```

This is required — Cloudflare needs the DO class exported from the worker's entrypoint.

**Step 3: Test that wrangler dev still starts**

Run: `cd worker && npx wrangler dev`
Expected: No errors. The DO won't be used yet but wrangler should recognize the class.

**Step 4: Commit**

```bash
git add worker/src/cityDO.ts worker/src/index.ts
git commit -m "feat: add CityDO Durable Object with game lifecycle"
```

---

### Task 8: City CRUD Routes

**Files:**
- Create: `worker/src/routes/cities.ts`
- Modify: `worker/src/index.ts`

**Step 1: Create cities routes**

`worker/src/routes/cities.ts`:
```typescript
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
    case 'population': orderBy = 'population DESC'; break;
    case 'score': orderBy = 'score DESC'; break;
    default: orderBy = 'created_at DESC'; break;
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
```

**Step 2: Wire into index.ts**

```typescript
import { cities } from './routes/cities';
app.route('/v1/cities', cities);
```

**Step 3: Test city creation flow**

```bash
# Get a key
KEY=$(curl -s -X POST http://localhost:8787/v1/keys | jq -r '.key')

# Create a city
curl -s -X POST http://localhost:8787/v1/cities \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"seed": 42}'

# List cities
curl -s http://localhost:8787/v1/cities
```

Expected: City created with stats, visible in list.

**Step 4: Commit**

```bash
git add worker/src/routes/cities.ts worker/src/index.ts
git commit -m "feat: add city CRUD endpoints"
```

---

### Task 9: Action and Advance Routes

**Files:**
- Create: `worker/src/routes/actions.ts`
- Modify: `worker/src/index.ts`

**Step 1: Create action routes**

`worker/src/routes/actions.ts`:
```typescript
// ABOUTME: City action endpoints — place tools and advance time.
// ABOUTME: Forwards requests to the city's Durable Object and syncs stats to D1.

import { Hono } from 'hono';
import { authMiddleware } from '../auth';
import { errorResponse } from '../errors';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace };
type Variables = { keyId: string };

const actions = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper: verify city ownership
async function verifyCityOwner(c: any, cityId: string): Promise<boolean> {
  const row = await c.env.DB.prepare(
    "SELECT api_key_id, status FROM cities WHERE id = ?"
  ).bind(cityId).first<{ api_key_id: string; status: string }>();

  if (!row) {
    return false;
  }
  if (row.status !== 'active') {
    return false;
  }
  if (row.api_key_id !== c.get('keyId')) {
    return false;
  }
  return true;
}

// Helper: sync stats from DO to D1
async function syncStats(db: D1Database, cityId: string, stats: any): Promise<void> {
  await db.prepare(
    `UPDATE cities SET game_year = ?, population = ?, funds = ?, score = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(stats.year, stats.population, stats.funds, stats.score, cityId).run();
}

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

  // Map PRD action names to engine tool names
  const toolMap: Record<string, string> = {
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

  const toolName = toolMap[action];
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

  // Sync stats to D1 (fire and forget)
  c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, result));

  return c.json(result);
});

export { actions };
```

**Step 2: Wire into index.ts**

```typescript
import { actions } from './routes/actions';
app.route('/v1/cities', actions);
```

**Step 3: Test the full flow**

```bash
KEY=$(curl -s -X POST http://localhost:8787/v1/keys | jq -r '.key')
AUTH="Authorization: Bearer $KEY"

# Create city
CITY=$(curl -s -X POST http://localhost:8787/v1/cities \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"seed": 42}' | jq -r '.id')

# Place a power plant
curl -s -X POST http://localhost:8787/v1/cities/$CITY/actions \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"action": "build_coal_power", "x": 10, "y": 10}'

# Advance 12 months
curl -s -X POST http://localhost:8787/v1/cities/$CITY/advance \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"months": 12}'
```

Expected: Successful placement and time advance with updated stats.

**Step 4: Commit**

```bash
git add worker/src/routes/actions.ts worker/src/index.ts
git commit -m "feat: add action and advance endpoints"
```

---

### Task 10: Read-Only City Endpoints (Map, Stats, Demand)

**Files:**
- Modify: `worker/src/routes/cities.ts`

**Step 1: Add live stat/map/demand routes to cities.ts**

Add these routes to the cities router (before the export):

```typescript
// GET /v1/cities/:id/stats — Live stats from DO
cities.get('/:id/stats', async (c) => {
  const cityId = c.req.param('id');

  // Verify city exists
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
```

**Step 2: Test**

```bash
# Using city from previous test
curl -s http://localhost:8787/v1/cities/$CITY/stats
curl -s http://localhost:8787/v1/cities/$CITY/map | jq '.width, .height, (.tiles | length)'
curl -s "http://localhost:8787/v1/cities/$CITY/map/region?x=5&y=5&w=10&h=10"
curl -s http://localhost:8787/v1/cities/$CITY/demand
```

Expected: Stats, 120x100 map with 12000 tiles, 10x10 region, and demand values.

**Step 3: Commit**

```bash
git add worker/src/routes/cities.ts
git commit -m "feat: add map, stats, and demand read endpoints"
```

---

### Task 11: End-to-End Smoke Test and Deploy Prep

**Files:**
- Modify: `worker/src/index.ts` (add 404 handler)

**Step 1: Add catch-all 404**

Add to index.ts after all routes:
```typescript
app.all('*', (c) => errorResponse(c, 404, 'not_found', 'Endpoint not found'));
```

**Step 2: Run full integration smoke test locally**

Write a shell script or run manually:
```bash
cd worker && npx wrangler dev &
sleep 3

echo "=== Create API Key ==="
KEY=$(curl -s -X POST http://localhost:8787/v1/keys | jq -r '.key')
echo "Key: $KEY"

echo "=== List Seeds ==="
curl -s http://localhost:8787/v1/seeds | jq '.total'

echo "=== Create City ==="
CITY=$(curl -s -X POST http://localhost:8787/v1/cities \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"seed": 42}' | jq -r '.id')
echo "City: $CITY"

echo "=== Place Coal Power ==="
curl -s -X POST http://localhost:8787/v1/cities/$CITY/actions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "build_coal_power", "x": 10, "y": 10}' | jq '.success'

echo "=== Place Residential ==="
curl -s -X POST http://localhost:8787/v1/cities/$CITY/actions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "zone_residential", "x": 19, "y": 10}' | jq '.success'

echo "=== Advance 12 Months ==="
curl -s -X POST http://localhost:8787/v1/cities/$CITY/advance \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"months": 12}' | jq '.population, .year'

echo "=== Get Stats ==="
curl -s http://localhost:8787/v1/cities/$CITY/stats | jq '.population, .funds'

echo "=== List Cities ==="
curl -s http://localhost:8787/v1/cities | jq '.total'

echo "=== Get Map ==="
curl -s http://localhost:8787/v1/cities/$CITY/map | jq '.tiles | length'

echo "=== Get Demand ==="
curl -s http://localhost:8787/v1/cities/$CITY/demand

echo "=== Delete City ==="
curl -s -X DELETE http://localhost:8787/v1/cities/$CITY \
  -H "Authorization: Bearer $KEY" | jq '.deleted'
```

Expected: All commands succeed.

**Step 3: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: add 404 handler and complete Phase 2a API"
```

---

### Task 12: Deploy to Cloudflare

This requires a Cloudflare account. Andrew will need to:

1. Sign up at https://dash.cloudflare.com (free plan is sufficient)
2. Run `wrangler login` to authenticate

**Step 1: Login to Cloudflare**

Run:
```bash
cd worker && npx wrangler login
```
This opens a browser for OAuth. Approve the connection.

**Step 2: Create D1 database**

Run:
```bash
cd worker && npx wrangler d1 create hallucinating-splines-db
```
This will output a `database_id`. Update `wrangler.toml` with it.

**Step 3: Apply migrations to remote D1**

Run:
```bash
cd worker && npx wrangler d1 migrations apply hallucinating-splines-db --remote
```

**Step 4: Deploy**

Run:
```bash
cd worker && npx wrangler deploy
```

Expected: Worker deployed with a URL like `https://hallucinating-splines.<your-subdomain>.workers.dev`

**Step 5: Smoke test the live deployment**

Repeat the smoke test from Task 11 using the live URL instead of localhost.

**Step 6: Commit any config changes (database_id in wrangler.toml)**

```bash
git add worker/wrangler.toml
git commit -m "deploy: configure D1 database ID for production"
```
