# CLAUDE.md

Project-specific instructions for Claude Code.

## What This Is

Hallucinating Splines is a headless SimCity engine extracted from [micropolisJS](https://github.com/graememcc/micropolisJS) (GPL v3). It runs the full Micropolis simulation in Node.js with no DOM, no jQuery, no browser APIs. The long-term goal is a "SimCity-as-a-Service" platform for AI agents (see `docs/PRD.md`).

## Project Structure

```
src/
  engine/          # Copied + patched micropolisJS core (~58 files)
  headlessGame.ts  # Main public API
  tickRunner.ts    # Drives simulation without Date-based throttling
  seededRandom.ts  # Mulberry32 PRNG for reproducible map generation
  types.ts         # Public TypeScript interfaces
test/              # Jest tests (unit + integration)
docs/              # PRDs and design documents
```

## Build & Test

```bash
npm test                  # Run all tests (42 tests)
npm run typecheck         # TypeScript type checking
npm run build             # Compile to dist/
```

Tests require `--experimental-vm-modules` (handled by the test script).

## Engine Internals

These details matter when working with the simulation:

- **Tick math:** 1 month = 64 ticks (4 cityTime increments x 16 phase ticks each). 1 year = 768 ticks.
- **Phase cycle:** The simulation has 16 phases (0-15). `_phaseCycle` tracks which phase runs next. `_cityTime` increments only at phase 0.
- **Power connectivity:** Zones need conductive tiles (wire, road) forming a **contiguous path** from a power plant. Adjacency alone is not enough — there must be a connected chain of conductive tiles.
- **Budget stalling:** When funds run low, `budget.awaitingValues = true` pauses the simulation. `TickRunner` auto-resolves this by calling `budget.doBudgetNow(true)` before each tick.
- **Date throttle bypass:** The upstream `_simFrame()` uses `Date.now()` to throttle. `TickRunner` bypasses this by calling `_constructSimData()` + `_simulate()` + `_updateTime()` directly.
- **Census double-counting:** After `fromSave()`, the Simulation constructor's `init()` runs `mapScan` which re-adds zone populations on top of loaded census values. Tick once after loading to normalize.

## Patches Applied to Upstream

1. **`simulation.js` lines 343, 346:** Fixed bare `budget` variable → `this.budget` in `take10Census()` and `take120Census()` calls.
2. **`boatSprite.js`:** Removed dead `SpriteConstants` import (no such named export).
3. **`queryTool.js`:** Stripped jQuery dependency. All `$('#...').text(...)` DOM writes replaced with no-ops.

## Conventions

- All files start with a 2-line `// ABOUTME:` comment.
- TDD: write failing test first, then implement.
- Engine files in `src/engine/` are upstream copies with minimal patches. Avoid modifying them unless necessary.
- Test output must be clean — no unexpected console noise.
- The engine uses mixed JS/TS. TypeScript files use `.ts` extension; engine files are `.js`. The `moduleNameMapper` in jest config only strips `.ts` extensions (not `.js`, which would break `text.js` imports).

## Key Docs

- `docs/PRD.md` — Full product requirements (architecture, API design, phases)
- `docs/PRD-MICROPOLISJS.md` — micropolisJS API analysis
- `docs/micropolis-agent-platform-prd.md` — Agent platform PRD
