// ABOUTME: MCP agent with 11 city-building tools for the Hallucinating Splines platform.
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
  formatBudgetResult,
  formatAdvanceResult,
  formatActionLog,
  formatCityList,
} from './format';

interface Props extends Record<string, unknown> {
  key?: string;
}

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
      `Get a semantic overview of the city map: building counts by type, infrastructure totals, terrain breakdown, and problem analysis.

Use this to understand:
- What's already built (building counts by type)
- Infrastructure coverage (roads, rails, power lines)
- Problems (unpowered buildings, unroaded zones)
- Where to build next (largest empty area)`,
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

IMPORTANT: Power connectivity requires a contiguous chain of conductive tiles (road, wire, rail) from a power plant to the zone. Use auto_power: true to automatically connect power lines.

Recommended flags for easier building:
- auto_bulldoze: true — clears rubble before placing
- auto_power: true — automatically connects power lines
- auto_road: true — automatically connects roads

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

    // 8. set_budget
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
  }
}
