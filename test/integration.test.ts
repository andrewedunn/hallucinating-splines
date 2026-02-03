// ABOUTME: Full lifecycle integration test for the headless SimCity engine.
// ABOUTME: Builds a starter city, advances years, verifies population growth, and tests save/load continuity.

import { HeadlessGame } from '../src/headlessGame';
import { withSeed } from '../src/seededRandom';

/**
 * Find a clear NxN area on the map. Size is the radius checked around center.
 */
function findClearArea(game: HeadlessGame, radius: number, startX = 5, startY = 5): { x: number; y: number } {
  const map = game.getMap();
  for (let x = startX; x < map.width - radius; x++) {
    for (let y = startY; y < map.height - radius; y++) {
      let allClear = true;
      for (let dx = -radius; dx <= radius && allClear; dx++) {
        for (let dy = -radius; dy <= radius && allClear; dy++) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height ||
              map.tiles[ty * map.width + tx] !== 0) {
            allClear = false;
          }
        }
      }
      if (allClear) return { x, y };
    }
  }
  throw new Error(`No clear area (radius ${radius}) found`);
}

describe('Full lifecycle integration', () => {
  test('build a city, grow population, save/load, continue growth', () => {
    const game = HeadlessGame.fromSeed(42);

    // 1. Place coal power plant (4x4 building)
    const cp = findClearArea(game, 4);
    expect(game.placeTool('coal', cp.x, cp.y).success).toBe(true);

    // 2. Place residential zone east of power, connected by wire
    //    Wire tiles form a conductive path from coal to residential
    const rx = cp.x + 9;
    expect(game.placeTool('residential', rx, cp.y).success).toBe(true);
    for (let x = cp.x + 3; x <= rx - 2; x++) {
      game.placeTool('wire', x, cp.y);
    }

    // 3. Place commercial further east, connected by wire
    const cx = rx + 7;
    expect(game.placeTool('commercial', cx, cp.y).success).toBe(true);
    for (let x = rx + 2; x <= cx - 2; x++) {
      game.placeTool('wire', x, cp.y);
    }

    // 4. Place industrial further east, connected by wire
    const ix = cx + 7;
    expect(game.placeTool('industrial', ix, cp.y).success).toBe(true);
    for (let x = cx + 2; x <= ix - 2; x++) {
      game.placeTool('wire', x, cp.y);
    }

    // 5. Build a road strip below all zones for traffic connectivity
    const roadY = cp.y + 3;
    for (let x = cp.x - 2; x <= ix + 2; x++) {
      game.placeTool('road', x, roadY);
    }
    // Road spurs connecting each zone to the main road
    for (const zx of [rx, cx, ix]) {
      game.placeTool('road', zx, roadY - 1);
    }

    // 6. Advance 5 years
    const result5y = game.tick(60);
    expect(result5y.year).toBeGreaterThanOrEqual(1905);

    const stats5y = game.getStats();
    expect(stats5y.population).toBeGreaterThan(0);

    // 7. Save the game
    const saveData = game.save();

    // 8. Load into a new game
    const game2 = HeadlessGame.fromSave(saveData);
    const loadedStats = game2.getStats();
    expect(loadedStats.funds).toBe(stats5y.funds);
    expect(loadedStats.cityTime).toBe(stats5y.cityTime);

    // 9. Tick once to normalize census after load, then advance 5 years
    game2.tick(1);
    const loadedPop = game2.getStats().population;
    expect(loadedPop).toBeGreaterThan(0);

    const result10y = game2.tick(59);
    expect(result10y.year).toBeGreaterThanOrEqual(1910);

    // 10. Verify continued growth (or at least stability)
    const stats10y = game2.getStats();
    expect(stats10y.population).toBeGreaterThanOrEqual(stats5y.population);
  });

  test('deterministic: same seed + same actions = same outcome', () => {
    function buildAndRun(seed: number) {
      return withSeed(seed, () => {
        const game = HeadlessGame.fromSeed(seed);
        const cp = findClearArea(game, 4);
        game.placeTool('coal', cp.x, cp.y);

        const rx = cp.x + 9;
        game.placeTool('residential', rx, cp.y);
        for (let x = cp.x + 3; x <= rx - 2; x++) {
          game.placeTool('wire', x, cp.y);
        }

        game.placeTool('road', rx, cp.y + 3);
        game.placeTool('road', rx - 1, cp.y + 3);
        game.placeTool('road', rx + 1, cp.y + 3);
        game.placeTool('road', rx, cp.y + 2);

        game.tick(24);
        return game.getStats();
      });
    }

    const stats1 = buildAndRun(42);
    const stats2 = buildAndRun(42);
    expect(stats1.population).toBe(stats2.population);
    expect(stats1.funds).toBe(stats2.funds);
    expect(stats1.cityTime).toBe(stats2.cityTime);
  });

  test('no browser globals referenced in code path', () => {
    // This test verifies the engine runs without any browser APIs
    // by successfully completing a full game cycle in Node.js
    const game = HeadlessGame.fromSeed(99);
    const cp = findClearArea(game, 4);
    game.placeTool('coal', cp.x, cp.y);
    game.placeTool('residential', cp.x + 9, cp.y);
    for (let x = cp.x + 3; x <= cp.x + 6; x++) {
      game.placeTool('wire', x, cp.y);
    }
    const result = game.tick(120);
    const saved = game.save();
    const loaded = HeadlessGame.fromSave(saved);
    loaded.tick(12);
    expect(loaded.getStats()).toBeDefined();
    expect(loaded.getMap().tiles.length).toBe(12000);
    expect(loaded.getDemand()).toBeDefined();
  });
});
