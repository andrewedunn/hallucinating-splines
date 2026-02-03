# Micropolis API Platform - PRD

## Vision

A public API and MCP server for playing SimCity Classic (Micropolis), enabling:
- **Anyone** to build SimCity bots via REST API
- **Any LLM** to play SimCity via MCP (Model Context Protocol)
- **Hundreds of concurrent games** with minimal server resources
- **9 AI Mayors Competition** as the flagship demo

## Why micropolisJS?

The [micropolisJS](https://github.com/graememcc/micropolisJS) port is ideal:

| Feature | Benefit |
|---------|--------|
| Pure JavaScript/TypeScript | Runs in Node.js, no JVM/native deps |
| ES Modules | Clean imports, tree-shakeable |
| Simulation separate from UI | `Simulation` class is headless-ready |
| Save/Load built-in | Game state is serializable JSON |
| Active, maintained | Recent commits, modern tooling |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Public API Gateway                          │
│                         (Node.js + Express)                         │
├─────────────────────────────────────────────────────────────────────┤
│  REST API (port 8000)              │  MCP Server (stdio/SSE)        │
│  POST /games         → new game    │  create_game()                 │
│  GET  /games/:id     → state       │  get_state(id)                 │
│  POST /games/:id/place → build     │  place(id, tool, x, y)         │
│  POST /games/:id/tick  → simulate  │  tick(id, count)               │
│  GET  /games/:id/map   → tiles     │  get_map(id, x, y, w, h)       │
│  DELETE /games/:id   → end game    │  end_game(id)                  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Game Manager                                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  In-Memory Game Pool (Map<sessionId, GameInstance>)         │    │
│  │                                                             │    │
│  │  game_abc123: { simulation, map, lastAccess, owner }       │    │
│  │  game_def456: { simulation, map, lastAccess, owner }       │    │
│  │  game_ghi789: { simulation, map, lastAccess, owner }       │    │
│  │  ... hundreds of games in single process ...               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  • Idle cleanup: games unused for 30min get archived               │
│  • Memory limit: ~500 concurrent games per GB RAM                  │
│  • State persistence: Redis or SQLite for resume                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     micropolisJS Core (modified)                    │
│                                                                     │
│  GameMap ──► Simulation ──► Census/Budget/Valves                   │
│      │            │                                                 │
│      │            └──► simTick() - advance one frame               │
│      │                                                              │
│      └──► getTile(x,y) / setTile(x,y,value)                        │
│                                                                     │
│  Removed: jQuery, Canvas, DOM, Sprites (UI), Input handling        │
│  Kept: Simulation, GameMap, all game logic                         │
└─────────────────────────────────────────────────────────────────────┘
```

## API Design

### REST Endpoints

```
POST /api/v1/games
  Body: { "mapType": "random" | "flat", "difficulty": 0|1|2, "seed": 12345 }
  Returns: { "gameId": "abc123", "state": {...} }

GET /api/v1/games/:id
  Returns: { 
    "year": 1900, 
    "funds": 20000,
    "population": 0,
    "residential": { "demand": 100, "zones": 0 },
    "commercial": { "demand": 50, "zones": 0 },
    "industrial": { "demand": 100, "zones": 0 },
    "crimeRate": 0,
    "pollutionLevel": 0,
    "landValue": 0,
    "isPowered": false
  }

POST /api/v1/games/:id/place
  Body: { "tool": "RESIDENTIAL", "x": 50, "y": 50 }
  Returns: { "success": true, "cost": 100, "newFunds": 19900 }

POST /api/v1/games/:id/tick
  Body: { "count": 48 }  // 48 ticks = 1 year
  Returns: { "state": {...}, "events": ["Population grew to 100"] }

DELETE /api/v1/games/:id
  Returns: { "success": true, "finalPopulation": 5000 }
```


### Map Data Endpoints

The map is 120×100 = 12,000 tiles. Multiple access patterns for efficiency:

#### Full Map (initial load, save/restore)
```
GET /api/v1/games/:id/map/full
  Returns: {
    "width": 120,
    "height": 100,
    "tiles": [[0,0,21,21,0,...], [0,2,2,2,0,...], ...],
    "legend": {
      "0": "empty", "2-20": "water", "21-43": "trees",
      "44-47": "rubble", "64-79": "road", ...
    }
  }
```
~50-100KB JSON. Use sparingly.

#### Semantic Summary (best for LLM decision-making)
```
GET /api/v1/games/:id/map/summary
  Returns: {
    "terrain": {
      "water": [[5,10], [5,11], [6,10], ...],
      "trees": {"count": 342, "sample": [[20,15], [21,15], ...]}
    },
    "buildings": [
      {"type": "POWERPLANT", "x": 50, "y": 50, "powered": true},
      {"type": "RESIDENTIAL", "x": 55, "y": 50, "powered": true, "density": 3},
      {"type": "COMMERCIAL", "x": 58, "y": 50, "powered": false, "density": 1}
    ],
    "infrastructure": {
      "roads": [[52,50], [53,50], ...],
      "rails": [],
      "powerLines": [[54,50], [54,51], ...]
    },
    "analysis": {
      "emptyTiles": 8420,
      "poweredTiles": 156,
      "unpoweredBuildings": 2,
      "buildableBlocks": [
        {"x": 2, "y": 2, "size": "11x11"},
        {"x": 13, "y": 2, "size": "11x11"},
        {"x": 24, "y": 2, "size": "11x11"}
      ]
    }
  }
```
This is what LLMs want - semantic info, not raw tiles.

#### Region Query (before placing buildings)
```
GET /api/v1/games/:id/map/region?x=40&y=40&w=15&h=15
  Returns: {
    "x": 40, "y": 40, "width": 15, "height": 15,
    "tiles": [[0,0,0,...], ...],
    "decoded": [
      {"x": 42, "y": 41, "type": "road"},
      {"x": 43, "y": 41, "type": "road"}
    ],
    "buildable": true,
    "hasWater": false,
    "needsBulldoze": ["trees at 40,40", "trees at 40,41"]
  }
```

#### Single Tile (quick checks)
```
GET /api/v1/games/:id/tile?x=50&y=50
  Returns: {
    "x": 50, "y": 50,
    "value": 0,
    "type": "empty",
    "buildable": true,
    "powered": false,
    "landValue": 0,
    "pollution": 0,
    "crime": 0
  }
```

#### Power Grid
```
GET /api/v1/games/:id/map/power
  Returns: {
    "plants": [{"x": 50, "y": 50, "type": "coal", "active": true}],
    "poweredZones": 45,
    "unpoweredZones": 3,
    "unpoweredLocations": [{"x": 80, "y": 60, "type": "RESIDENTIAL"}],
    "gridConnectivity": "connected | fragmented"
  }
```

### Recommended Usage Pattern for LLM Mayors

```
1. CREATE GAME
   POST /games -> get gameId

2. INITIAL SCAN (once)
   GET /games/:id/map/summary -> find water, plan strategy

3. EACH DECISION CYCLE
   GET /games/:id -> check funds, population, RCI demand
   GET /games/:id/map/summary -> see buildable areas, power status
   
4. BEFORE BUILDING
   GET /games/:id/map/region?x=...&y=...&w=15&h=15 -> verify area is clear
   POST /games/:id/place -> build

5. ADVANCE TIME
   POST /games/:id/tick -> simulate, get new state

6. REPEAT 3-5 until end condition
```
### MCP Tools

```typescript
// Tool definitions for MCP server
const tools = [
  {
    name: "create_game",
    description: "Start a new SimCity game",
    inputSchema: {
      type: "object",
      properties: {
        difficulty: { type: "number", enum: [0, 1, 2], description: "0=easy, 1=medium, 2=hard" },
        seed: { type: "number", description: "Random seed for map generation" }
      }
    }
  },
  {
    name: "get_state", 
    description: "Get current city state: population, funds, year, RCI demand",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string", required: true }
      }
    }
  },
  {
    name: "place",
    description: "Place a building or zone. Tools: RESIDENTIAL (3x3, $100), COMMERCIAL (3x3, $100), INDUSTRIAL (3x3, $100), POWERPLANT (4x4, $3000), ROAD (1x1, $10), WIRE (1x1, $5), RAIL (1x1, $20), POLICE (3x3, $500), FIRE (3x3, $500), STADIUM (4x4, $5000), SEAPORT (4x4, $3000), AIRPORT (6x6, $10000), PARK (1x1, $10), BULLDOZER (1x1, $1)",
    inputSchema: {
      type: "object", 
      properties: {
        gameId: { type: "string", required: true },
        tool: { type: "string", required: true },
        x: { type: "number", required: true },
        y: { type: "number", required: true }
      }
    }
  },
  {
    name: "tick",
    description: "Advance simulation by N ticks (48 ticks = 1 year)",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string", required: true },
        count: { type: "number", default: 48 }
      }
    }
  },
  {
    name: "get_map_region",
    description: "Get tile data for a region of the map",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string", required: true },
        x: { type: "number", default: 0 },
        y: { type: "number", default: 0 },
        width: { type: "number", default: 120 },
        height: { type: "number", default: 100 }
      }
    }
  },
  {
    name: "set_tax_rate",
    description: "Set city tax rate (0-20%)",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string", required: true },
        rate: { type: "number", minimum: 0, maximum: 20 }
      }
    }
  },
  {
    name: "end_game",
    description: "End game and get final stats",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string", required: true }
      }
    }
  }
];
```

## micropolisJS Modifications

Changes needed to make it headless/server-ready:

### 1. Extract Core Modules

```
src/
├── core/           # Keep these (game logic)
│   ├── simulation.js
│   ├── gameMap.js
│   ├── census.js
│   ├── budget.js
│   ├── valves.js
│   ├── powerManager.js
│   ├── traffic.js
│   ├── residential.js
│   ├── commercial.js
│   ├── industrial.js
│   └── ... (all simulation logic)
│
├── tools/          # Keep these (building placement)
│   ├── baseTool.js
│   ├── buildingTool.js
│   ├── roadTool.js
│   └── bulldozerTool.js
│
└── ui/             # Remove these (browser-only)
    ├── game.js
    ├── gameCanvas.js
    ├── inputStatus.js
    └── ... (all UI code)
```

### 2. Create Headless Game Class

```javascript
// headlessGame.js
import { GameMap } from './core/gameMap.js';
import { Simulation } from './core/simulation.js';
import { MapGenerator } from './core/mapGenerator.js';
import { BuildingTool } from './tools/buildingTool.js';

export class HeadlessGame {
  constructor(options = {}) {
    this.map = new GameMap(120, 100);
    if (options.seed) {
      MapGenerator.generate(this.map, options.seed);
    }
    this.simulation = new Simulation(
      this.map, 
      options.difficulty || 0,
      Simulation.SPEED_FAST
    );
    this.tools = this._initTools();
  }

  getState() {
    return {
      year: this.simulation._startingYear + Math.floor(this.simulation._cityTime / 48),
      funds: this.simulation.budget.totalFunds,
      population: this.simulation._census.totalPop,
      resDemand: this.simulation._valves.resValve,
      comDemand: this.simulation._valves.comValve,
      indDemand: this.simulation._valves.indValve,
      crimeRate: this.simulation._census.crimeAverage,
      pollution: this.simulation._census.pollutionAverage,
      landValue: this.simulation._census.landValueAverage
    };
  }

  place(tool, x, y) {
    const t = this.tools[tool];
    if (!t) return { success: false, error: 'Unknown tool' };
    const result = t.doTool(x, y);
    return { success: result.success, cost: result.cost };
  }

  tick(count = 1) {
    for (let i = 0; i < count; i++) {
      this.simulation.simTick();
    }
    return this.getState();
  }

  getTiles(x, y, w, h) {
    const tiles = [];
    for (let row = y; row < y + h; row++) {
      const rowData = [];
      for (let col = x; col < x + w; col++) {
        rowData.push(this.map.getTileValue(col, row));
      }
      tiles.push(rowData);
    }
    return tiles;
  }

  save() {
    const data = {};
    this.simulation.save(data);
    return data;
  }

  load(data) {
    this.simulation.load(data);
  }
}
```

### 3. Remove jQuery Dependency

The core simulation doesn't use jQuery - it's only in UI code. The headless version won't need it.

## Scaling Strategy

### Memory Budget

```
Per game:
  GameMap: 120 × 100 × 8 bytes ≈ 96 KB
  Simulation state: ~50 KB
  Block maps: ~200 KB
  Total: ~350 KB per game

1 GB RAM = ~2,800 concurrent games (theoretical)
Practical with overhead: ~500-1000 concurrent games
```

### Deployment Options

| Platform | Concurrent Games | Cost | Notes |
|----------|-----------------|------|-------|
| exe.dev (current) | 50-100 | Free | Good for dev/demo |
| Fly.io (1GB) | 500 | ~$5/mo | Auto-sleep, easy deploy |
| Railway | 500 | ~$5/mo | Similar to Fly |
| Render | 500 | Free tier | Cold starts |
| AWS Lambda | Unlimited* | Pay per request | Needs state in Redis |
| Cloudflare Workers | Unlimited* | $5/mo | WASM, Durable Objects |

*With external state storage

### Stateless Mode (for serverless)

```javascript
// Client sends full state with each request
POST /api/v1/tick
Body: {
  "state": { /* full serialized game state */ },
  "action": { "type": "tick", "count": 48 }
}
Returns: {
  "state": { /* new game state */ },
  "result": { ... }
}
```

This enables true serverless - no server state needed.

## 9 Mayors Competition (Flagship Demo)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Mayors Competition Dashboard                  │
│  ┌─────────┬─────────┬─────────┐                                │
│  │ Mayor 1 │ Mayor 2 │ Mayor 3 │  Each mayor:                   │
│  │  🏙️ 5.2k │  🏙️ 3.1k │  🏙️ 7.8k │  - Has own game via API       │
│  ├─────────┼─────────┼─────────┤  - Writes Python strategy      │
│  │ Mayor 4 │ Mayor 5 │ Mayor 6 │  - Iterates based on results   │
│  │  🏙️ 2.0k │  🏙️ 6.5k │  🏙️ 4.2k │  - Competes for best city     │
│  ├─────────┼─────────┼─────────┤                                │
│  │ Mayor 7 │ Mayor 8 │ Mayor 9 │  Uses same public API that     │
│  │  🏙️ 8.1k │  🏙️ 1.5k │  🏙️ 5.9k │  anyone can use!              │
│  └─────────┴─────────┴─────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Headless Core (Week 1)
- [ ] Fork micropolisJS
- [ ] Extract simulation core, remove UI dependencies
- [ ] Create `HeadlessGame` class
- [ ] Write tests for core gameplay
- [ ] Basic CLI to verify it works

### Phase 2: REST API (Week 1-2)
- [ ] Express server with game manager
- [ ] Session management (create/get/delete games)
- [ ] All CRUD endpoints
- [ ] Rate limiting, auth tokens
- [ ] Deploy to Fly.io or Railway

### Phase 3: MCP Server (Week 2)
- [ ] MCP protocol implementation
- [ ] All tools mirroring REST API
- [ ] Test with Claude Desktop
- [ ] Documentation for MCP setup

### Phase 4: Competition Dashboard (Week 2-3)
- [ ] 3x3 grid live view
- [ ] Mayor orchestrator (spawns 9 LLM agents)
- [ ] Leaderboard and history
- [ ] Public demo site

### Phase 5: Polish & Scale (Week 3+)
- [ ] Screenshot rendering (server-side canvas or tile sprites)
- [ ] Stateless mode for serverless
- [ ] Strategy guide / docs for players
- [ ] Landing page, examples

## Success Metrics

1. **API**: 100+ external games played via API
2. **MCP**: Working with Claude, GPT, other MCP clients
3. **Scale**: Handle 100 concurrent games without degradation
4. **Competition**: Clear winner among 9 mayors, reproducible strategy
5. **Community**: At least 5 people build bots using the API

## Open Questions

1. **Screenshot rendering**: Canvas on server (node-canvas) or send tile data and let client render?
2. **Authentication**: API keys? Rate limit by IP? OAuth?
3. **Persistence**: How long to keep inactive games? Archive to S3?
4. **Leaderboard**: Global leaderboard across all API users?

## Appendix: SimCity Mechanics Quick Reference

### Building Costs
| Building | Size | Cost |
|----------|------|------|
| Residential | 3×3 | $100 |
| Commercial | 3×3 | $100 |
| Industrial | 3×3 | $100 |
| Road | 1×1 | $10 |
| Power Line | 1×1 | $5 |
| Rail | 1×1 | $20 |
| Police | 3×3 | $500 |
| Fire Station | 3×3 | $500 |
| Power Plant | 4×4 | $3,000 |
| Nuclear | 4×4 | $5,000 |
| Stadium | 4×4 | $5,000 |
| Seaport | 4×4 | $3,000 |
| Airport | 6×6 | $10,000 |
| Park | 1×1 | $10 |

### Key Mechanics
- **48 ticks = 1 year**
- **RCI Demand**: Positive = build more, negative = oversupply
- **Power**: Zones must connect to power plant via adjacent powered tiles
- **Growth**: Zones need road access, power, and demand
- **Budget**: Tax income monthly, expenses for services
- **Caps**: Stadium (resCap), Airport (comCap), Seaport (indCap) unlock growth

### Map Size
- **120 × 100 tiles**
- Tile 0 = empty land
- Tiles 2-20 = water (unbuildable)
- Tiles 21-43 = trees (bulldozable)
