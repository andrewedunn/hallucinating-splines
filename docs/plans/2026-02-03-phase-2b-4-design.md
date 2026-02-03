# Phase 2b + 4: API Enhancements & Public Website

## Goal

Complete the API with all remaining features (auto-infrastructure, snapshots, leaderboard, city lifecycle, rate limiting) and build the public website with canvas-rendered city maps, history scrubber, and leaderboard.

## What's Included

### API (Phase 2b)

- R2 snapshot storage (tile data saved on every advance call)
- Snapshot list + retrieval endpoints
- Auto-infrastructure helpers (auto_bulldoze, auto_power, auto_road) with BFS pathfinding
- Semantic map summary endpoint
- Buildability mask endpoint
- Leaderboard endpoint
- Action logging + action history endpoint
- City lifecycle (bankruptcy detection, inactivity cron)
- Per-city rate limiting (actions/min, advances/min)
- Seed curation (~50 seeds with terrain metadata)
- D1 migration for snapshots and actions tables

### Website (Phase 4)

- Astro project on Cloudflare Pages
- Canvas tile renderer using Micropolis sprite sheet (pan, zoom)
- Homepage / gallery with city cards
- City detail page: live map, stats panel, history scrubber
- Mayor profile pages
- Leaderboard page
- API documentation page

## What's Deferred

- MCP server (Phase 3 — next)
- API key expiry enforcement
- Action replay from seed + action log
- WebSocket live updates for watchers
- Social preview images (OpenGraph)

## Architecture

```
site/                     # Astro (Cloudflare Pages)
│   Fetches data from ──→ worker/ API
│   Renders tiles client-side via <canvas>
│
worker/                   # Cloudflare Workers API (existing)
│   New: R2 snapshots, auto-infra, summary, buildable, leaderboard
│   New: action logging, rate limiting, bankruptcy, cron
│
R2 bucket                 # Tile snapshots
│   snapshots/{city_id}/{game_year}.json
```

The website is a separate Astro project (`site/`) deployed to Cloudflare Pages. It fetches all data from the existing Workers API. No SSR — all rendering is client-side. The tile renderer composites the GPL sprite sheet onto a `<canvas>` element.

## R2 Snapshots

Every `POST /v1/cities/:id/advance` saves a snapshot to R2 after ticking.

R2 key: `snapshots/{city_id}/{game_year}.json`

Snapshot payload (~30KB):
```json
{
  "city_id": "city_abc123",
  "game_year": 1905,
  "population": 1200,
  "funds": 15400,
  "score": 180,
  "tiles": [0, 0, 4, 2, ...]
}
```

D1 metadata table tracks what's available without hitting R2.

New endpoints:
- `GET /v1/cities/:id/snapshots` — list from D1 (game_year, population, funds)
- `GET /v1/cities/:id/snapshots/:game_year` — full tile data from R2

wrangler.toml addition:
```toml
[[r2_buckets]]
binding = "SNAPSHOTS"
bucket_name = "hallucinating-splines-snapshots"
```

## Auto-Infrastructure Helpers

Optional flags on `POST /v1/cities/:id/actions`:

- `auto_bulldoze: true` — clear trees/rubble in footprint before building ($1/tile)
- `auto_power: true` — BFS from placed building to nearest powered tile, lay power lines along path
- `auto_road: true` — BFS from placed building to nearest road tile, lay road tiles along path

Pathfinding: BFS on tile grid, 4-directional, only traversing buildable land. Max 50 tiles of path. If no path found, the auto flag is skipped and noted in the response.

Response gains `auto_actions` array:
```json
{
  "success": true,
  "cost": 145,
  "funds_remaining": 14175,
  "auto_actions": [
    { "type": "bulldoze", "tiles": [[45,32]], "cost": 1 },
    { "type": "power_line", "path": [[46,31], [47,31]], "cost": 10 },
    { "type": "road", "path": [[45,34], [45,35]], "cost": 20 }
  ]
}
```

Code lives in `worker/src/autoInfra.ts`.

## Semantic Map Summary

`GET /v1/cities/:id/map/summary` — analyzes tile data for LLMs:

```json
{
  "terrain": { "water_tiles": 1240, "tree_tiles": 342, "empty_tiles": 8420 },
  "buildings": [
    { "type": "coal_power", "x": 50, "y": 50, "powered": true }
  ],
  "infrastructure": { "road_tiles": 89, "rail_tiles": 0, "power_line_tiles": 34 },
  "analysis": {
    "unpowered_buildings": 2,
    "unroaded_zones": 1,
    "largest_empty_area": { "x": 20, "y": 30, "approx_size": "15x12" }
  }
}
```

Iterates tile array, classifies by tile value, detects multi-tile buildings by anchor tiles, checks power status. New RPC method on CityDO.

## Buildability Mask

`GET /v1/cities/:id/map/buildable?action=zone_residential`

Returns up to 200 sampled valid positions plus total count. Iterates the grid checking if the tool's footprint fits on clear land. New RPC method on CityDO.

## City Lifecycle

**Bankruptcy:** Funds in Micropolis are clamped to $0 (never negative). Track `zeroFundsMonths` counter in DO storage. Incremented each game month at $0, reset when funds > 0. At 12 consecutive months → city status `ended`, reason `bankruptcy`.

**Inactivity:** Cron Trigger runs daily. Queries D1 for active cities where `updated_at < datetime('now', '-14 days')`. Marks them `ended` with reason `inactivity`.

```toml
[triggers]
crons = ["0 0 * * *"]
```

## Rate Limiting

Per-city limits tracked in the DO (rolling window of timestamps):
- 30 actions/minute per city
- 10 advances/minute per city

Returns 429 with `Retry-After` header when exceeded.

## Leaderboard

`GET /v1/leaderboard` — D1 aggregate queries:

```json
{
  "cities": {
    "by_population": [...top 50...],
    "by_score": [...top 50...]
  },
  "mayors": {
    "by_best_population": [...top 50...],
    "by_total_cities": [...top 50...]
  }
}
```

## Seed Curation

Local script generates maps from seeds 1-10000, analyzes water%, buildable%, terrain type. Picks ~50 good seeds with variety. Outputs JSON that the seeds endpoint serves.

Terrain classification heuristics: water concentration on edges = coastal, river through middle = river_valley, low water = landlocked.

## D1 Migration (0002)

```sql
CREATE TABLE snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id    TEXT NOT NULL REFERENCES cities(id),
  game_year  INTEGER NOT NULL,
  r2_key     TEXT NOT NULL,
  population INTEGER,
  funds      INTEGER,
  created_at TEXT DEFAULT (datetime())
);
CREATE INDEX idx_snapshots_city ON snapshots(city_id, game_year);

CREATE TABLE actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id     TEXT NOT NULL REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  params      TEXT NOT NULL,
  result      TEXT NOT NULL,
  cost        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime())
);
CREATE INDEX idx_actions_city ON actions(city_id, created_at DESC);
```

## Website Structure

```
site/
├── src/
│   ├── layouts/
│   │   └── Base.astro
│   ├── pages/
│   │   ├── index.astro            # Homepage / gallery
│   │   ├── cities/[id].astro      # City detail
│   │   ├── mayors/[id].astro      # Mayor profile
│   │   ├── leaderboard.astro
│   │   └── docs.astro             # API docs
│   ├── components/
│   │   ├── CityCard.astro
│   │   ├── MapViewer.tsx          # Canvas renderer (React island)
│   │   ├── HistoryScrubber.tsx    # Timeline slider (React island)
│   │   ├── StatsPanel.astro
│   │   └── Nav.astro
│   ├── lib/
│   │   ├── api.ts                 # Fetch wrapper
│   │   ├── tileRenderer.ts        # Canvas rendering logic
│   │   └── sprites.ts             # Sprite sheet → tile ID mapping
│   └── styles/
│       └── global.css
├── public/
│   ├── tiles.png                  # Micropolis sprite sheet (GPL)
│   └── favicon.svg
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

## Tile Renderer

Renders 120x100 grid of 16x16 sprites onto canvas.

- Tile ID: `rawValue & 0x3FF` (lower 10 bits, strip flags)
- Sprite lookup: tile ID indexes into sprite sheet grid
- Full map: 1920x1600px, scaled to fit container
- Pan via mouse drag, zoom via scroll (fit-to-view, 1:1, 2x)
- Redraw all tiles on snapshot change (<50ms for 12K sprites)

Sprite sheet layout needs verification against upstream `tiles.png`.

## Implementation Order

1. D1 migration + R2 bucket setup
2. R2 snapshot saving in advance endpoint
3. Snapshot list + retrieval endpoints
4. Auto-infrastructure helpers (autoInfra.ts)
5. Semantic map summary endpoint
6. Buildability mask endpoint
7. Action logging in action/advance endpoints + history endpoint
8. City lifecycle (bankruptcy in DO, inactivity cron)
9. Per-city rate limiting in DO
10. Leaderboard endpoint
11. Seed curation script
12. Astro project scaffold + Cloudflare Pages setup
13. Tile renderer (canvas + sprite sheet)
14. Homepage / gallery
15. City detail page (map, stats, history scrubber)
16. Mayor profile page
17. Leaderboard page
18. API docs page
19. Deploy website + redeploy API
20. End-to-end smoke test
