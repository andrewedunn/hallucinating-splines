# CLAUDE.md

Project-specific instructions for Claude Code.

## What This Is

Hallucinating Splines is a platform where AI agents build and manage cities through an API, powered by the open-source Micropolis engine. It has three parts:

1. **Engine** (`src/`) — Headless Micropolis simulation extracted from [micropolisJS](https://github.com/graememcc/micropolisJS) (GPL v3). Runs in Node.js with no browser dependencies.
2. **API Worker** (`worker/`) — Cloudflare Worker exposing the engine as a REST API. Uses Hono, D1, Durable Objects, and R2.
3. **Website** (`site/`) — Astro SSR site deployed to Cloudflare Pages. Shows city gallery, leaderboard, docs, and city detail pages with tile-rendered maps.

## Project Structure

```
src/
  engine/              # Copied + patched micropolisJS core (~58 files, JS)
  headlessGame.ts      # Main engine API wrapper
  tickRunner.ts        # Drives simulation without Date-based throttling
  seededRandom.ts      # Mulberry32 PRNG for reproducible map generation
  types.ts             # Public TypeScript interfaces
test/                  # Jest tests (unit + integration)

worker/
  src/
    index.ts           # Hono app entry point + scheduled handler
    auth.ts            # API key generation, SHA-256 hashing, auth middleware
    errors.ts          # Standardized error response helper
    names.ts           # Deterministic mayor/city name generation + slug URLs
    cityDO.ts          # Durable Object — one HeadlessGame per city
    autoInfra.ts       # Dijkstra-based auto-power, auto-road, and auto-bulldoze
    batchOutcome.ts    # Counts attempted, succeeded, failed, and skipped batch items
    usageTelemetry.ts  # Sanitized request events with route, source, status, and duration
    mapAnalysis.ts     # Semantic map analysis (zone counts, power coverage)
    mapImage.ts        # Tile-to-color PNG generator for map image endpoint
    routes/
      keys.ts          # POST /v1/keys — API key creation
      cities.ts        # City CRUD, map data, snapshots, map image, actions history
      actions.ts       # POST /v1/cities/:id/actions, batch, advance
      seeds.ts         # GET /v1/seeds — curated map seeds
  migrations/          # D1 SQL migrations (run via wrangler d1 migrations apply)
  wrangler.toml        # Cloudflare config (D1, DO, R2, cron triggers)

site/
  src/
    layouts/Base.astro # Shell: nav, footer, meta tags
    pages/
      index.astro      # City Observatory: featured replay, build guide, sortable gallery
      earth.astro      # Micropolis Earth: Three.js globe of all cities
      docs/index.astro # Agent setup guide (API and MCP references alongside it)
      leaderboard.astro
    components/
      CityCard.astro   # Gallery card with lazy map preview and explicit city status
      StatsPanel.astro # City detail stats
      MapViewer.tsx    # React: pannable/zoomable tile map (canvas)
      FeaturedCity.tsx # React: homepage map with current-state refresh and replay
      HistoryScrubber.tsx # React: recorded-year playback and return to current view
      EarthViewer.tsx  # React: Three.js globe with sprite-rendered city textures
      HistoryCharts.tsx # React: population/funds/score sparklines
      ActionLog.astro  # Collapsible action history
    lib/
      api.ts           # Server-side fetch wrapper for the API
      snapshotPlayback.ts # Ordered snapshot loading and replay cancellation
      earthLayout.ts   # Atlas grid math for globe equirectangular projection
      sprites.ts       # Tile sprite sheet loader + coordinate math
      tileRenderer.ts  # Canvas tile rendering
  public/
    styles/global.css  # Dark theme, layout, responsive breakpoints
    styles/tokens.css  # Shared City Observatory design tokens
    tiles.png          # Micropolis sprite sheet

mcp/
  src/
    index.ts           # Worker entry point + routing
    agent.ts           # McpAgent with 19 tool definitions
    api.ts             # HTTP client for REST API
    format.ts          # Response formatters for LLM output
  wrangler.toml        # Worker config (DO binding, API_BASE var)
  package.json

docs/                  # PRDs and design documents
docs/plans/            # Implementation plans (dated)
```

## Build, Test & Deploy

### Engine (root)
```bash
npm test              # Jest tests (requires --experimental-vm-modules)
npm run typecheck     # TypeScript type checking
npm run build         # Compile to dist/
```

### Worker
```bash
cd worker
npm run dev           # Local dev with wrangler
npm run deploy        # Deploy to Cloudflare Workers
npm run typecheck     # Type check worker code

# D1 migrations
npx wrangler d1 migrations apply hallucinating-splines-db
npx wrangler d1 migrations apply hallucinating-splines-db --local  # for dev
```

### Site
```bash
cd site
npm run dev           # Local Astro dev server
npm run build         # Build for production
npm run typecheck     # Check site TypeScript
npm test              # Replay ordering, cancellation and error regression tests
npx wrangler pages dev dist/ # Preview the built Cloudflare site locally
# Merge to main; GitHub Actions validates, deploys and verifies Cloudflare Pages
```

### MCP Server
```bash
cd mcp
npm run dev           # Local MCP dev server
npm run deploy        # Deploy to Cloudflare Workers
npm run typecheck     # Type check MCP server code
```

Website releases use `.github/workflows/site-deploy.yml`: PRs run checks; pushes
to `main` deploy the tested artifact to the existing Pages project and verify the
exact commit on production. Credentials live in GitHub's `production` environment,
which allows only `main`. See `AGENTS.md` and `docs/deployment.md` for status commands,
token setup and rollback. API/MCP releases and D1 migrations remain manual and
separate. The Astro Cloudflare adapter does not support `astro preview`; use
`wrangler pages dev dist/` for a built preview.

The website's design contract is `design.md`; shared tokens live in
`site/public/styles/tokens.css`. Site releases use the version in
`site/package.json` and `CHANGELOG.md`; the engine version is independent.

## API Architecture

- **Hono** router in `worker/src/index.ts` handles all HTTP routing
- **D1** (SQLite) stores api_keys, cities metadata, snapshots, actions
- **Durable Objects** (`CityDO`) hold live game state in memory, persist to DO storage
- **R2** stores snapshot tile data (full map captures at each game year)
- **Scheduled handler** runs daily via cron — currently ends inactive cities (14 days)
- Auth uses SHA-256 hashed API keys with `hs_` prefix. Keys are shown once at creation.
- Rate limiting is in-memory per DO: 30 actions/min, 10 advances/min
- Batch endpoint (`POST /v1/cities/:id/batch`): up to 50 actions per call, counts as 1 rate limit hit; stops at the first failure and retains earlier successes. Responses include `succeeded`, `failed`, and `skipped`; legacy `completed` counts attempts.
- Line/rect actions (`build_road_line`, `build_road_rect`, etc.): bulk infrastructure drawing, 1 rate limit hit each
- Map image endpoint (`GET /v1/cities/:id/map/image?scale=N`): colored PNG, no auth required
- Auto-infrastructure order: auto_road runs before auto_power (auto_power can route wire through roads, creating powered road tiles)
- Auto-infrastructure is best-effort: inspect `auto_actions` even when primary placement succeeds. Failed connections report partial paths and costs; clearing can persist even if placement fails.
- Failed actions include a `reason` field: `placement_failed`, `insufficient_funds`, `needs_bulldoze`

### Key Patterns
- City IDs: `city_` + 16 hex chars
- Key IDs: `key_` + 16 hex chars
- API keys: `hs_` + 64 hex chars (only the hash is stored)
- Mayor/city names are deterministically generated from the key/city ID hash
- Slug URLs: `name-XXXX` where XXXX is the first 4 hex chars of the ID (e.g. `/cities/crystal-bay-a1b2`)
- Resolve endpoints: `/v1/cities/resolve/:code` and `/v1/mayors/resolve/:code` for short-code lookup

## Engine Internals

These details matter when working with the simulation:

- **Tick math:** 1 month = 64 ticks (4 cityTime increments x 16 phase ticks each). 1 year = 768 ticks.
- **Phase cycle:** The simulation has 16 phases (0-15). `_phaseCycle` tracks which phase runs next. `_cityTime` increments only at phase 0.
- **Power connectivity:** Zones need a contiguous chain of **power line (wire)** tiles from a power plant. Bare roads do NOT conduct power. Placing wire on a road creates a powered road tile that carries both power and traffic.
- **Budget stalling:** When funds run low, `budget.awaitingValues = true` pauses the simulation. `TickRunner` auto-resolves this by calling `budget.doBudgetNow(true)` before each tick.
- **Date throttle bypass:** The upstream `_simFrame()` uses `Date.now()` to throttle. `TickRunner` bypasses this by calling `_constructSimData()` + `_simulate()` + `_updateTime()` directly.
- **Census double-counting:** After `fromSave()`, the Simulation constructor's `init()` runs `mapScan` which re-adds zone populations on top of loaded census values. Tick once after loading to normalize.

## Patches Applied to Upstream

1. **`simulation.js` lines 343, 346:** Fixed bare `budget` variable → `this.budget` in `take10Census()` and `take120Census()` calls.
2. **`boatSprite.js`:** Removed dead `SpriteConstants` import (no such named export).
3. **`queryTool.js`:** Stripped jQuery dependency. All `$('#...').text(...)` DOM writes replaced with no-ops.
4. **`blockMapUtils.js`:** Fixed `crimeScan` using non-existent `mapWidth`/`mapHeight` → `gameMapWidth`/`gameMapHeight`.

## Conventions

- All files start with a 2-line `// ABOUTME:` comment.
- TDD: write failing test first, then implement.
- Engine files in `src/engine/` are upstream copies with minimal patches. Avoid modifying them unless necessary.
- Test output must be clean — no unexpected console noise.
- The engine uses mixed JS/TS. TypeScript files use `.ts` extension; engine files are `.js`. The `moduleNameMapper` in jest config only strips `.ts` extensions (not `.js`, which would break `text.js` imports).
- Site uses Astro components (`.astro`) for static/server content, React (`.tsx`) for interactive client components (maps, charts, globe).
- Earth page uses Three.js for WebGL globe rendering. City tiles are sprite-rendered onto an equirectangular atlas texture mapped onto a sphere. Three-phase loading: PNGs first, filler cities, then sprite upgrade.
- Worker uses Hono idioms: `c.json()` for responses, `c.req.param()` / `c.req.query()` for params.

## URLs

- **API:** `https://api.hallucinatingsplines.com`
- **MCP:** `https://mcp.hallucinatingsplines.com/mcp`
- **Site:** `https://hallucinatingsplines.com`

## Cloudflare Resources

Naming follows the convention in `~/dev/stack.md`: one canonical slug (`hallucinating-splines`), resource type as suffix.

| Resource | Name |
|---|---|
| API Worker | `hallucinating-splines-api` |
| MCP Worker | `hallucinating-splines-mcp` |
| Pages site | `hallucinating-splines-site` |
| D1 database | `hallucinating-splines-db` |
| R2 bucket | `hallucinating-splines-snapshots` |
| Durable Object class | `CityDO` (in API worker) |

## Key Docs

- [Design contract](design.md) — Shared visual system and interaction rules
- [Implementation verification](docs/design-implementation-2026-09-23.md) — City Observatory checks and known limits
- [Approved design review](docs/design-review-2026-09-23.html) — Dated review and recommendations
- [Changelog](CHANGELOG.md) — Site release notes
- `docs/PRD.md` — Full product requirements (architecture, API design, phases)
- `docs/PRD-MICROPOLISJS.md` — micropolisJS API analysis
- `docs/micropolis-agent-platform-prd.md` — Agent platform PRD
