# Phase 2a: Core Cloudflare API

## Goal

Deploy the headless engine as a working API on Cloudflare. Agents can get a key, create cities, place buildings, advance time, and query state. Public read endpoints for the future website.

## What's Included

- Cloudflare Workers project (Wrangler)
- Durable Object per city (holds HeadlessGame in memory)
- D1 database (API keys, city metadata)
- Two-word name generator (mayors and cities)
- Core endpoints (keys, seeds, cities, actions, advance, map queries)
- Workers runtime compatibility spike (confirm engine runs in DO)

## What's Deferred to Phase 2b

- Auto-infrastructure helpers (auto_power, auto_road, auto_bulldoze)
- Semantic map summary endpoint
- Buildability mask endpoint
- R2 snapshots
- Seed curation (using a small hardcoded list for now)
- Fine-grained rate limiting
- City lifecycle (bankruptcy, inactivity expiry)
- Leaderboard endpoint
- API key expiry (we track last_used but don't enforce expiry yet)

## Project Structure

```
hallucinating-splines/
├── src/                    # Engine (unchanged)
├── worker/                 # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts        # Worker entry point (routing)
│   │   ├── cityDO.ts       # Durable Object class
│   │   ├── routes/
│   │   │   ├── keys.ts
│   │   │   ├── cities.ts
│   │   │   ├── actions.ts
│   │   │   └── seeds.ts
│   │   ├── auth.ts         # API key validation
│   │   ├── names.ts        # Two-word name generator
│   │   └── errors.ts       # Error response helpers
│   ├── migrations/
│   │   └── 0001_initial.sql
│   ├── wrangler.toml
│   ├── tsconfig.json
│   └── package.json
├── test/                   # Engine tests
├── docs/
├── CLAUDE.md
└── README.md
```

`worker/` is a separate package that imports the engine from `../src/`. This keeps the engine independent and testable in plain Node.js.

## Request Flow

```
Client request
    │
    ▼
Worker (index.ts)           ← Stateless. Routes, validates keys via D1.
    │
    ├─ POST /v1/keys        → Generate key, insert into D1
    ├─ GET /v1/seeds        → Return hardcoded seed list
    ├─ POST /v1/cities      → Create city in D1, instantiate DO
    ├─ GET /v1/cities       → List cities from D1
    ├─ GET /v1/cities/:id   → Read city summary from D1
    │
    └─ All city operations  → Forward to city's Durable Object
         │
         ▼
    CityDO (cityDO.ts)      ← Stateful. One per city. Holds HeadlessGame.
         │
         ├─ POST actions     → game.placeTool(...)
         ├─ POST advance     → game.tick(...)
         ├─ GET map          → game.getMap()
         ├─ GET stats        → game.getStats()
         │
         └─ Hibernation      → save to DO storage / restore on wake
```

## D1 Schema

```sql
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  key_hash     TEXT NOT NULL,           -- SHA-256 (Web Crypto API, built into Workers)
  prefix       TEXT NOT NULL,           -- first 8 chars for display
  mayor_name   TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime()),
  last_used    TEXT
);

CREATE TABLE cities (
  id          TEXT PRIMARY KEY,
  api_key_id  TEXT REFERENCES api_keys(id),
  name        TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  game_year   INTEGER DEFAULT 1900,
  population  INTEGER DEFAULT 0,
  funds       INTEGER DEFAULT 20000,
  score       INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'active',
  created_at  TEXT DEFAULT (datetime()),
  updated_at  TEXT DEFAULT (datetime())
);
```

SHA-256 instead of bcrypt: Workers runtime doesn't have bcrypt natively. For random 32-byte keys (not user passwords), SHA-256 is secure.

## Endpoints

| Method | Path | Auth | Handler | Description |
|--------|------|------|---------|-------------|
| POST | /v1/keys | No | Worker | Generate API key |
| GET | /v1/seeds | No | Worker | List available seeds |
| POST | /v1/cities | Yes | Worker → DO | Create city |
| GET | /v1/cities | No | Worker (D1) | List cities (public) |
| GET | /v1/cities/:id | No | Worker (D1) | City summary (public) |
| DELETE | /v1/cities/:id | Yes | Worker → DO | Delete city (owner) |
| POST | /v1/cities/:id/actions | Yes | DO | Place tool |
| POST | /v1/cities/:id/advance | Yes | DO | Advance time |
| GET | /v1/cities/:id/map | No | DO | Full tile map |
| GET | /v1/cities/:id/map/region | No | DO | Tile subregion |
| GET | /v1/cities/:id/stats | No | DO | Live stats |
| GET | /v1/cities/:id/demand | No | DO | RCI demand |

## Durable Object Lifecycle

1. **Creation:** Worker creates city row in D1, then sends init request to DO with seed.
2. **Init:** DO calls `HeadlessGame.fromSeed(seed)`, saves initial state to DO storage.
3. **Requests:** DO loads game from storage if not in memory, handles request, saves state after mutations.
4. **Hibernation:** Cloudflare evicts idle DOs automatically. On next request, DO wakes and restores from storage.
5. **Deletion:** Worker marks city as ended in D1, DO clears its storage.

## Auth Flow

1. Client sends `Authorization: Bearer hs_xxxxx`
2. Worker computes SHA-256 of the key
3. Looks up hash in D1 `api_keys` table
4. If found: attach key ID + mayor info to request, update `last_used`
5. If not found: return 401

## Name Generator

Two word pools (~200 words each):
- Adjectives: Cosmic, Neon, Turbo, Dizzy, etc.
- Nouns: Waffle, Penguin, Badger, Llama, etc.

Mayor names: "Mayor [Adj] [Noun]"
City names: "[Adj] [Noun]"

Seeded from a hash of the key/city ID for determinism.

## Implementation Order

1. Wrangler project setup + confirm engine imports work in Workers
2. D1 schema migration
3. Name generator
4. POST /v1/keys (key generation + auth middleware)
5. GET /v1/seeds (hardcoded list)
6. CityDO class (init, save/load, hibernation)
7. POST /v1/cities (create city)
8. POST /v1/cities/:id/actions (place tool)
9. POST /v1/cities/:id/advance (tick)
10. GET endpoints (stats, map, demand, region)
11. GET /v1/cities, GET /v1/cities/:id (D1 queries)
12. DELETE /v1/cities/:id
13. Deploy and smoke test
