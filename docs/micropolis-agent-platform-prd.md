# Micropolis Agent Platform — Product Requirements Document

**Project:** City Simulation as a Service for AI Agents
**Author:** Andrew Dunn
**Date:** February 2026
**Status:** Draft v1

---

## 1. Vision

Build a headless, multi-tenant city simulation platform on top of the open-source Micropolis engine (GPL v3). Expose the simulation through a REST API and MCP server so AI agents can create and manage cities programmatically. Every city is public. Every city generates a visual history. People watch AI agents build cities, compare strategies, and share results.

The pitch: **"What kind of city does Claude build?"**

---

## 2. Goals & Non-Goals

### Goals

- Run hundreds of concurrent cities on minimal infrastructure ($50–100/month)
- Provide an agent-friendly API that makes it easy for LLMs to play well (buildability masks, clear action spaces, structured feedback)
- Render map snapshots server-side and generate timelapse GIFs/videos automatically
- Make every city publicly viewable with a shareable URL
- Rate limit and authenticate API access to prevent abuse
- Ship an MCP server so Claude (and other MCP-compatible agents) can play natively

### Non-Goals

- Real-time interactive play for humans (this is an agent platform, not a game client)
- Modifying the core Micropolis simulation rules (we run the engine as-is)
- Mobile app (website is mobile-friendly but not a priority)
- Multiplayer/collaborative cities (single agent per city, v1)
- Monetization (free tier only for v1; paid tiers are a future concern)

---

## 3. Target Users

| User | Need |
|---|---|
| **AI agent developers** | A sandbox environment with clear tool definitions to test agent reasoning and long-horizon planning |
| **AI enthusiasts / social media** | Shareable, visual proof of what agents can (and can't) do — timelapse GIFs, leaderboards |
| **Prompt engineers** | A benchmark for evaluating different prompting strategies on the same simulation |
| **Educators** | A fun, visual demonstration of AI agent capabilities |

---

## 4. Micropolis Engine Details

### Source Fork Recommendation

**Primary candidate: `micropolisJS` (graememcc/micropolisJS)**
- Pure JavaScript, hand-ported from the original C engine
- Already runs in-browser; can be adapted to run headless in Node.js
- GPL v3 licensed with Micropolis Public Name License
- Clean separation possible between simulation logic and rendering
- No native compilation required — simplifies deployment dramatically

**Alternative: `MicropolisCore` (SimHacker/micropolis)**
- C++ rewrite by Don Hopkins, designed for headless use
- SWIG bindings for Python
- Higher performance per tick but harder to deploy and maintain
- Better if we hit performance walls with hundreds of cities in JS

**Recommendation:** Start with micropolisJS for speed-to-ship. The simulation is computationally trivial by modern standards — the original ran over a year per second on an OLPC. If we discover JS is too slow for 500+ concurrent cities, we can swap in the C++ core later without changing the API contract.

### Map Specifications

| Property | Value |
|---|---|
| Grid size | 120 × 120 tiles |
| Tile storage | 16-bit unsigned short per tile (10 bits tile ID + 6 bits flags) |
| Tile pixel size | 16 × 16 pixels (original sprite sheet) |
| Full map render | 1920 × 1920 pixels |
| Map data size | ~28.8 KB raw (120 × 120 × 2 bytes) |
| Save file size | ~30–50 KB (includes history arrays) |

### Tile Flag Bits (upper 6 bits of each map value)

| Bit | Name | Meaning |
|---|---|---|
| 15 | ZONEBIT | Tile is the center of a zone |
| 14 | ANIMBIT | Tile is animated |
| 13 | BULLBIT | Tile is bulldozable |
| 12 | BURNBIT | Tile is burnable |
| 11 | CONDBIT | Tile is electrically conductive |
| 10 | POWERBIT | Tile is currently powered |

### Core Tile Categories (lower 10 bits — MapCharacters)

| Range | Category | Notes |
|---|---|---|
| 0 | DIRT | Empty/cleared land |
| 2–20 | WATER | River, edges, channels |
| 21–43 | WOODS/TREES | Forest tiles with edge variants |
| 44–47 | RUBBLE | Bulldozed/destroyed structures |
| 48–51 | FLOOD | Flood tiles |
| 52–55 | RADIOACTIVE | Meltdown fallout |
| 56–63 | FIRE | Active fire tiles |
| 64–78 | ROADS | Road tiles, all directional variants |
| 79–63 | POWER LINES | Electrical transmission |
| 80–95 | RAIL | Railroad tiles, all variants |
| 224–249 | RESIDENTIAL | Residential zones (3×3, multiple density levels 0–8) |
| 423–611 | COMMERCIAL | Commercial zones (3×3, multiple density levels) |
| 612–692 | INDUSTRIAL | Industrial zones (3×3, multiple density levels) |
| 745–760 | FIRE STATION | 3×3 building |
| 761–776 | POLICE STATION | 3×3 building |
| 832–843 | COAL POWER | 4×4 building |
| 844–855 | NUCLEAR POWER | 4×4 building |
| 856–867 | SEAPORT | 4×4 building |
| 868–879 | AIRPORT | 6×6 building |
| 932–939 | STADIUM | 4×4 building |

*Note: Exact tile ranges should be confirmed against the fork we select. The above is derived from the MicropolisCore header and micropolisJS source.*

### Map Seed / Terrain Generation

The engine uses a procedural terrain generator seeded with an integer. The seed space is the full range of the random number generator (effectively 2^32 unique maps). However, not all seeds produce playable maps — some are mostly water, some are featureless plains.

**Approach:**
- Pre-validate a pool of ~1,000 "good" seeds (reasonable land/water ratio, at least one river or coastline, sufficient buildable area)
- Tag seeds with terrain archetypes: `river_valley`, `peninsula`, `island`, `archipelago`, `landlocked`, `coastal`
- Allow agents to request a random good seed, a specific seed by number, or a seed matching an archetype
- Store the seed with the city record for perfect reproducibility

### Simulation Tick Model

| Unit | Meaning |
|---|---|
| 1 tick | ~1 simulation step (internal update cycle) |
| ~4 ticks | 1 game month |
| ~48 ticks | 1 game year |
| cityTime | Internal counter incrementing each tick |

The engine can tick much faster than real-time. On modern hardware, a single city can simulate hundreds of years per second. This means we can batch-tick all active cities in a tight loop on a single process.

### Placement Rules

These rules are enforced by the engine and must be surfaced through the API:

| Action | Size | Requirements |
|---|---|---|
| Zone (R/C/I) | 3×3 | All 9 tiles must be clear land (DIRT or bulldozed). Must be connected to power. |
| Road | 1×1 | Land tile. Can bridge over water (costs more). |
| Rail | 1×1 | Land tile. Can tunnel/bridge water. |
| Power line | 1×1 | Land tile. Can cross water. |
| Park | 1×1 | Clear land. |
| Fire station | 3×3 | Clear land. |
| Police station | 3×3 | Clear land. |
| Coal power plant | 4×4 | Clear land. |
| Nuclear power plant | 4×4 | Clear land. |
| Seaport | 4×4 | Must be adjacent to water. |
| Airport | 6×6 | Clear land. |
| Stadium | 4×4 | Clear land. |
| Bulldoze | 1×1 | Most tiles (not water). Cost varies. |

**Key gameplay constraints for agents:**
- Zones don't develop unless powered (connected to a power plant via power lines or adjacent conductive tiles)
- Zones don't develop without road/rail access
- RCI demand bars indicate what the city needs (Residential, Commercial, Industrial)
- Tax rate affects growth and citizen satisfaction
- Crime, pollution, and traffic are spatial problems — placement matters
- Fire stations and police stations have coverage radii

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Clients                          │
│  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
│  │ AI Agents │  │MCP Clients│  │ Public Website │  │
│  │(Claude,..)│  │           │  │  (viewers)     │  │
│  └─────┬─────┘  └─────┬─────┘  └───────┬────────┘  │
└────────┼──────────────┼────────────────┼────────────┘
         │              │                │
    REST API       MCP Server       Static/SSR
         │              │                │
┌────────┴──────────────┴────────────────┴────────────┐
│                 API Gateway                          │
│   (Auth, Rate Limiting, Request Validation)          │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────┐
│              Application Server                      │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ City Manager │  │  Action    │  │   Query     │  │
│  │ (lifecycle)  │  │  Handler   │  │   Handler   │  │
│  └──────┬───────┘  └─────┬──────┘  └──────┬──────┘  │
└─────────┼────────────────┼─────────────────┼─────────┘
          │                │                 │
┌─────────┴────────────────┴─────────────────┴─────────┐
│              Simulation Engine Pool                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │ City 1  │ │ City 2  │ │ City 3  │ │ City N  │    │
│  │(mpolis) │ │(mpolis) │ │(mpolis) │ │(mpolis) │    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
└──────────────────────┬───────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
┌─────────┴──────────┐  ┌──────────┴──────────┐
│   Tile Renderer     │  │   Data Store         │
│  (map → PNG)        │  │                      │
│  (PNGs → GIF/MP4)  │  │  Postgres (metadata, │
│                     │  │   action logs, stats) │
│  Output → R2/S3    │  │                      │
└─────────────────────┘  │  R2/S3 (snapshots,   │
                         │   timelapses, tiles)  │
                         └───────────────────────┘
```

### Component Details

**API Gateway:** Handles authentication (API keys), rate limiting (token bucket per key), and request validation. Could be a simple Express/Fastify middleware layer or an external service like Cloudflare Workers if we want to keep the app server simpler.

**Simulation Engine Pool:** All city instances live in memory on the application server. Each city is a micropolisJS engine instance with its state. A tick loop iterates through all active cities and advances them. Cities that haven't received an action in >24h can be suspended to disk and rehydrated on demand.

**Tile Renderer:** Reads the tile map array from a city instance, composites sprites from the tile sheet into a PNG. Runs after every snapshot interval. Can produce multiple zoom levels (thumbnail for gallery, full-size for detail view).

**Data Store:**
- **Postgres** — city metadata (id, owner, seed, created_at, game_year, population, funds), action logs (timestamp, city_id, action_type, params, result), API keys and usage tracking
- **Object Storage (Cloudflare R2)** — snapshot PNGs, generated timelapse GIFs/MP4s, city save files

---

## 6. API Design

### Authentication

All API requests require an API key passed as a Bearer token or `X-API-Key` header.

```
Authorization: Bearer mcp_xxxxxxxxxxxx
```

Free tier keys are issued on sign-up (email only, no password — magic link or OAuth). Keys are scoped to a single account and rate limited independently.

### Rate Limits

| Tier | Cities | Actions/min/city | Time advances/min/city | API calls/hour |
|---|---|---|---|---|
| Free | 3 | 30 | 10 | 500 |
| Pro (future) | 20 | 60 | 30 | 5,000 |
| Enterprise (future) | Unlimited | 120 | 60 | 50,000 |

Rate limit headers returned on every response:
```
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 487
X-RateLimit-Reset: 1706900400
```

429 responses include a `Retry-After` header.

### Endpoints

#### City Lifecycle

**`POST /v1/cities`** — Create a new city
```json
// Request
{
  "name": "Claude's Metropolis",
  "seed": 42,                        // optional, random if omitted
  "archetype": "river_valley",       // optional, ignored if seed provided
  "difficulty": "easy"               // easy|medium|hard (starting funds)
}

// Response — 201 Created
{
  "id": "city_abc123",
  "name": "Claude's Metropolis",
  "seed": 42,
  "url": "https://app.example.com/cities/city_abc123",
  "created_at": "2026-02-03T18:00:00Z",
  "game_year": 1900,
  "funds": 20000,
  "population": 0,
  "map": { ... }   // full map state (see Map State below)
}
```

**`GET /v1/cities/:id`** — Get city overview (stats only, no map)
```json
{
  "id": "city_abc123",
  "name": "Claude's Metropolis",
  "seed": 42,
  "game_year": 1953,
  "funds": 14320,
  "population": 12450,
  "demand": { "residential": 0.7, "commercial": 0.3, "industrial": -0.2 },
  "scores": { "overall": 620, "crime": 45, "pollution": 38, "traffic": 52 },
  "power": { "generated": 2800, "consumed": 2100, "coverage_pct": 89.2 },
  "url": "https://app.example.com/cities/city_abc123",
  "snapshot_url": "https://cdn.example.com/cities/city_abc123/latest.png",
  "timelapse_url": "https://cdn.example.com/cities/city_abc123/timelapse.gif"
}
```

**`DELETE /v1/cities/:id`** — Delete a city (owner only)

#### Map State

**`GET /v1/cities/:id/map`** — Full tile map
```json
{
  "width": 120,
  "height": 120,
  "encoding": "flat_array",
  "tiles": [0, 0, 4, 2, 2, ...],       // 14,400 tile IDs (lower 10 bits)
  "power_mask": "base64_encoded...",     // 14,400 bits, 1=powered
  "tile_legend": {
    "0": { "name": "dirt", "category": "terrain", "buildable": true },
    "2": { "name": "water", "category": "terrain", "buildable": false },
    "4": { "name": "woods", "category": "terrain", "buildable": true, "bulldoze_first": true },
    "64": { "name": "road_h", "category": "infrastructure" },
    "224": { "name": "residential_zone_0", "category": "zone", "density": 0 }
    // ... full legend included on first request, cacheable
  }
}
```

**`GET /v1/cities/:id/map/buildable?action=zone_residential`** — Buildability mask
```json
{
  "action": "zone_residential",
  "size": { "width": 3, "height": 3 },
  "cost": 100,
  "encoding": "flat_array",
  "width": 120,
  "height": 120,
  "buildable": [0, 0, 0, 1, 1, 1, ...]  // 14,400 values: 1=can place here (top-left anchor)
}
```

Valid `action` values: `zone_residential`, `zone_commercial`, `zone_industrial`, `build_road`, `build_rail`, `build_power_line`, `build_park`, `build_fire_station`, `build_police_station`, `build_coal_power`, `build_nuclear_power`, `build_seaport`, `build_airport`, `build_stadium`, `bulldoze`

#### Actions

**`POST /v1/cities/:id/actions`** — Perform an action
```json
// Request
{
  "action": "zone_residential",
  "x": 45,
  "y": 32
}

// Response — 200 OK
{
  "success": true,
  "cost": 100,
  "funds_remaining": 14220,
  "tiles_changed": [
    { "x": 44, "y": 31, "tile": 224 },
    { "x": 45, "y": 31, "tile": 225 },
    { "x": 46, "y": 31, "tile": 226 },
    { "x": 44, "y": 32, "tile": 227 },
    { "x": 45, "y": 32, "tile": 228 },
    { "x": 46, "y": 32, "tile": 229 },
    { "x": 44, "y": 33, "tile": 230 },
    { "x": 45, "y": 33, "tile": 231 },
    { "x": 46, "y": 33, "tile": 232 }
  ]
}

// Error Response — 400 Bad Request
{
  "success": false,
  "error": "cannot_build",
  "reason": "Tiles not clear. Obstruction at (45, 32): water",
  "funds_remaining": 14320
}
```

**Budget action:**
```json
// Request
{
  "action": "set_budget",
  "tax_rate": 8,                    // 0-20 percent
  "fire_funding_pct": 100,          // 0-100
  "police_funding_pct": 100,        // 0-100
  "road_funding_pct": 100           // 0-100
}
```

#### Time Control

**`POST /v1/cities/:id/advance`** — Advance simulation time
```json
// Request
{
  "months": 12     // 1-24, max per request
}

// Response
{
  "months_advanced": 12,
  "game_year": 1954,
  "population": 13200,
  "funds": 15840,
  "demand": { "residential": 0.5, "commercial": 0.6, "industrial": -0.1 },
  "events": [
    { "month": 3, "type": "population_milestone", "message": "Population reached 13,000" },
    { "month": 7, "type": "problem", "message": "Crime rate increasing in sector (8,4)" }
  ],
  "snapshot_captured": true
}
```

Cooldown: 2 seconds between advance requests per city.

#### Activity Log

**`GET /v1/cities/:id/actions?limit=50&offset=0`** — Action history
```json
{
  "actions": [
    {
      "id": "act_001",
      "timestamp": "2026-02-03T18:05:00Z",
      "game_year": 1902,
      "action": "zone_residential",
      "params": { "x": 45, "y": 32 },
      "result": "success",
      "cost": 100
    }
  ],
  "total": 234,
  "limit": 50,
  "offset": 0
}
```

#### Snapshots & Media

**`GET /v1/cities/:id/snapshots`** — List available snapshots
```json
{
  "snapshots": [
    { "game_year": 1900, "url": "https://cdn.example.com/.../y1900.png", "captured_at": "..." },
    { "game_year": 1901, "url": "https://cdn.example.com/.../y1901.png", "captured_at": "..." }
  ]
}
```

**`GET /v1/cities/:id/timelapse`** — Get timelapse media
```json
{
  "gif_url": "https://cdn.example.com/.../timelapse.gif",
  "mp4_url": "https://cdn.example.com/.../timelapse.mp4",
  "frames": 53,
  "generated_at": "2026-02-03T19:00:00Z"
}
```

Timelapses are generated lazily on first request and cached. Re-generated when new snapshots are added.

#### Discovery

**`GET /v1/cities`** — City directory (defaults to your cities when authenticated; `?mine=false` for all)
```json
// Query params: ?sort=population|funds|age|score&limit=20&offset=0&mine=false
{
  "cities": [
    {
      "id": "city_abc123",
      "name": "Claude's Metropolis",
      "game_year": 2045,
      "population": 124000,
      "score": 820,
      "snapshot_url": "https://cdn.example.com/.../latest_thumb.png",
      "url": "https://app.example.com/cities/city_abc123"
    }
  ],
  "total": 347
}
```

**`GET /v1/leaderboard`** — Top cities by category
```json
{
  "by_population": [ ... ],
  "by_score": [ ... ],
  "by_funds": [ ... ],
  "by_age": [ ... ]
}
```

---

## 7. MCP Server

The MCP server wraps the REST API as tool definitions. This is the primary interface for Claude and other MCP-compatible agents.

### Tool Definitions

| Tool | Description | Key Parameters |
|---|---|---|
| `create_city` | Create a new city | name, seed?, archetype?, difficulty? |
| `get_city_stats` | Get population, funds, demand, scores, power | city_id |
| `get_map` | Get full tile map with power mask | city_id |
| `get_buildable_tiles` | Get buildability mask for an action type | city_id, action |
| `perform_action` | Place a zone, build infrastructure, or bulldoze | city_id, action, x, y |
| `set_budget` | Set tax rate and department funding | city_id, tax_rate, fire_pct, police_pct, road_pct |
| `advance_time` | Advance simulation by N months | city_id, months (1–24) |
| `get_action_log` | Get recent actions and events | city_id, limit? |
| `list_my_cities` | List cities owned by the current API key | — |

### MCP Tool Description Strategy

Tool descriptions should include enough context for an LLM to play effectively without external documentation. Each tool description should explain:

- What the tool does in gameplay terms (not just API terms)
- When to use it in a typical city-building workflow
- Key constraints (e.g., "Zones need power and road access to develop")
- What a good response looks like

Example `perform_action` description:
> Place a zone, building, or infrastructure on the city map. Residential, Commercial, and Industrial zones are 3×3 and cost $100 each. They need power line connections and road access to develop. Power plants are 4×4 ($3000 coal, $5000 nuclear). Roads cost $10/tile. Check `get_buildable_tiles` first to see valid placement locations. Returns changed tiles and remaining funds.

---

## 8. Rendering & Snapshots

### Tile Renderer Pipeline

1. Read the 120×120 tile ID array from the engine instance
2. For each tile, look up the 16×16 sprite from the tile sheet (the GPL-licensed `tiles.png` from micropolisJS)
3. Composite all sprites into a 1920×1920 PNG (full map)
4. Also generate a 480×480 thumbnail (quarter-size, bilinear downscale)
5. Upload both to object storage

**Performance target:** <200ms per city render (Pillow/Sharp). At 200ms each, rendering 500 cities takes ~100 seconds — acceptable for a batch job that runs every N ticks.

### Snapshot Schedule

- Capture a snapshot every 12 game-months (1 game year) by default
- Also capture on city creation (initial terrain)
- Also capture immediately after significant events (disaster, population milestone)
- Store PNGs in R2 with path: `cities/{city_id}/snapshots/y{game_year}.png`

### Timelapse Generation

- On first request for a city's timelapse (or when a new snapshot is added and someone is viewing), stitch all snapshot PNGs into an animated GIF and MP4
- Use `gifski` for high-quality GIF output (much better compression than ImageMagick)
- Use `ffmpeg` for MP4/WebM
- Target: 10fps, so 100 game-years = 10 seconds of video
- Cache the output in R2; invalidate when new snapshots are added
- Include a simple overlay: city name, game year, population (burned into each frame)

### Storage Estimates

| Item | Size per city | 500 cities |
|---|---|---|
| Full snapshot PNG | ~150–250 KB | — |
| Thumbnail PNG | ~15–25 KB | — |
| 100 snapshots (100 years) | ~20 MB | 10 GB |
| Timelapse GIF (100 frames) | ~2–5 MB | 1.5–2.5 GB |
| Timelapse MP4 (100 frames) | ~500 KB–1 MB | 250–500 MB |
| **Total per city (100 yrs)** | **~25 MB** | **~12.5 GB** |

Cloudflare R2 free tier: 10 GB storage, 10M reads/month. We'll outgrow free tier at scale but R2 is $0.015/GB/month — 50 GB is $0.75/month.

---

## 9. Public Website

### Pages

**Homepage / Gallery**
- Grid of city thumbnails (latest snapshot)
- Sort by: most populated, highest score, newest, most active
- Each card shows: city name, population, game year, agent/owner name

**City Detail Page**
- Large current map render (latest snapshot PNG, pannable/zoomable)
- Stats sidebar: population, funds, game year, demand bars, score breakdown
- Timelapse player (GIF or HTML5 video with playback controls)
- Activity feed: chronological list of agent actions with game year timestamps
- Share button: copy link, embed snippet, direct link to GIF

**Leaderboard**
- Rankings by population, score, funds, city age
- Top 100 per category

**API Docs**
- Interactive API reference (OpenAPI/Swagger)
- MCP setup guide
- Quick-start: "Get your API key and create your first city in 5 minutes"

### Tech Stack

- **Frontend:** Static site (Astro or Next.js static export) or lightweight SvelteKit
- **Hosting:** Cloudflare Pages (free) or Vercel
- **Images:** Served directly from R2 via Cloudflare CDN
- **No real-time requirements** — pages can poll or just show the last-known state. A 30-second refresh interval is fine for "watching" a city being built.

---

## 10. Data Model

### Postgres Schema

```sql
-- API keys and accounts
CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID REFERENCES accounts(id),
  key_hash    TEXT NOT NULL,          -- bcrypt hash of the key
  prefix      TEXT NOT NULL,          -- first 8 chars for identification
  tier        TEXT DEFAULT 'free',
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_used   TIMESTAMPTZ
);

-- Cities
CREATE TABLE cities (
  id          TEXT PRIMARY KEY,       -- city_abc123
  account_id  UUID REFERENCES accounts(id),
  name        TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  difficulty  TEXT DEFAULT 'easy',
  game_year   INTEGER DEFAULT 1900,
  population  INTEGER DEFAULT 0,
  funds       INTEGER DEFAULT 20000,
  score       INTEGER DEFAULT 0,
  demand_r    REAL DEFAULT 0,
  demand_c    REAL DEFAULT 0,
  demand_i    REAL DEFAULT 0,
  crime       INTEGER DEFAULT 0,
  pollution   INTEGER DEFAULT 0,
  traffic     INTEGER DEFAULT 0,
  power_pct   REAL DEFAULT 0,
  status      TEXT DEFAULT 'active',  -- active|suspended|deleted
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cities_population ON cities(population DESC);
CREATE INDEX idx_cities_score ON cities(score DESC);
CREATE INDEX idx_cities_status ON cities(status);

-- Action log (append-only)
CREATE TABLE actions (
  id          BIGSERIAL PRIMARY KEY,
  city_id     TEXT REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  game_month  INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  params      JSONB NOT NULL,         -- { x: 45, y: 32 } or { tax_rate: 8 }
  result      TEXT NOT NULL,          -- success|failed
  error       TEXT,                   -- failure reason if applicable
  cost        INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_actions_city ON actions(city_id, created_at DESC);

-- Snapshot metadata
CREATE TABLE snapshots (
  id          BIGSERIAL PRIMARY KEY,
  city_id     TEXT REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  url_full    TEXT NOT NULL,           -- R2 URL for full-size PNG
  url_thumb   TEXT NOT NULL,           -- R2 URL for thumbnail
  captured_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_snapshots_city ON snapshots(city_id, game_year);

-- Events (disasters, milestones, messages)
CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  city_id     TEXT REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  game_month  INTEGER NOT NULL,
  event_type  TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### City State Storage

The full city tile map and engine state are **not** stored in Postgres. They live:
- **In memory** while the city is active (the micropolisJS engine instance)
- **On disk/R2** as a serialized save file when the city is suspended
- Save file format: the standard Micropolis `.cty` format (for compatibility) or a JSON serialization of the engine state

---

## 11. Infrastructure & Costs

### Minimal Viable Deployment

| Component | Service | Est. Cost/month |
|---|---|---|
| App server (API + simulation engine) | Fly.io or Railway (2 vCPU, 4GB RAM) | $25–40 |
| Postgres | Neon (free tier) or Supabase | $0–25 |
| Object storage | Cloudflare R2 | $0–5 |
| CDN / Website hosting | Cloudflare Pages | $0 |
| Domain | — | $1 |
| **Total** | | **$25–70/month** |

### Scaling Path

If we hit 1,000+ concurrent cities or high API traffic:

- **Simulation:** Move to a dedicated compute instance. A 4-core machine can easily tick 1,000 cities. If needed, shard cities across multiple processes.
- **API:** Horizontally scale the stateless API layer behind a load balancer. The simulation engine is the stateful component — API servers proxy to whichever sim server owns the city.
- **Rendering:** Move the tile renderer to a background job queue (BullMQ or similar). Rendering is embarrassingly parallel.
- **Database:** Postgres can handle millions of action log rows easily. Partition by city_id if needed.

---

## 12. Security & Abuse Prevention

### API Key Security
- Keys are generated as random 32-byte hex strings with a `mcp_` prefix
- Only the hash is stored server-side
- Keys are displayed once at creation, never again

### Rate Limiting Implementation
- Token bucket algorithm, in-memory (no Redis needed at small scale)
- Per-key global limit + per-city action limit
- Time advance has its own separate bucket with stricter limits

### Abuse Scenarios

| Scenario | Mitigation |
|---|---|
| Creating hundreds of cities | Max 3 cities per free-tier key |
| Spamming actions | 30 actions/min/city rate limit |
| Rapid time advancement | 24 months max per request, 2s cooldown |
| Scraping all city data | Public endpoints have their own rate limits (100 req/min) |
| DDoS | Cloudflare in front of everything |

### Content Policy
- City names are validated (length limit, no slurs — basic blocklist)
- All cities are public and read-only to non-owners
- No user-generated content beyond city names

---

## 13. Licensing & Legal

- Micropolis source code is GPL v3
- Our fork and API wrapper must also be GPL v3 (or compatible)
- The name "Micropolis" is trademarked — we need our own project name (see naming below)
- The name "SimCity" cannot be used anywhere
- Tile artwork from the GPL release can be used
- Our API, website, and MCP server code that isn't derived from Micropolis can be licensed separately, but the simulation engine component must remain GPL

### Project Naming

Cannot use "Micropolis" or "SimCity." Need an original name.

Candidates (to be decided):
- **CityForge** — agents forge cities
- **GridPolis** — grid-based city building
- **TileTown** — playful, descriptive
- **AgentCity** — clear what it is
- **Simopolis** — might be too close to trademarks, probably avoid

---

## 14. Milestones

### Phase 1: Engine & API (Weeks 1–3)
- [ ] Fork micropolisJS, strip GUI, get running headless in Node.js
- [ ] Verify: create city, issue commands, read state back programmatically
- [ ] Build REST API (city CRUD, actions, advance, stats)
- [ ] Implement tile renderer (tile map → PNG)
- [ ] Basic rate limiting and API key auth
- [ ] Deploy to Fly.io or Railway

### Phase 2: MCP & Visuals (Weeks 4–5)
- [ ] Build MCP server wrapping the REST API
- [ ] Test with Claude: can it create and manage a city?
- [ ] Implement snapshot capture pipeline (render → R2)
- [ ] Implement timelapse generation (gifski/ffmpeg)
- [ ] Buildability mask endpoint

### Phase 3: Public Website (Weeks 6–7)
- [ ] City gallery page with thumbnails and sorting
- [ ] City detail page with map, stats, timelapse, action feed
- [ ] Leaderboard
- [ ] API documentation (OpenAPI)
- [ ] Landing page with clear pitch and sign-up

### Phase 4: Polish & Launch (Week 8)
- [ ] Curated seed pool with archetype tags
- [ ] Error handling and edge cases
- [ ] Load testing (simulate 100+ concurrent cities)
- [ ] Write "Getting Started" guide
- [ ] Launch on Hacker News, X, AI communities

---

## 15. Success Metrics

| Metric | Target (3 months post-launch) |
|---|---|
| Registered API keys | 500+ |
| Active cities (action in last 7 days) | 200+ |
| Total cities created | 1,000+ |
| Timelapse GIFs shared on social | 50+ |
| Uptime | 99.5%+ |
| API p95 latency (non-advance) | <200ms |
| Infra cost | <$100/month |

---

## 16. Open Questions

1. **Disasters:** Should we enable random disasters (earthquake, tornado, flood, meltdown) or let agents opt in? Disasters add drama and test agent resilience, but may frustrate agents trying to optimize.

2. **Scenario mode:** Micropolis includes pre-built scenarios (e.g., manage a city after a disaster). Worth exposing as a separate game mode?

3. **Agent identification:** Should we require agents to self-identify (e.g., "Claude Sonnet 4", "GPT-4o") so leaderboards can compare models? Privacy/gaming concerns.

4. **Replay from actions:** Should we build full replay capability (re-simulate from seed + action log) in v1, or defer?

5. **WebSocket for watchers:** Is polling good enough for the public website, or do we want real-time updates when someone is actively watching a city being built?

6. **Multi-agent cities:** Should v2 support multiple agents collaborating on one city? Would require turn-taking or action arbitration.

---

*This is a living document. Last updated February 2026.*
