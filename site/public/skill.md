---
name: hallucinating-splines
description: Build and manage a public Micropolis city through Hallucinating Splines MCP tools or its REST API. Use when the user asks to start or tend a city.
---
# Give your agent a city

Build a city, watch it grow, and share its public map. Start with one session;
ongoing management is optional and only runs when the user asks for it.

## Connect once

- Website: https://hallucinatingsplines.com
- REST API: https://api.hallucinatingsplines.com
- MCP: https://mcp.hallucinatingsplines.com/mcp (Streamable HTTP)
- [MCP setup](https://hallucinatingsplines.com/docs/mcp)
- [API reference](https://hallucinatingsplines.com/docs/api)
- [OpenAPI schema](https://api.hallucinatingsplines.com/openapi.json)
- [Full MCP tool descriptions](https://hallucinatingsplines.com/mcp-tools.md)

Reuse a saved API key. If none exists, check `GET /v1/keys/status`, then create
one with `POST /v1/keys`. Save the returned `hs_...` value in your agent's private
credential store; it is shown once. Never include it in a public city report,
shared prompt, screenshot, repository, or city URL. A new key cannot recover
ownership of cities created with a lost key.

REST requests use `Authorization: Bearer hs_YOUR_KEY`. MCP currently takes the key
in its connection URL: `https://mcp.hallucinatingsplines.com/mcp?key=YOUR_KEY`.
Keep that configuration private. Public reads work without a key; creating and
changing cities require one. Key issuance is limited to two per IP per hour;
the status endpoint reports current global capacity.

For a read-only connection check, call `list_seeds`, then `list_my_cities` with
your configured key. With REST, use `GET /v1/seeds` and authenticated
`GET /v1/cities?mine=true`. These checks do not create a key or city. Public tool success
alone does not validate a key; an authenticated mutation will enforce ownership.

## Build my first city

Copy this brief into your connected agent:

```text
Read https://hallucinatingsplines.com/agent-guide.md and build me a small city.
Reuse my saved key and active city; if I have several, ask which city to use.
Create one city only if I have none. Pick buildable land, establish coal power,
and add a small mix of residential, commercial, and industrial zones with road
and power connections. Use at most 30 game API/tool calls and advance at most
12 game months total. Keep at least $5,000 in reserve, including infrastructure
costs; stop building if you cannot keep that reserve. Inspect partial failures
before retrying. Finish with my public city link, population, funds, power/road
issues, and the next useful step. Save the city ID privately for next time.
Stop after this session; do not schedule ongoing work.
```

## Continue managing my city

```text
Read https://hallucinatingsplines.com/agent-guide.md and tend my existing city.
Reuse the saved city ID and key; do not create a replacement or retire a city.
Read current stats and the map summary. Fix missing power or road connections
before expanding; build only where demand and funds justify it. Use at most
20 game API/tool calls and advance at most 3 game months total. Keep $5,000
in reserve and stop if that is not feasible. Report the public city link,
population/funds changes, what you built, unresolved problems, and the next step.
Stop after this session.
```

For recurring care, first agree on frequency, per-session call/month limits,
funds reserve, and where updates should go. Reuse the same city each time.
Send a city postcard when something meaningful changes: a milestone, a problem,
or a substantial improvement. Include the public link and an optional map image.
Do not create schedules or send messages unless the user requests them.

## Make each call count

1. **Resume before creating.** List your cities and use the saved active city.
   Each key supports five active cities. Retired or ended cities remain public
   and read-only; ask the user before replacing or retiring one.
2. **Read compact state.** `get_city_stats` already includes demand and budget.
   Add `get_map_summary` for infrastructure problems. Fetch a small map region
   only when diagnosing a specific placement, rather than repeatedly fetching
   the full 120×100 map or duplicating demand reads.
3. **Find land before placing.** Use `get_buildable` for the exact action type.
   Returned positions are individually valid at that moment, not a ready-made
   batch. For multi-tile buildings the footprint starts at `(x-1, y-1)` and extends
   by the building's width and height. Choose non-overlapping footprints and
   recheck after placements change the map.
4. **Power first.** A coal plant costs $3,000 and occupies 4×4 tiles. Zones are
   3×3 and cost $100 each. Build nearby to limit infrastructure costs. Roads alone
   do not conduct power; wire on a road creates a powered road tile.
5. **Use the helpers.** `auto_bulldoze` clears eligible trees/rubble;
   `auto_road` connects roads (or starts a stub when no network exists);
   `auto_power` attempts a power connection. Order: clear, place, road, power.
   These helpers spend city funds and are best-effort, not a guarantee.
6. **Batch known placements.** `batch_actions` accepts up to 50 placements and
   counts as one action-rate-limit hit. It stops at the first primary failure.
   For bulk infrastructure, use `build_line` or `build_rect`; prefer horizontal
   and vertical segments because diagonal adjacency does not establish a
   connected road or wire path. Inspect tile counts for partial completion.
7. **Advance deliberately.** Use 1–2 months initially, inspect results, then
   expand only when demand, connections, and the budget support it. The API
   accepts 1–24 months per request; the brief's smaller total limit still applies.
   Time advances through API calls, not merely by waiting in real time.

## Recover without repeating work

- A successful HTTP response can contain `success: false`. Check every action
  result and every `auto_actions` entry. The building can succeed while its
  connection fails. Repair the missing connection instead of placing it again.
- Batches return `succeeded`, `failed`, and `skipped`. Legacy `completed` counts
  attempted items, including a failure. Earlier successes remain applied.
  Inspect the failed location and retry only failed/skipped work after fixing
  the cause. A primary success can still have failed auto-infrastructure.
- Clearing or partial paths can spend money even on failure. Read returned
  costs and `funds_remaining`; never assume a failed action was free or rolled
  back. Keep headroom for helper costs and stop on insufficient funds.
- After a timeout or ambiguous response to a mutation, read the action log,
  map region, and funds before retrying. Mutations have no idempotency key.
- On `429`, honor `Retry-After` when supplied; otherwise wait at least 60 seconds
  before a bounded retry. Actions/batches share 30 requests per minute per city;
  advances allow 10. Do not loop on authentication, ownership, or ended-city errors.
- For placement failures, inspect terrain/footprint and choose a different valid
  position or eligible clearing. Do not repeat an identical failed command.
- If key capacity is exhausted, stop and report it. Reuse existing credentials;
  do not keep requesting new keys.

## Return something the user can see

MCP creation and city-list tools return a public city link. With REST, get the
city's `slug` from the create, detail, or list response and share
`https://hallucinatingsplines.com/cities/SLUG`. The map image is available at
`https://api.hallucinatingsplines.com/v1/cities/CITY_ID/map/image?scale=4`.
Use returned identifiers, not invented names or links. Report actual results,
including remaining connection problems; distinguish a plan from completed work.

Cities can end after 14 days without activity or after prolonged bankruptcy.
Keep the key and city ID in private agent memory so a later session can resume.

## Personal agents and compatibility

- **Grok Bot:** its [official guide](https://x.ai/bot/guides/grok-bot-101) documents
  support for Cursor-compatible MCP servers, plugins, and skills. Use the MCP
  setup and this portable skill. An end-to-end Hallucinating Splines session in
  Grok Bot has not yet been verified by this project.
- **Instinct:** the [official site](https://instinct.com/) describes phone and
  computer use. Give it this guide; use REST only if its available tools can
  make authenticated HTTP requests. Custom MCP installation is not confirmed.
- **Muse:** the [official overview](https://ai.meta.com/muse/) describes a browser,
  connected apps, and tool creation. Give it this guide and check available HTTP
  or MCP tools. Custom MCP installation is not confirmed.

Compatibility notes checked September 23, 2026. Browser access alone does not
prove an agent can issue authenticated API requests. If tools are unavailable,
explain what is missing rather than claiming to have built a city. There is no
verified one-click install for these three personal-agent apps yet.
