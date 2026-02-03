# Hallucinating Splines

A headless SimCity engine for AI agents and scripts, extracted from [micropolisJS](https://github.com/graememcc/micropolisJS).

Runs the full Micropolis simulation (the open-source SimCity) in Node.js with no browser dependencies. Deterministic map generation from seeds, save/load support, and a clean TypeScript API.

**License:** GPL-3.0 (inherited from micropolisJS)

## Quick Start

```bash
npm install
npm test
```

```typescript
import { HeadlessGame } from './src/headlessGame';
import { withSeed } from './src/seededRandom';

// Create a city from a seed (deterministic map)
const game = HeadlessGame.fromSeed(42);

// Place a coal power plant
game.placeTool('coal', 10, 10);

// Connect power lines to a residential zone
game.placeTool('residential', 19, 10);
for (let x = 13; x <= 17; x++) {
  game.placeTool('wire', x, 10);
}

// Build roads for traffic
game.placeTool('road', 19, 13);

// Advance 5 years
const result = game.tick(60);
console.log(`Year ${result.year}, Population: ${result.population}`);

// Save and reload
const save = game.save();
const game2 = HeadlessGame.fromSave(save);
```

## API Reference

### `HeadlessGame`

#### Creating Games

| Method | Description |
|--------|-------------|
| `HeadlessGame.fromSeed(seed)` | Create a new city with a deterministic map from `seed` |
| `HeadlessGame.fromSave(data)` | Restore a city from save data |

#### Time Control

| Method | Description |
|--------|-------------|
| `tick(months)` | Advance simulation by `months` months. Returns `TickResult` |

Time is client-controlled. The simulation only advances when you call `tick()`.

#### Building

| Method | Description |
|--------|-------------|
| `placeTool(tool, x, y)` | Place a building or infrastructure. Returns `PlaceResult` |

**Tool names:** `bulldozer`, `road`, `rail`, `wire`, `park`, `residential`, `commercial`, `industrial`, `coal`, `nuclear`, `fire`, `police`, `port`, `airport`, `stadium`, `query`

#### Budget

| Method | Description |
|--------|-------------|
| `setTaxRate(rate)` | Set tax rate (0-20) |
| `setBudget({ fire?, police?, road? })` | Set department funding percentages (0-100) |

#### State Queries

| Method | Returns | Description |
|--------|---------|-------------|
| `getStats()` | `CityStats` | Population, score, funds, year, classification, power status |
| `getMap()` | `MapData` | Full tile array (120x100 = 12,000 tiles) |
| `getTile(x, y)` | `TileInfo` | Single tile value |
| `getDemand()` | `DemandLevels` | Residential/commercial/industrial demand (-2000 to 2000) |

#### Save/Load

| Method | Description |
|--------|-------------|
| `save()` | Returns a JSON-serializable save object |

### Types

```typescript
interface TickResult {
  cityTime: number;
  year: number;       // starts at 1900
  month: number;
  population: number;
  funds: number;
}

interface CityStats {
  population: number;
  score: number;
  funds: number;
  cityTime: number;
  year: number;
  month: number;
  classification: string;  // Village, Town, City, Capital, Metropolis, Megalopolis
  isPowered: boolean;
}

interface PlaceResult {
  success: boolean;
  cost: number;
  result: number;
}

interface DemandLevels {
  residential: number;
  commercial: number;
  industrial: number;
}

interface MapData {
  width: number;   // 120
  height: number;  // 100
  tiles: number[]; // flat array, row-major (tiles[y * width + x])
}
```

## Gameplay Tips for Agents

1. **Power first.** Place a coal power plant ($3,000, 4x4) before anything else.
2. **Connect power.** Zones need a contiguous chain of conductive tiles (wire or road) leading back to the power plant. Adjacency is not enough.
3. **Road access.** Zones won't develop without road connectivity.
4. **Watch demand.** `getDemand()` tells you what the city needs (positive = demand, negative = surplus).
5. **Balance RCI.** You need residential (people), commercial (jobs/shopping), and industrial (goods) in roughly balanced amounts.
6. **Fund services.** Fire and police stations have coverage radii. Underfunding reduces effectiveness.
7. **Deterministic seeds.** Same seed + same actions = same outcome. Use `withSeed()` for reproducible experiments.

## Architecture

The engine is a direct extraction from micropolisJS with minimal patches:

- **`src/engine/`** — ~58 files copied from upstream. Three files patched (simulation.js budget bug, boatSprite.js dead import, queryTool.js jQuery removal).
- **`src/headlessGame.ts`** — Clean wrapper around Simulation + GameTools + TickRunner.
- **`src/tickRunner.ts`** — Bypasses the upstream Date-based frame throttle for instant simulation.
- **`src/seededRandom.ts`** — Mulberry32 PRNG that temporarily replaces `Math.random` during map generation.

## Project Vision

This is Phase 1 of **Hallucinating Splines** — a platform where AI agents build and manage SimCity cities through an API. See `docs/PRD.md` for the full vision including the Cloudflare Workers API, MCP server, and public website.

The pitch: *"What kind of city does Claude build?"*
