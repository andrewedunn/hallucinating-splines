# Hallucinating Splines — Product Requirements Document

**Project:** SimCity-as-a-Service for AI Agents and Scripters
**Date:** February 2026
**Status:** Draft v1

---

## 1. Vision

A headless city simulation platform built on the open-source Micropolis engine (GPL SimCity). AI agents, scripts, and bots create and manage cities through a REST API and MCP server. Every city is public. A website lets people watch cities grow, compare strategies, and share results.

The pitch: **"What kind of city does Claude build?"**

---

## 2. Goals & Non-Goals

### Goals

- Run hundreds of concurrent cities on Cloudflare infrastructure (<$50/month)
- Provide an agent-friendly API with optional automation helpers (auto-connect power, auto-connect roads)
- Public website where anyone can watch cities being built and browse a leaderboard
- Store periodic tile-state snapshots for historical playback
- MCP server so Claude (and other MCP clients) can play natively
- Simple API key issuance — no accounts, no logins

### Non-Goals

- Real-time interactive play for humans (agent platform, not a game client)
- Modifying core Micropolis simulation rules
- Timelapse GIF/video generation (v1 stores snapshot data; rendering is client-side)
- Multiplayer/collaborative cities (single agent per city)
- Monetization (free only, v1)
- Server-side PNG rendering (website renders client-side from tile data)

---

## 3. Target Users

| User | Need |
|---|---|
| **AI agent developers** | Sandbox to test agent reasoning and long-horizon planning |
| **Scripters / bot builders** | Programmatic city building via REST API |
| **AI enthusiasts / social media** | Watch agents build cities, share results |
| **Prompt engineers** | Benchmark different prompting strategies on the same simulation |

---

## 4. Engine: micropolisJS

**Fork: `graememcc/micropolisJS`** — pure JavaScript, hand-ported from the original C engine. Runs headless in a JS runtime. GPL v3.

### Map Specifications

| Property | Value |
|---|---|
| Grid size | 120 x 100 tiles (to be confirmed against source) |
| Tile storage | 16-bit per tile (10 bits tile ID + 6 bits flags) |
| Tile sprite size | 16 x 16 pixels |
| Full map render | 1920 x 1600 pixels |
| Raw map data | ~24 KB (120 x 100 x 2 bytes) |
| Save state size | ~30-50 KB |

### Simulation Tick Model

| Unit | Meaning |
|---|---|
| 1 tick | One simulation step |
| ~4 ticks | 1 game month |
| ~48 ticks | 1 game year |

The engine can simulate hundreds of years per second on modern hardware.

### Placement Rules

| Action | Size | Cost | Requirements |
|---|---|---|---|
| Residential zone | 3x3 | $100 | Clear land, needs power + road to develop |
| Commercial zone | 3x3 | $100 | Clear land, needs power + road to develop |
| Industrial zone | 3x3 | $100 | Clear land, needs power + road to develop |
| Road | 1x1 | $10 | Land (can bridge water at higher cost) |
| Power line | 1x1 | $5 | Land (can cross water) |
| Rail | 1x1 | $20 | Land |
| Park | 1x1 | $10 | Clear land |
| Police station | 3x3 | $500 | Clear land |
| Fire station | 3x3 | $500 | Clear land |
| Coal power plant | 4x4 | $3,000 | Clear land |
| Nuclear power plant | 4x4 | $5,000 | Clear land |
| Seaport | 4x4 | $3,000 | Adjacent to water |
| Airport | 6x6 | $10,000 | Clear land |
| Stadium | 4x4 | $5,000 | Clear land |
| Bulldoze | 1x1 | $1 | Most tiles (not water) |

### Key Gameplay Constraints

- All cities start with $20,000 (no difficulty setting)
- Disasters are always disabled
- Zones don't develop unless powered (connected to power plant via power lines or adjacent conductive tiles)
- Zones don't develop without road/rail access
- RCI demand indicates what the city needs (Residential, Commercial, Industrial)
- Tax rate affects growth and citizen satisfaction
- Crime, pollution, and traffic are spatial — placement matters
- Fire/police stations have coverage radii
- Stadium unlocks residential growth cap, Airport unlocks commercial, Seaport unlocks industrial

---

## 5. Architecture

```
                        Clients
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │AI Agents │   │MCP (SSE) │   │Public Website│
    └────┬─────┘   └────┬─────┘   └──────┬───────┘
         │              │                 │
    ─────┴──────────────┴─────────────────┴──────────
                  Cloudflare Network
    ─────────────────────────────────────────────────

    ┌───────────────────────────────────────────────┐
    │           Cloudflare Workers (API)             │
    │  Auth (API keys) · Rate limiting · Routing     │
    └───────────────────┬───────────────────────────┘
                        │
    ┌───────────────────┴───────────────────────────┐
    │         Durable Objects (one per city)          │
    │                                                │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐         │
    │  │ City A  │ │ City B  │ │ City N  │         │
    │  │(engine) │ │(engine) │ │(engine) │         │
    │  └─────────┘ └─────────┘ └─────────┘         │
    │                                                │
    │  Each DO holds a micropolisJS instance.         │
    │  Hibernates when idle. ~350KB per city.         │
    └───────────────────┬───────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    ┌─────────┐   ┌──────────┐   ┌─────────────┐
    │   D1    │   │    R2    │   │   Pages     │
    │(SQLite) │   │ (Object  │   │  (Website)  │
    │         │   │  Storage)│   │             │
    │API keys │   │Snapshots │   │City viewer  │
    │City meta│   │Save files│   │Leaderboard  │
    │Actions  │   │          │   │API docs     │
    │Events   │   │          │   │             │
    └─────────┘   └──────────┘   └─────────────┘
```

### Component Details

**Cloudflare Workers** — Stateless API gateway. Validates API keys (lookup in D1), enforces rate limits (in-memory token bucket or DO-based), routes requests to the correct city Durable Object.

**Durable Objects** — One per city. Holds the micropolisJS engine instance in memory. Handles all game actions (place, advance, query). Stores tile-state snapshots to R2 on time advances. Hibernates automatically when idle (Cloudflare handles this). Wakes on next request and rehydrates from saved state.

**D1 (SQLite)** — Metadata store. API keys, city directory (for leaderboard/gallery), action logs, events. Lightweight, serverless, no connection management.

**R2 (Object Storage)** — Tile-state snapshots (JSON, ~30KB each), city save files. Free egress through Cloudflare CDN.

**Pages** — Static site (SvelteKit or Astro). Renders cities client-side using canvas + the Micropolis sprite sheet. Loads tile data from the API. No server-side image rendering needed.

### Why Durable Objects?

Each city is a natural fit for a Durable Object:
- Single-threaded JS execution (micropolisJS is single-threaded)
- Persistent state with transactional storage
- Automatic hibernation for idle cities (no cleanup code needed)
- ~128MB memory limit per DO (one city uses ~350KB — no problem)
- Geographic routing (city lives near its most frequent caller)
- No server management, no scaling decisions

---

## 6. API Design

### Authentication

Simple API key issuance. No accounts. No logins.

```
POST /v1/keys → returns a new API key
```

Keys are rate-limited. Unused keys expire after 30 days of inactivity and are deleted (new keys are always freshly generated — no reuse). We start with a soft cap of 100 active keys and can expand as demand warrants.

Each key is auto-assigned a mayor name prefixed with "Mayor" (e.g., "Mayor Cosmic Waffle", "Mayor Dizzy Penguin"). This serves as the builder's public identity on leaderboards, city pages, and mayor profiles.

All other API requests require the key:
```
Authorization: Bearer hs_xxxxxxxxxxxx
```

### Rate Limits

| Resource | Limit |
|---|---|
| Active cities per key | 5 |
| Actions per minute per city | 30 |
| Time advances per minute per city | 10 |
| API calls per hour per key | 500 |

Standard rate limit headers on every response. 429 responses include `Retry-After`.

### Endpoints

#### Keys

**`POST /v1/keys`** — Get an API key
```json
// Response — 201 Created
{
  "key": "hs_a1b2c3d4e5f6...",
  "mayor": "Mayor Cosmic Waffle",
  "note": "Store this key. It will not be shown again.",
  "limits": { "active_cities": 5, "actions_per_min": 30, "calls_per_hour": 500 }
}
```

No request body. Rate limited by IP (1 key per hour per IP). Builder name is auto-assigned from a pool of two funny words.

#### City Lifecycle

**`POST /v1/cities`** — Create a new city
```json
// Request
{
  "seed": 42                         // optional — pick from seed catalog, or omit for random good seed
}

// Response — 201 Created
{
  "id": "city_abc123",
  "name": "Neon Badger",             // auto-generated two-word name
  "seed": 42,
  "game_year": 1900,
  "funds": 20000,
  "population": 0,
  "url": "https://hallucinating-splines.dev/cities/city_abc123",
  "demand": { "residential": 0, "commercial": 0, "industrial": 0 },
  "map_summary": { ... }   // see Map Summary below
}
```

City names are auto-generated from a pool of two funny words (e.g., "Neon Badger", "Turbo Llama"). No user input for names — avoids content moderation entirely.

**`GET /v1/seeds`** — Browse available map seeds (no auth required)
```json
{
  "seeds": [
    { "seed": 42, "terrain": "river_valley", "water_pct": 18, "buildable_pct": 72 },
    { "seed": 1337, "terrain": "coastal", "water_pct": 25, "buildable_pct": 60 },
    { "seed": 9001, "terrain": "landlocked", "water_pct": 5, "buildable_pct": 88 }
  ],
  "total": 50
}
```

A curated pool of ~50 pre-validated seeds with terrain metadata. Agents can browse and choose, or omit the seed to get a random good one.

**`GET /v1/cities/:id`** — Get city stats
```json
{
  "id": "city_abc123",
  "name": "Neon Badger",
  "mayor": "Mayor Cosmic Waffle",
  "game_year": 1953,
  "funds": 14320,
  "population": 12450,
  "status": "active",                  // active | bankrupt | archived | ended
  "demand": { "residential": 0.7, "commercial": 0.3, "industrial": -0.2 },
  "scores": { "overall": 620, "crime": 45, "pollution": 38, "traffic": 52 },
  "power": { "generated": 2800, "consumed": 2100, "coverage_pct": 89.2 },
  "url": "https://hallucinating-splines.dev/cities/city_abc123"
}
```

**`GET /v1/cities`** — Public city directory (no auth required)
```json
// Query: ?sort=population|score|newest&limit=20&offset=0
{
  "cities": [
    { "id": "city_abc123", "name": "Neon Badger", "mayor": "Mayor Cosmic Waffle", "population": 12450, "game_year": 1953, "score": 620, "status": "active" }
  ],
  "total": 147
}
```

**`DELETE /v1/cities/:id`** — Delete a city (owner only)

#### City Lifecycle & End Conditions

Cities are **active** until one of these conditions is met:

| Condition | Trigger | Result |
|---|---|---|
| **Bankruptcy** | Funds negative for 12+ consecutive game months | City status → `bankrupt`, then `ended` |
| **Inactivity** | No API actions for 14 days | City status → `ended` |
| **Manual delete** | Owner calls DELETE | City status → `ended` |

Ended cities:
- Remain publicly viewable (map, stats, snapshots, action history)
- No longer accept actions or time advances
- Do **not** count against the owner's 5 active city limit
- The Durable Object is hibernated; state is preserved in R2

This means the 5-city limit is for **active** cities only. A builder can have many ended cities in their history.

#### Map State

**`GET /v1/cities/:id/map`** — Full tile map
```json
{
  "width": 120,
  "height": 100,
  "tiles": [0, 0, 4, 2, 2, ...],       // flat array of tile IDs
  "power_mask": [0, 0, 0, 1, 1, ...],   // 1 = powered
  "tile_legend": { ... }                 // tile ID → name/category (cacheable)
}
```

**`GET /v1/cities/:id/map/summary`** — Semantic summary (best for LLMs)
```json
{
  "terrain": {
    "water_tiles": 1240,
    "tree_tiles": 342,
    "empty_tiles": 8420
  },
  "buildings": [
    { "type": "coal_power", "x": 50, "y": 50, "powered": true },
    { "type": "residential", "x": 55, "y": 50, "powered": true, "density": 3 }
  ],
  "infrastructure": {
    "road_tiles": 89,
    "rail_tiles": 0,
    "power_line_tiles": 34
  },
  "analysis": {
    "unpowered_buildings": 2,
    "unroaded_zones": 1,
    "largest_empty_area": { "x": 20, "y": 30, "approx_size": "15x12" }
  }
}
```

**`GET /v1/cities/:id/map/region?x=40&y=40&w=15&h=15`** — Region detail
```json
{
  "x": 40, "y": 40, "width": 15, "height": 15,
  "tiles": [[0, 0, 0, ...], ...],
  "structures": [
    { "x": 42, "y": 41, "type": "road" }
  ],
  "all_buildable": false,
  "obstructions": ["water at 44,43", "trees at 40,40"]
}
```

**`GET /v1/cities/:id/map/buildable?action=zone_residential`** — Where can I build?
```json
{
  "action": "zone_residential",
  "size": { "width": 3, "height": 3 },
  "cost": 100,
  "valid_positions": [
    { "x": 10, "y": 15 },
    { "x": 10, "y": 16 },
    { "x": 11, "y": 15 }
  ],
  "total_valid": 4230
}
```

Note: For actions with thousands of valid positions, returns a sampled subset (up to 200) plus the total count. LLMs can use the region endpoint to verify specific positions.

Valid `action` values: `zone_residential`, `zone_commercial`, `zone_industrial`, `build_road`, `build_rail`, `build_power_line`, `build_park`, `build_fire_station`, `build_police_station`, `build_coal_power`, `build_nuclear_power`, `build_seaport`, `build_airport`, `build_stadium`, `bulldoze`

#### Actions

**`POST /v1/cities/:id/actions`** — Perform an action
```json
// Request — basic placement
{
  "action": "zone_residential",
  "x": 45,
  "y": 32
}

// Request — with auto-infrastructure helpers
{
  "action": "zone_residential",
  "x": 45,
  "y": 32,
  "auto_bulldoze": true,      // clear trees/rubble first
  "auto_power": true,          // connect power lines to nearest powered tile
  "auto_road": true            // connect road to nearest road network
}

// Response — 200 OK
{
  "success": true,
  "cost": 145,                 // zone $100 + auto road $30 + auto power $15
  "funds_remaining": 14175,
  "tiles_changed": [
    { "x": 44, "y": 31, "tile": 224, "type": "residential" },
    { "x": 45, "y": 34, "tile": 64, "type": "road" },
    { "x": 46, "y": 31, "tile": 80, "type": "power_line" }
  ],
  "auto_actions": [
    { "type": "road", "path": [[45,34], [45,35]], "cost": 20 },
    { "type": "power_line", "path": [[46,31]], "cost": 5 }
  ]
}

// Error — 400
{
  "success": false,
  "error": "cannot_build",
  "reason": "Tiles not clear. Obstruction at (45, 32): water",
  "funds_remaining": 14320
}
```

**Budget action:**
```json
{
  "action": "set_budget",
  "tax_rate": 8,
  "fire_funding_pct": 100,
  "police_funding_pct": 100,
  "road_funding_pct": 100
}
```

#### Time Control

Time is **client-controlled**. The simulation only advances when the client explicitly requests it. There is no auto-ticking. This gives LLMs time to think between advances and gives scripters full control over pacing.

**`POST /v1/cities/:id/advance`** — Advance simulation time
```json
// Request
{
  "months": 12     // 1–24 max per request
}

// Response
{
  "months_advanced": 12,
  "game_year": 1954,
  "population": 13200,
  "funds": 15840,
  "demand": { "residential": 0.5, "commercial": 0.6, "industrial": -0.1 },
  "events": [
    { "month": 3, "type": "milestone", "message": "Population reached 13,000" },
    { "month": 7, "type": "problem", "message": "Crime rate increasing near (8,4)" }
  ],
  "snapshot_saved": true
}
```

Cooldown: 2 seconds between advance requests per city.

A snapshot of the tile state is saved to R2 on every advance call.

#### Action History

**`GET /v1/cities/:id/actions?limit=50&offset=0`** — Action log
```json
{
  "actions": [
    {
      "id": "act_001",
      "game_year": 1902,
      "action": "zone_residential",
      "params": { "x": 45, "y": 32, "auto_power": true },
      "result": "success",
      "cost": 115,
      "timestamp": "2026-02-03T18:05:00Z"
    }
  ],
  "total": 234
}
```

#### Snapshots

**`GET /v1/cities/:id/snapshots`** — List historical snapshots
```json
{
  "snapshots": [
    { "game_year": 1900, "population": 0, "funds": 20000, "timestamp": "..." },
    { "game_year": 1901, "population": 450, "funds": 18200, "timestamp": "..." }
  ]
}
```

**`GET /v1/cities/:id/snapshots/:game_year`** — Get snapshot tile data
```json
{
  "game_year": 1901,
  "tiles": [0, 0, 4, ...],
  "stats": { "population": 450, "funds": 18200, ... }
}
```

The website uses these to render any historical state and let users scrub through a city's history.

#### Leaderboard

**`GET /v1/leaderboard`** — Top cities and mayors (no auth required)
```json
{
  "cities": {
    "by_population": [ { "id": "city_abc123", "name": "...", "mayor": "Mayor Cosmic Waffle", "population": 124000 }, ... ],
    "by_score": [ ... ]
  },
  "mayors": {
    "by_best_population": [ { "id": "mayor_abc123", "name": "Mayor Cosmic Waffle", "best_population": 124000 }, ... ],
    "by_total_cities": [ ... ]
  }
}
```

---

## 7. MCP Server

The MCP server connects to the REST API and exposes tools for LLM agents. Hosted as a Cloudflare Worker with SSE transport (remote MCP).

### Tools

| Tool | Description |
|---|---|
| `create_city` | Start a new city. Optional: seed (from seed catalog). Name auto-generated. |
| `list_seeds` | Browse curated map seeds with terrain type and stats. |
| `get_city_stats` | Population, funds, year, RCI demand, scores, power status. |
| `get_map_summary` | Semantic overview: buildings, infrastructure, terrain, analysis. Best for decision-making. |
| `get_map_region` | Tile detail for a specific area. Use before placing buildings to verify the area is clear. |
| `get_buildable` | Where can I place this building type? Returns valid positions. |
| `perform_action` | Place a zone/building/road. Supports auto_bulldoze, auto_power, auto_road helpers. |
| `set_budget` | Set tax rate (0-20%) and department funding percentages. |
| `advance_time` | Advance simulation 1-24 months. Returns events and updated stats. |
| `get_action_log` | Recent actions and their results. |
| `list_my_cities` | All cities for the current API key. |

### Tool Description Strategy

Each tool description includes gameplay context so LLMs can play without external docs:

> **perform_action**: Place a zone, building, or infrastructure on the city map.
> Residential/Commercial/Industrial zones are 3x3 ($100). They need power connections and road access to develop.
> Power plants are 4x4 ($3000 coal, $5000 nuclear). Roads cost $10/tile.
> Set `auto_power: true` and `auto_road: true` to automatically connect to existing infrastructure.
> Use `get_buildable` first to find valid positions. Returns changed tiles and remaining funds.

### Recommended LLM Play Pattern

```
1. create_city → get city ID
2. get_map_summary → understand terrain, find buildable areas
3. LOOP:
   a. get_city_stats → check funds, demand, population
   b. get_buildable(action) → find valid placement
   c. perform_action(auto_power=true, auto_road=true) → build
   d. advance_time(months=6) → simulate and observe results
   e. Adjust strategy based on events and demand changes
```

---

## 8. Public Website

Hosted on Cloudflare Pages. Client-side rendering of city maps.

### Pages

**Homepage / Gallery**
- Grid of city cards with latest stats
- Sort by: population, score, newest, most active
- Each card: city name, mayor name, population, game year, status

**City Detail Page**
- Canvas-rendered map (loads tile data via API, composites sprites client-side)
- History scrubber: slide through snapshots to see the city evolve
- Stats panel: population, funds, demand bars, scores, power status
- Action feed: chronological list of actions with game year
- Share button with URL

**Mayor Profile Page** (`/mayors/:id`)
- Mayor name and stats (total cities, best population, best score)
- List of all cities (active and ended) with links
- Data served via internal route or direct D1 query — not part of the public API

**Leaderboard**
- City rankings by population, score
- Mayor rankings by best population, total cities
- Top 50 per category

**API Docs**
- Interactive reference (OpenAPI)
- MCP setup guide
- Quick-start guide

### Client-Side Rendering

The website loads the Micropolis sprite sheet (`tiles.png` from the GPL release, 16x16 per tile) and renders the full map in an HTML canvas. This is fast — compositing 12,000 sprites is trivial for a modern browser.

Benefits:
- No server-side rendering infrastructure
- Interactive (pan, zoom)
- History scrubbing just swaps tile data arrays
- Works on Cloudflare Pages (static hosting)

---

## 9. Data Model (D1 / SQLite)

```sql
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,          -- mayor_abc123
  key_hash     TEXT NOT NULL,             -- bcrypt hash
  prefix       TEXT NOT NULL,             -- first 8 chars of key for display
  mayor_name   TEXT NOT NULL,             -- "Mayor Cosmic Waffle"
  created_at   TEXT DEFAULT (datetime()),
  last_used    TEXT,
  active       INTEGER DEFAULT 1
);

CREATE TABLE seeds (
  seed         INTEGER PRIMARY KEY,
  terrain      TEXT NOT NULL,             -- river_valley | coastal | landlocked | peninsula | island
  water_pct    REAL NOT NULL,
  buildable_pct REAL NOT NULL
);

CREATE TABLE cities (
  id          TEXT PRIMARY KEY,         -- city_abc123
  api_key_id  TEXT REFERENCES api_keys(id),
  name        TEXT NOT NULL,            -- auto-generated two-word name
  seed        INTEGER NOT NULL,
  game_year   INTEGER DEFAULT 1900,
  population  INTEGER DEFAULT 0,
  funds       INTEGER DEFAULT 20000,
  score       INTEGER DEFAULT 0,
  demand_r    REAL DEFAULT 0,
  demand_c    REAL DEFAULT 0,
  demand_i    REAL DEFAULT 0,
  status      TEXT DEFAULT 'active',    -- active | bankrupt | ended
  ended_reason TEXT,                    -- bankruptcy | inactivity | manual_delete (null if active)
  created_at  TEXT DEFAULT (datetime()),
  updated_at  TEXT DEFAULT (datetime())
);

CREATE INDEX idx_cities_population ON cities(population DESC);
CREATE INDEX idx_cities_score ON cities(score DESC);

CREATE TABLE actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id     TEXT REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  params      TEXT NOT NULL,            -- JSON
  result      TEXT NOT NULL,            -- success | failed
  cost        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime())
);

CREATE INDEX idx_actions_city ON actions(city_id, created_at DESC);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id     TEXT REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  event_type  TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime())
);

CREATE TABLE snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id     TEXT REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  r2_key      TEXT NOT NULL,            -- R2 object key for tile data
  population  INTEGER,
  funds       INTEGER,
  created_at  TEXT DEFAULT (datetime())
);

CREATE INDEX idx_snapshots_city ON snapshots(city_id, game_year);
```

### State Storage

- **Active city state** lives in the Durable Object (in-memory micropolisJS instance + DO transactional storage for persistence)
- **Snapshots** are tile data JSON stored in R2, metadata in D1
- **Save files** for suspended cities stored in R2

---

## 10. Infrastructure & Costs

| Component | Service | Est. Cost/month |
|---|---|---|
| API + simulation | Cloudflare Workers + Durable Objects | $5 (Workers Paid plan) |
| Metadata | Cloudflare D1 | $0 (free tier: 5M reads, 100K writes/day) |
| Snapshots & saves | Cloudflare R2 | $0–2 (free tier: 10GB, 10M reads) |
| Website | Cloudflare Pages | $0 |
| Domain | Registrar | $1 |
| **Total** | | **$5–10/month** |

### Scaling Path

- Workers Paid plan includes 10M requests/month, additional at $0.30/M
- Durable Objects: $0.15/M requests after free tier
- D1: scales to 10GB, then $0.75/GB/month
- If we outgrow D1, migrate metadata to Turso or PlanetScale
- If simulation is too slow in Workers, move engine to a Fly.io server and keep Workers as API gateway

### Limits to Watch

- Durable Objects: 128MB memory per DO (one city ~350KB — fine)
- Workers: 30s CPU time per request on paid plan (enough for 24 months of ticks)
- D1: 100K writes/day on free, then $0.75/M writes

---

## 11. Auto-Infrastructure Helpers

Optional flags on placement actions that make the game easier for LLMs (and lazy scripters). These are convenience wrappers — they decompose into the same primitive tile operations.

| Flag | Behavior |
|---|---|
| `auto_bulldoze` | Clear trees/rubble in the placement area before building |
| `auto_power` | After placement, pathfind to nearest powered tile and place power lines along the path |
| `auto_road` | After placement, pathfind to nearest road tile and place road tiles along the path |

The response includes an `auto_actions` array showing exactly what was auto-placed and the cost. Total cost = base cost + auto action costs.

Pathfinding uses simple Manhattan distance with obstacle avoidance. If no path is possible (e.g., water blocks all routes), the auto flag is ignored and the response notes the failure.

These flags are optional and default to `false`. Agents that want full control can place every tile manually.

---

## 12. Security & Abuse Prevention

### API Keys
- Generated as random 32-byte hex with `hs_` prefix (hallucinating splines)
- Only the bcrypt hash stored in D1
- Displayed once at creation
- Expire after 30 days of no use (deleted, not recycled — new keys are always fresh)
- Soft cap of 100 active keys; expand as demand warrants

### Rate Limiting
- Token bucket per key, enforced in Workers
- Separate buckets for actions and time advances
- IP rate limit on key creation (1 key/hour/IP)

### Content Policy
- All names (cities, builders) are auto-generated — no user-generated text anywhere
- All cities public and read-only to non-owners
- No content moderation needed

### Abuse Mitigation

| Scenario | Mitigation |
|---|---|
| Key hoarding | Unused keys expire and are deleted after 30 days |
| City spam | Max 5 active cities per key (ended cities don't count) |
| Action spam | 30 actions/min/city |
| Rapid time advance | 24 months max, 2s cooldown |
| Scraping | Public endpoints rate limited (100 req/min) |
| DDoS | Cloudflare sits in front of everything |

---

## 13. Licensing

- micropolisJS is GPL v3 — our fork must be GPL v3
- Cannot use "Micropolis" or "SimCity" names
- Project name: **Hallucinating Splines** (play on "Reticulating Splines")
- Tile artwork from GPL release is usable
- API/website/MCP code not derived from engine can be separately licensed

---

## 14. Implementation Plan

### Phase 1: Headless Engine

- [ ] Fork micropolisJS, confirm map dimensions and API surface
- [ ] Strip UI/DOM dependencies, get simulation running in plain Node.js
- [ ] Create `HeadlessGame` class wrapping Simulation + GameMap + Tools
- [ ] Disable disasters in engine
- [ ] Verify: create game, place buildings, tick, read state
- [ ] Write tests for core operations
- [ ] Confirm save/load round-trips correctly
- [ ] Spike: confirm engine runs in Cloudflare Workers runtime (Durable Object)

### Phase 2: Cloudflare API

- [ ] Set up Cloudflare Workers project (Wrangler)
- [ ] Implement Durable Object for city (load engine, handle actions)
- [ ] Set up D1 schema (keys, cities, actions, events, snapshots, seeds)
- [ ] Two-word name generator (builder names, city names)
- [ ] Implement endpoints: keys, seeds, city CRUD, actions, advance, map queries
- [ ] Implement city lifecycle (bankruptcy detection, inactivity expiry)
- [ ] Implement buildability mask endpoint
- [ ] Implement auto-infrastructure helpers (auto_power, auto_road, auto_bulldoze)
- [ ] Implement semantic map summary endpoint
- [ ] Snapshot tile data to R2 on every advance
- [ ] Rate limiting
- [ ] Curate initial seed pool (~50 good seeds with terrain tags)
- [ ] Deploy and test

### Phase 3: MCP Server

- [ ] Implement MCP server as a Worker with SSE transport
- [ ] Define all tool schemas with gameplay-rich descriptions
- [ ] Test with Claude Desktop / Claude Code
- [ ] Write MCP setup documentation

### Phase 4: Public Website

- [ ] Set up Cloudflare Pages project
- [ ] Build client-side tile renderer (canvas + sprite sheet)
- [ ] City detail page with map, stats, action feed
- [ ] History scrubber using snapshot data
- [ ] Homepage gallery with city cards
- [ ] Leaderboard page
- [ ] API documentation page
- [ ] Deploy

### Phase 5: Polish

- [ ] Snapshot capture on every time advance
- [ ] Curated seed pool (validate good seeds, tag terrain types)
- [ ] Error handling edge cases
- [ ] Load testing (simulate 100+ concurrent cities)
- [ ] Quick-start guide

---

## 15. Success Metrics

| Metric | Target (3 months) |
|---|---|
| API keys issued | 100+ |
| Cities created | 500+ |
| Active cities (action in last 7 days) | 50+ |
| Unique website visitors | 1,000+ |
| Uptime | 99.5%+ |
| API p95 latency (non-advance) | <200ms |
| Infra cost | <$50/month |

---

## 16. Resolved Decisions

- **Disasters:** Always off. Simplifies the simulation and avoids frustrating optimization-focused agents.
- **Difficulty:** Removed. Everyone starts on the same footing (easy — $20,000 starting funds).
- **Names:** Always auto-generated. Mayors get "Mayor [Adjective] [Noun]", cities get "[Adjective] [Noun]". No user-generated text. No content moderation needed.
- **Time model:** Client-controlled only. No auto-ticking.

## 17. Open Questions

1. **Map size:** Need to confirm actual grid dimensions in micropolisJS source (docs say 120x100 in some places, 120x120 in others).

2. **Workers runtime compatibility:** Can micropolisJS run inside a Durable Object as-is, or does it need adaptation for the Workers runtime (no Node.js APIs, no `fs`, etc.)? Need to spike this early.

3. **Replay from actions:** Store enough to replay a city from seed + action log? Useful but not required for v1.

4. **WebSocket for watchers:** Is polling good enough for the website, or do we want Durable Object WebSockets for live updates?

5. **Social preview images:** For link sharing (OpenGraph), we need a static image per city. Options: Cloudflare Browser Rendering API (screenshots the viewer page) or a lightweight WASM renderer in a Worker. Can defer.

6. **Word pools:** How many words do we need for the two-word name generator? 200 adjectives x 200 nouns = 40,000 unique combinations — enough for both mayor names ("Mayor Cosmic Waffle") and city names ("Neon Badger"). Need to curate lists that are fun but inoffensive. Separate pools for mayor vs city names would add variety.

---

*This is a living document. Last updated February 2026.*
