// ABOUTME: MCP agent with 18 city-building tools for the Hallucinating Splines platform.
// ABOUTME: Extends McpAgent (Cloudflare Durable Object) and wraps the REST API.

import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiClient } from './api';
import {
  formatCreateCity,
  formatSeeds,
  formatCityStats,
  formatMapSummary,
  formatMapRegion,
  formatBuildable,
  formatActionResult,
  formatLineRectResult,
  formatBatchResult,
  formatBudgetResult,
  formatAdvanceResult,
  formatActionLog,
  formatCityList,
  formatRetireCity,
  formatDemand,
  formatCensusHistory,
} from './format';

interface Props extends Record<string, unknown> {
  key?: string;
}

const AGENT_PLAYBOOK = `# Hallucinating Splines — Agent Playbook

A guide for AI agents building cities via the MCP tools. Goal: maximize population and score.

## 1. The Game Loop

Each turn:
1. **Read state** — \`get_city_stats\` for population, funds, demand (RCI), score, problems
2. **Plan** — Check what has positive demand; identify problems (crime, traffic, pollution)
3. **Build** — Use \`perform_action\` to zone/build. Always set \`auto_road: true\` and \`auto_power: true\`
4. **Advance** — Use \`advance_time\` (1–24 months). Start with 1–2 months, scale up once stable
5. **Repeat** — Check stats again, react to what changed

Available actions: zone_residential, zone_commercial, zone_industrial, build_road, build_rail, build_power_line, build_coal_power, build_nuclear_power, build_fire_station, build_police_station, build_park, build_seaport, build_airport, build_stadium, bulldoze.

**Efficiency tools:**
- \`batch_actions\` — up to 50 actions in one call (1 rate limit hit). Great for placing multiple zones or roads.
- \`build_line\` — draw a line of road/rail/wire between two points (e.g., build_road_line from (30,44) to (30,55)).
- \`build_rect\` — draw a rectangular outline of road/rail/wire (e.g., build_road_rect at (28,42) size 10×8).
- \`get_map_image\` — get a colored PNG URL of the city layout for visual inspection.

Use \`get_buildable\` to find valid positions. Use \`get_map_summary\` to see what's built and where problems are.

## 2. Population Formula

\`\`\`
population = (resPop + (comPop + indPop) × 8) × 20
\`\`\`

Commercial and industrial count 8× residential per zone. Balanced R/C/I growth matters more than spamming residential. Follow the demand indicators from \`get_city_stats\`.

## 3. Score Formula

Score runs 0–1000 and is calculated each tick in this exact order:

**Step 1 — Problem severity (0–1000 base):**
Sum 7 problem scores, divide by 3, convert: \`base = (250 − min(sum/3, 250)) × 4\`

The 7 problems:
| Problem | Formula |
|---|---|
| Crime | crimeAverage |
| Pollution | pollutionAverage |
| Housing costs | landValueAverage × 0.7 |
| Taxes | cityTax × 10 |
| Traffic | (trafficTotal / count) × 2.4 |
| Unemployment | ratio of resPop to (comPop + indPop) × 8 |
| Fire | min(firePop × 5, 255) |

**Step 2 — Demand cap penalties (×0.85 each):**
If residential, commercial, or industrial zones are capped (not enough built to meet demand), each applies a 15% penalty.

**Step 3 — Infrastructure effectiveness:**
- Roads: direct subtraction if underfunded (\`score -= maxRoadEffect − actualRoadEffect\`)
- Police: multiplier 0.9–1.0 based on funding
- Fire dept: multiplier 0.9–1.0 based on funding

**Step 4 — Oversupply penalties (×0.85 each):**
If demand valve < −1000 for any zone type, 15% penalty each.

**Step 5 — Population growth scaling:**
- Growing city: score scaled up proportional to growth rate
- Shrinking city: penalty capped at ~5%
- Stagnant: no change

**Step 6 — Fire & tax subtraction:**
\`score -= fireSeverity − cityTax\`

**Step 7 — Power coverage:**
\`score *= poweredZones / totalZones\`

**Step 8 — Clamp & smooth:**
Clamp to 0–1000, then average with previous score: \`finalScore = (oldScore + newScore) / 2\`

**Key insight:** Score smoothing means steady improvement beats volatile swings. One bad year drags you down for multiple turns.

## 4. City Design Principles

- **Check terrain first.** Call \`get_map_summary\` to see the terrain grid before planning your layout. Water tiles (~) cannot be zoned. Roads built on water become expensive bridges ($50 each). Always build on land (.) tiles and stay away from coast (/) edges.
- **Power is non-negotiable.** Unpowered zones don't grow and tank your score via the power coverage ratio. One coal plant (~$3000) powers ~50 zones. Roads do NOT conduct power — you need wire (power line) tiles. Place wire on roads to create powered road tiles that carry both. A zone only needs ONE adjacent powered tile to receive power — do NOT run separate wires to each zone. One wire backbone along a road connecting back to the plant is enough for all adjacent zones.
- **Traffic kills.** It's weighted 2.4× in the problem formula. Build multiple commercial centers instead of one mega-center. Use roads to provide alternate routes.
- **Industrial pollutes.** Keep industry far from residential. Pollution is a direct problem score contributor.
- **Police are cheap crime prevention.** A $500 police station covers ~15 tile radius and directly reduces crime (a problem score factor).
- **Taxes are double-penalized.** cityTax × 10 in the problem table AND subtracted from score in step 6. Keep tax at 7% and adjust only when necessary.
- **Fund your services.** Road, police, and fire funding directly affect score via step 3. Keep them at 100% unless bankrupt.

## 5. Recommended Build Order

**Phase A — Bootstrap (years 0–5):**
1. Call \`get_map_summary\` and read the terrain grid — identify land (.) vs water (~) areas. ONLY build on land tiles.
2. Build a coal power plant on a large land area ($3000)
3. Build a road from the plant outward, then run wire along it with \`build_wire_line\` (creates powered road tiles)
3. Zone a small balanced cluster: 4R + 2C + 2I adjacent to the powered road
4. Zones only need ONE adjacent powered tile — don't wire each zone separately
5. Use \`auto_road: true\`, \`auto_bulldoze: true\` when placing zones
6. Advance 2 months at a time, check demand between advances
7. Build what has positive demand; stop zoning what's negative

**Phase B — Stabilize (years 5–20):**
1. Add a police station once crime appears in problems
2. Add a fire station when population reaches ~2000
3. Start a second neighborhood cluster (reduces traffic by splitting demand)
4. Use \`build_road_rect\` to lay out city blocks, then run \`build_wire_line\` along one road in the block to power it, then zone the interior with \`batch_actions\`
5. Sprinkle parks near residential to raise land value
6. Build alternate road connections between clusters with \`build_road_line\`

**Phase C — Scale (years 20+):**
1. Expand in pods: each pod = power access + R/C/I mix + road connections
2. Second power plant when zones start losing power
3. Consider seaport ($5000) and airport ($10000) for trade bonuses
4. Stadium ($3000) for happiness when population is high
5. Monitor score — if it's declining, diagnose via \`get_city_stats\` problems list

## 6. Agent Decision Heuristics

**Invariants (check every turn):**
- 100% power coverage (check unpowered count in map summary)
- All zones have road access (use auto_road)
- Never build into negative demand — check RCI demand first
- Keep funds above $1000 buffer

**Demand-driven zoning:**
- Positive R demand → zone_residential
- Positive C demand → zone_commercial
- Positive I demand → zone_industrial
- All negative → don't zone, advance time and wait

**Problem responses:**
- High crime → build police station near affected area
- High pollution → relocate/stop industrial near residential
- High traffic → build alternate routes, start new commercial center
- Housing costs high → more parks near residential, lower taxes
- Unemployment → more commercial and industrial zones
- Fire problems → build fire station

**Budget strategy:**
- Tax 7% is the sweet spot — don't change unless necessary
- If funds dropping: cut road funding to 80% before raising tax
- Never go below 50% on any department funding
- Raising tax above 10% is almost never worth the score hit
`;


function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

function errorResult(s: string) {
  return { content: [{ type: 'text' as const, text: s }], isError: true };
}

export class HallucinatingSplinesMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: 'Hallucinating Splines',
    version: '1.0.0',
  });

  private getApi(): ApiClient {
    const key = this.props?.key || '';
    const base = this.env.API_BASE || 'https://api.hallucinatingsplines.com';
    return new ApiClient(base, key);
  }

  async init() {
    const api = () => this.getApi();

    // 1. create_city
    this.server.tool(
      'create_city',
      `Start a new SimCity city. Returns city ID, name, and starting funds ($20,000).

Optional seed: pick from list_seeds for a specific terrain, or omit for random.

After creating a city, your first moves should be:
1. Build a coal power plant (build_coal_power, $3000, 4×4) — nothing works without power
2. Zone residential, commercial, and industrial near the power plant (3×3 each)
3. Use auto_road: true and auto_power: true flags to auto-connect infrastructure
4. Advance time (advance_time) to let the city grow

Each API key can have up to 3 active cities.`,
      { seed: z.number().optional().describe('Map seed for terrain generation. Use list_seeds to browse options.') },
      async ({ seed }) => {
        const body: Record<string, unknown> = {};
        if (seed !== undefined) body.seed = seed;
        const r = await api().post('/v1/cities', body);
        if (!r.ok) return errorResult(`Failed to create city: ${r.reason}`);
        return text(formatCreateCity(r.data as Record<string, unknown>));
      },
    );

    // 2. list_seeds
    this.server.tool(
      'list_seeds',
      `Browse curated map seeds with terrain metadata. Each seed produces a unique map with different water/land ratios and terrain features.

Pick a seed you like and pass it to create_city. If you want random terrain, skip this and create a city without a seed.`,
      {},
      async () => {
        const r = await api().get('/v1/seeds');
        if (!r.ok) return errorResult(`Failed to list seeds: ${r.reason}`);
        return text(formatSeeds(r.data as Record<string, unknown>));
      },
    );

    // 3. get_city_stats
    this.server.tool(
      'get_city_stats',
      `Get live stats for a city: population, funds, year, score, RCI demand, census, budget, and evaluation.

Check this BEFORE building to verify:
- You have enough funds for what you want to build
- Demand indicators show what the city needs (positive = city wants more of that zone type)
- Power status — unpowered zones don't grow
- Approval rating and city problems

The demand values are key: build what has positive demand.`,
      { city_id: z.string().describe('City ID (city_XXXX format)') },
      async ({ city_id }) => {
        const r = await api().get(`/v1/cities/${city_id}/stats`);
        if (!r.ok) return errorResult(`Failed to get stats: ${r.reason}`);
        return text(formatCityStats(r.data as Record<string, unknown>));
      },
    );

    // 4. get_map_summary
    this.server.tool(
      'get_map_summary',
      `Get a semantic overview of the city map: building counts by type, infrastructure totals, terrain breakdown, terrain grid, and problem analysis.

Use this to understand:
- Where land and water are (terrain grid: . = land, ~ = water, / = coast)
- What's already built (building counts by type)
- Infrastructure coverage (roads, rails, power lines)
- Problems (unpowered buildings, unroaded zones)
- Where to build next (largest empty area)

IMPORTANT: Always check the terrain grid BEFORE planning road layouts or zone placements. Only build on land (.) tiles.`,
      { city_id: z.string().describe('City ID') },
      async ({ city_id }) => {
        const r = await api().get(`/v1/cities/${city_id}/map/summary`);
        if (!r.ok) return errorResult(`Failed to get map summary: ${r.reason}`);
        return text(formatMapSummary(r.data as Record<string, unknown>));
      },
    );

    // 5. get_map_region
    this.server.tool(
      'get_map_region',
      `Inspect a rectangular area of the map at tile level. Returns raw tile IDs for each position.

Use this to check what's at specific coordinates before building — see if terrain is clear, check neighboring tiles, or verify placement worked.

The map is 120×100 tiles. Coordinates start at (0,0) in the top-left.`,
      {
        city_id: z.string().describe('City ID'),
        x: z.number().int().min(0).describe('Left column (0-119)'),
        y: z.number().int().min(0).describe('Top row (0-99)'),
        width: z.number().int().min(1).max(32).describe('Width in tiles (max 32)'),
        height: z.number().int().min(1).max(32).describe('Height in tiles (max 32)'),
      },
      async ({ city_id, x, y, width, height }) => {
        const r = await api().get(`/v1/cities/${city_id}/map/region?x=${x}&y=${y}&w=${width}&h=${height}`);
        if (!r.ok) return errorResult(`Failed to get map region: ${r.reason}`);
        return text(formatMapRegion(r.data as Record<string, unknown>));
      },
    );

    // 6. get_buildable
    this.server.tool(
      'get_buildable',
      `Find all valid placement positions for a specific action type. Returns coordinates where you can actually build.

Use this to find WHERE to place things. The API checks terrain, existing buildings, and space requirements.

Action types and their sizes/costs:
- zone_residential (3×3, $100) — houses, apartments
- zone_commercial (3×3, $100) — shops, offices
- zone_industrial (3×3, $100) — factories, warehouses
- build_road (1×1, $10) — roads for zone access
- build_rail (1×1, $20) — rail transport
- build_power_line (1×1, $5) — power distribution
- build_coal_power (4×4, $3000) — coal power plant
- build_nuclear_power (4×4, $5000) — nuclear power plant
- build_fire_station (3×3, $500) — reduces fire risk
- build_police_station (3×3, $500) — reduces crime
- build_park (1×1, $10) — raises land value
- build_seaport (4×4, $5000) — enables sea trade
- build_airport (6×6, $10000) — enables air trade
- build_stadium (4×4, $3000) — boosts happiness`,
      {
        city_id: z.string().describe('City ID'),
        action: z.string().describe('Action type (e.g., zone_residential, build_coal_power)'),
      },
      async ({ city_id, action }) => {
        const r = await api().get(`/v1/cities/${city_id}/map/buildable?action=${action}`);
        if (!r.ok) return errorResult(`Failed to get buildable positions: ${r.reason}`);
        return text(formatBuildable(r.data as Record<string, unknown>));
      },
    );

    // 7. perform_action
    this.server.tool(
      'perform_action',
      `Place a zone, building, or infrastructure tile on the map.

Action types and their sizes/costs:
- zone_residential (3×3, $100) — houses, apartments
- zone_commercial (3×3, $100) — shops, offices
- zone_industrial (3×3, $100) — factories, warehouses
- build_road (1×1, $10) — needed for zone access and growth
- build_rail (1×1, $20) — rail transport
- build_power_line (1×1, $5) — extends power grid
- build_coal_power (4×4, $3000) — 1 plant powers ~50 zones
- build_nuclear_power (4×4, $5000) — more power, meltdown risk
- build_fire_station (3×3, $500) — covers ~15 tile radius
- build_police_station (3×3, $500) — covers ~15 tile radius
- build_park (1×1, $10) — raises land value
- build_seaport (4×4, $5000) — sea trade (needs waterfront)
- build_airport (6×6, $10000) — air trade
- build_stadium (4×4, $3000) — boosts happiness
- bulldoze (1×1, $1) — clear rubble or demolish

IMPORTANT: Coordinates are CENTER-BASED for multi-tile buildings. A 3×3 zone at (10, 10) occupies (9-11, 9-11). A 4×4 plant at (10, 10) occupies (9-12, 9-12). Plan coordinates accordingly to avoid overlapping existing tiles.

IMPORTANT: Roads do NOT conduct power on their own. Power requires a contiguous chain of wire (power line) tiles from a power plant to the zone. Placing wire on a road creates a powered road tile that carries both power and traffic — this is the most efficient way to connect power.

A zone only needs ONE adjacent powered tile to receive power. Do NOT wire each zone individually — that wastes money. Instead, run a single wire backbone (e.g., build_wire_line along a road) connecting back to the power plant, and all zones adjacent to that powered road will receive power.

auto_power places a single wire adjacent to the zone but does NOT trace a full path back to the power plant. For reliable power, manually run a wire line from the plant along your main road.

Recommended flags for easier building:
- auto_bulldoze: true — clears rubble before placing
- auto_power: true — places one wire adjacent to zone (still need contiguous path to plant)
- auto_road: true — places one road adjacent to zone

Rate limit: 30 actions per minute per city.`,
      {
        city_id: z.string().describe('City ID'),
        action: z.string().describe('Action type (e.g., zone_residential, build_coal_power, bulldoze)'),
        x: z.number().int().min(0).describe('X coordinate (column, 0-119)'),
        y: z.number().int().min(0).describe('Y coordinate (row, 0-99)'),
        auto_bulldoze: z.boolean().optional().describe('Auto-clear rubble before placing'),
        auto_power: z.boolean().optional().describe('Auto-connect power lines to nearest grid'),
        auto_road: z.boolean().optional().describe('Auto-connect roads to nearest road'),
      },
      async ({ city_id, action, x, y, auto_bulldoze, auto_power, auto_road }) => {
        const body: Record<string, unknown> = { action, x, y };
        if (auto_bulldoze !== undefined) body.auto_bulldoze = auto_bulldoze;
        if (auto_power !== undefined) body.auto_power = auto_power;
        if (auto_road !== undefined) body.auto_road = auto_road;
        const r = await api().post(`/v1/cities/${city_id}/actions`, body);
        if (!r.ok) return errorResult(`Action failed: ${r.reason}`);
        return text(formatActionResult(r.data as Record<string, unknown>));
      },
    );

    // 8. batch_actions
    this.server.tool(
      'batch_actions',
      `Execute up to 50 actions in a single call. Counts as 1 action for rate limiting. Stops on first failure.

Use this for repetitive operations like laying a road grid, placing multiple zones, or any sequence of placements. Much more efficient than individual perform_action calls.

Each action in the batch supports the same action types and auto_* flags as perform_action.`,
      {
        city_id: z.string().describe('City ID'),
        actions: z.array(z.object({
          action: z.string().describe('Action type (e.g., build_road, zone_residential)'),
          x: z.number().int().describe('X coordinate'),
          y: z.number().int().describe('Y coordinate'),
          auto_bulldoze: z.boolean().optional().describe('Auto-clear rubble'),
          auto_power: z.boolean().optional().describe('Auto-connect power'),
          auto_road: z.boolean().optional().describe('Auto-connect roads'),
        })).min(1).max(50).describe('Array of actions to execute'),
      },
      async ({ city_id, actions: batchActions }) => {
        const r = await api().post(`/v1/cities/${city_id}/batch`, { actions: batchActions });
        if (!r.ok) return errorResult(`Batch failed: ${r.reason}`);
        return text(formatBatchResult(r.data as Record<string, unknown>));
      },
    );

    // 9. build_line
    this.server.tool(
      'build_line',
      `Draw a line of road, rail, or wire tiles between two points. Uses Bresenham line for diagonal support. Counts as 1 action for rate limiting.

Action types: build_road_line, build_rail_line, build_wire_line

Much faster than placing individual tiles. Use for road grids, power connections, and rail lines.`,
      {
        city_id: z.string().describe('City ID'),
        action: z.enum(['build_road_line', 'build_rail_line', 'build_wire_line']).describe('Line action type'),
        x1: z.number().int().min(0).describe('Start X coordinate'),
        y1: z.number().int().min(0).describe('Start Y coordinate'),
        x2: z.number().int().min(0).describe('End X coordinate'),
        y2: z.number().int().min(0).describe('End Y coordinate'),
      },
      async ({ city_id, action, x1, y1, x2, y2 }) => {
        const r = await api().post(`/v1/cities/${city_id}/actions`, { action, x1, y1, x2, y2 });
        if (!r.ok) return errorResult(`Line action failed: ${r.reason}`);
        return text(formatLineRectResult(r.data as Record<string, unknown>));
      },
    );

    // 10. build_rect
    this.server.tool(
      'build_rect',
      `Draw a rectangular outline of road, rail, or wire tiles. Only the outline is placed, not the interior.

Action types: build_road_rect, build_rail_rect, build_wire_rect

Great for laying out city blocks — draw a road rectangle, then zone the interior.`,
      {
        city_id: z.string().describe('City ID'),
        action: z.enum(['build_road_rect', 'build_rail_rect', 'build_wire_rect']).describe('Rectangle action type'),
        x: z.number().int().min(0).describe('Top-left X coordinate'),
        y: z.number().int().min(0).describe('Top-left Y coordinate'),
        width: z.number().int().min(2).max(120).describe('Width of rectangle'),
        height: z.number().int().min(2).max(100).describe('Height of rectangle'),
      },
      async ({ city_id, action, x, y, width, height }) => {
        const r = await api().post(`/v1/cities/${city_id}/actions`, { action, x, y, width, height });
        if (!r.ok) return errorResult(`Rect action failed: ${r.reason}`);
        return text(formatLineRectResult(r.data as Record<string, unknown>));
      },
    );

    // 11. set_budget
    this.server.tool(
      'set_budget',
      `Adjust tax rate and department funding. Tax rate affects growth and revenue. Department funding affects service quality.

- tax_rate: 0-20% (default 7%). Higher taxes = more revenue but slower growth. Below 7% encourages growth.
- road_percent: 0-100% (default 100%). Roads deteriorate without funding.
- fire_percent: 0-100% (default 100%). Lower funding = more fire risk.
- police_percent: 0-100% (default 100%). Lower funding = more crime.

Tip: Keep tax at 7% early on. Only raise it when you need more revenue for services.`,
      {
        city_id: z.string().describe('City ID'),
        tax_rate: z.number().int().min(0).max(20).optional().describe('Tax rate percentage (0-20)'),
        road_percent: z.number().int().min(0).max(100).optional().describe('Road department funding (0-100)'),
        fire_percent: z.number().int().min(0).max(100).optional().describe('Fire department funding (0-100)'),
        police_percent: z.number().int().min(0).max(100).optional().describe('Police department funding (0-100)'),
      },
      async ({ city_id, tax_rate, road_percent, fire_percent, police_percent }) => {
        const body: Record<string, unknown> = {};
        if (tax_rate !== undefined) body.tax_rate = tax_rate;
        if (road_percent !== undefined) body.road_percent = road_percent;
        if (fire_percent !== undefined) body.fire_percent = fire_percent;
        if (police_percent !== undefined) body.police_percent = police_percent;
        const r = await api().post(`/v1/cities/${city_id}/budget`, body);
        if (!r.ok) return errorResult(`Budget update failed: ${r.reason}`);
        return text(formatBudgetResult(r.data as Record<string, unknown>));
      },
    );

    // 9. advance_time
    this.server.tool(
      'advance_time',
      `Advance the simulation by 1-24 months. The city grows, collects taxes, and events happen during this time.

Start with 1-2 months early on to monitor growth closely. Once the city is stable, advance 6-12 months at a time.

Things that happen each month:
- Zones develop if powered, roaded, and in demand
- Tax revenue collected
- Service budgets deducted
- Population changes based on demand and city quality
- Random events (fires, floods, etc.) can occur
- Score updates based on city performance

The city ends if funds drop below -$10,000 (bankruptcy).

Rate limit: 10 advances per minute per city.`,
      {
        city_id: z.string().describe('City ID'),
        months: z.number().int().min(1).max(24).describe('Number of months to advance (1-24)'),
      },
      async ({ city_id, months }) => {
        const r = await api().post(`/v1/cities/${city_id}/advance`, { months });
        if (!r.ok) return errorResult(`Advance failed: ${r.reason}`);
        return text(formatAdvanceResult(r.data as Record<string, unknown>));
      },
    );

    // 10. get_action_log
    this.server.tool(
      'get_action_log',
      `View recent actions taken on a city. Shows what was built, where, whether it succeeded, and the cost.

Useful for reviewing what's been done and verifying actions worked.`,
      {
        city_id: z.string().describe('City ID'),
        limit: z.number().int().min(1).max(100).optional().describe('Number of actions to return (default 20, max 100)'),
      },
      async ({ city_id, limit }) => {
        const q = limit ? `?limit=${limit}` : '';
        const r = await api().get(`/v1/cities/${city_id}/actions${q}`);
        if (!r.ok) return errorResult(`Failed to get action log: ${r.reason}`);
        return text(formatActionLog(r.data as Record<string, unknown>));
      },
    );

    // 11. list_my_cities
    this.server.tool(
      'list_my_cities',
      `List all cities belonging to your API key. Shows name, population, year, score, and status for each city.

Use this to find your city IDs or check on multiple cities.`,
      {},
      async () => {
        const r = await api().get('/v1/cities?mine=true');
        if (!r.ok) return errorResult(`Failed to list cities: ${r.reason}`);
        return text(formatCityList(r.data as Record<string, unknown>));
      },
    );

    // 15. get_map_image
    this.server.tool(
      'get_map_image',
      `Get a URL for the city map as a colored PNG image. Each tile = 1 pixel, scaled up by the scale factor (1-8).

Colors: dirt=brown, water=blue, trees=green, roads=gray, power=yellow, residential=green, commercial=blue, industrial=amber, coal=gray, nuclear=purple, police=indigo, fire=red.

Use this to get a visual overview of the city layout.`,
      {
        city_id: z.string().describe('City ID'),
        scale: z.number().int().min(1).max(8).optional().describe('Pixel scale factor (default 1, max 8)'),
      },
      async ({ city_id, scale }) => {
        const baseUrl = this.env.API_BASE || 'https://api.hallucinatingsplines.com';
        const s = scale || 4;
        const url = `${baseUrl}/v1/cities/${city_id}/map/image?scale=${s}`;
        return text(`Map image URL: ${url}\n\nOpen this URL to view the city map as a colored PNG.`);
      },
    );

    // 16. retire_city
    this.server.tool(
      'retire_city',
      `Permanently retire an active city you own. The city stops simulating, but all history, snapshots, and action logs are preserved.

Use this when:
- A city is bankrupt or stagnating beyond recovery
- You want to free up a city slot (max 3 active cities per API key)
- You're done with a city and want to start fresh

This action cannot be undone.`,
      { city_id: z.string().describe('City ID to retire') },
      async ({ city_id }) => {
        const r = await api().del(`/v1/cities/${city_id}`);
        if (!r.ok) return errorResult(`Failed to retire city: ${r.reason}`);
        return text(formatRetireCity(r.data as Record<string, unknown>));
      },
    );

    // 17. get_demand
    this.server.tool(
      'get_demand',
      `Get current RCI (Residential/Commercial/Industrial) demand values for a city.

Positive demand means the city wants more of that zone type. Negative means oversupply.

This is the same demand data included in get_city_stats, but as a lightweight standalone call when you just need to check what to build next.`,
      { city_id: z.string().describe('City ID') },
      async ({ city_id }) => {
        const r = await api().get(`/v1/cities/${city_id}/demand`);
        if (!r.ok) return errorResult(`Failed to get demand: ${r.reason}`);
        return text(formatDemand(r.data as Record<string, unknown>));
      },
    );

    // 18. get_census_history
    this.server.tool(
      'get_census_history',
      `Get historical census data showing how a city has grown over time. Returns population, zone populations, funds, and score for each recorded year.

Use this to:
- Track population growth trends
- See if funds are trending up or down
- Identify when score started declining
- Compare zone balance over time`,
      { city_id: z.string().describe('City ID') },
      async ({ city_id }) => {
        const r = await api().get(`/v1/cities/${city_id}/history`);
        if (!r.ok) return errorResult(`Failed to get census history: ${r.reason}`);
        return text(formatCensusHistory(r.data as Record<string, unknown>));
      },
    );

    // Resource: Agent Playbook
    this.server.registerResource(
      'Agent Playbook',
      'hallucinating-splines://playbook',
      {
        description: 'Strategy guide for AI agents: how to maximize population and score in Hallucinating Splines.',
        mimeType: 'text/markdown',
      },
      () => ({
        contents: [
          {
            uri: 'hallucinating-splines://playbook',
            mimeType: 'text/markdown',
            text: AGENT_PLAYBOOK,
          },
        ],
      }),
    );
  }
}
