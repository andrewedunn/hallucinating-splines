# Phase 3: MCP Server Implementation Plan

Implemented 2026-02-03 on branch `feat/mcp-server`.

## Architecture

Separate Cloudflare Worker at `mcp.hallucinatingsplines.com` using the `agents` npm package (Cloudflare's McpAgent Durable Object) + `@modelcontextprotocol/sdk`. Calls the existing REST API at `api.hallucinatingsplines.com` over HTTP. API key passed via `?key=hs_xxx` URL query parameter.

## Files Created

- `mcp/package.json` — Dependencies: agents, zod, wrangler
- `mcp/wrangler.toml` — Worker config with DO binding and custom domain route
- `mcp/tsconfig.json` — TypeScript config using generated runtime types
- `mcp/src/index.ts` — Worker entry point, extracts ?key= and routes to McpAgent DO
- `mcp/src/agent.ts` — HallucinatingSplinesMCP extending McpAgent with 11 tools
- `mcp/src/api.ts` — HTTP client for REST API with Bearer auth
- `mcp/src/format.ts` — Response formatters for LLM-readable output

## Files Modified

- `worker/src/routes/cities.ts` — Added ?mine=true query param filter
- `worker/src/routes/docs.ts` — Added MCP section to API docs markdown
- `site/src/pages/docs/mcp.astro` — Replaced "Coming Soon" with full MCP docs
- `site/src/pages/docs/index.astro` — Replaced "Coming Soon" panels with setup instructions
- `CLAUDE.md` — Added MCP to project structure, build commands, and URLs

## 11 MCP Tools

1. create_city — Start a new city
2. list_seeds — Browse curated map seeds
3. get_city_stats — Population, funds, year, demand, budget
4. get_map_summary — Building counts, infrastructure, problems
5. get_map_region — Tile-level map inspection
6. get_buildable — Valid placement positions for actions
7. perform_action — Place zones, buildings, infrastructure
8. set_budget — Tax rate and department funding
9. advance_time — Advance 1-24 months
10. get_action_log — Recent actions and results
11. list_my_cities — Cities belonging to your API key
