// ABOUTME: Tests for the HeadlessGame public API.
// ABOUTME: Verifies game creation, tool placement, ticking, stats queries, and disaster disabling.

import { HeadlessGame } from '../src/headlessGame';

describe('HeadlessGame', () => {
  describe('fromSeed', () => {
    test('creates a playable game', () => {
      const game = HeadlessGame.fromSeed(42);
      expect(game).toBeDefined();
      const stats = game.getStats();
      expect(stats.funds).toBe(20000);
    });

    test('same seed produces same map', () => {
      const game1 = HeadlessGame.fromSeed(42);
      const game2 = HeadlessGame.fromSeed(42);
      const map1 = game1.getMap();
      const map2 = game2.getMap();
      expect(map1.tiles).toEqual(map2.tiles);
    });
  });

  describe('placeTool', () => {
    test('places a coal power plant on clear land', () => {
      const game = HeadlessGame.fromSeed(42);
      const { x, y } = findClearSpot(game, 4);
      const result = game.placeTool('coal', x, y);
      expect(result.success).toBe(true);
      expect(result.cost).toBeGreaterThan(0);
    });

    test('places a residential zone on clear land', () => {
      const game = HeadlessGame.fromSeed(42);
      const { x, y } = findClearSpot(game, 3);
      const result = game.placeTool('residential', x, y);
      expect(result.success).toBe(true);
    });

    test('returns failure for invalid tool name', () => {
      const game = HeadlessGame.fromSeed(42);
      const result = game.placeTool('nonexistent', 10, 10);
      expect(result.success).toBe(false);
    });
  });

  describe('tick', () => {
    test('advances time and returns stats', () => {
      const game = HeadlessGame.fromSeed(42);
      const result = game.tick(12);
      expect(result.cityTime).toBeGreaterThan(0);
      expect(result.year).toBeGreaterThanOrEqual(1900);
      expect(typeof result.population).toBe('number');
      expect(typeof result.funds).toBe('number');
    });

    test('tick(1) advances roughly one month', () => {
      const game = HeadlessGame.fromSeed(42);
      const before = game.getStats();
      game.tick(1);
      const after = game.getStats();
      // 1 month = 4 ticks, cityTime should advance
      expect(after.cityTime).toBeGreaterThan(before.cityTime);
    });
  });

  describe('disasters', () => {
    test('disasters are disabled', () => {
      const game = HeadlessGame.fromSeed(42);
      expect((game as any).sim.disasterManager.disastersEnabled).toBe(false);
    });
  });

  describe('getStats', () => {
    test('returns expected shape', () => {
      const game = HeadlessGame.fromSeed(42);
      const stats = game.getStats();
      expect(stats).toHaveProperty('population');
      expect(stats).toHaveProperty('score');
      expect(stats).toHaveProperty('funds');
      expect(stats).toHaveProperty('cityTime');
      expect(stats).toHaveProperty('year');
      expect(stats).toHaveProperty('month');
    });
  });

  describe('getMap', () => {
    test('returns tile array with correct dimensions', () => {
      const game = HeadlessGame.fromSeed(42);
      const map = game.getMap();
      expect(map.width).toBe(120);
      expect(map.height).toBe(100);
      expect(map.tiles.length).toBe(120 * 100);
      expect(map.tiles.every((t: number) => typeof t === 'number')).toBe(true);
    });
  });

  describe('getDemand', () => {
    test('returns RCI values', () => {
      const game = HeadlessGame.fromSeed(42);
      const demand = game.getDemand();
      expect(demand).toHaveProperty('residential');
      expect(demand).toHaveProperty('commercial');
      expect(demand).toHaveProperty('industrial');
      expect(typeof demand.residential).toBe('number');
    });
  });

  describe('budget controls', () => {
    test('setTaxRate changes tax rate', () => {
      const game = HeadlessGame.fromSeed(42);
      game.setTaxRate(10);
      expect((game as any).sim.budget.cityTax).toBe(10);
    });
  });

  describe('getFullStats', () => {
    test('returns census, evaluation, and budget data after ticking', () => {
      const game = HeadlessGame.fromSeed(42);
      game.tick(12); // 1 year to populate evaluation/census
      const stats = game.getFullStats();

      // Base CityStats fields
      expect(stats).toHaveProperty('population');
      expect(stats).toHaveProperty('score');
      expect(stats).toHaveProperty('funds');
      expect(stats).toHaveProperty('year');

      // Demand
      expect(stats.demand).toHaveProperty('residential');
      expect(stats.demand).toHaveProperty('commercial');
      expect(stats.demand).toHaveProperty('industrial');

      // Census
      expect(typeof stats.census.resPop).toBe('number');
      expect(typeof stats.census.comPop).toBe('number');
      expect(typeof stats.census.indPop).toBe('number');
      expect(typeof stats.census.roadTotal).toBe('number');
      expect(typeof stats.census.railTotal).toBe('number');
      expect(typeof stats.census.poweredZoneCount).toBe('number');
      expect(typeof stats.census.unpoweredZoneCount).toBe('number');
      expect(typeof stats.census.policeStationPop).toBe('number');
      expect(typeof stats.census.fireStationPop).toBe('number');
      expect(typeof stats.census.coalPowerPop).toBe('number');
      expect(typeof stats.census.nuclearPowerPop).toBe('number');
      expect(typeof stats.census.seaportPop).toBe('number');
      expect(typeof stats.census.airportPop).toBe('number');
      expect(typeof stats.census.stadiumPop).toBe('number');
      expect(typeof stats.census.crimeAverage).toBe('number');
      expect(typeof stats.census.pollutionAverage).toBe('number');
      expect(typeof stats.census.landValueAverage).toBe('number');

      // Evaluation
      expect(stats.evaluation.approval).toBeGreaterThanOrEqual(0);
      expect(stats.evaluation.approval).toBeLessThanOrEqual(100);
      expect(typeof stats.evaluation.populationDelta).toBe('number');
      expect(typeof stats.evaluation.assessedValue).toBe('number');
      expect(typeof stats.evaluation.scoreDelta).toBe('number');
      expect(Array.isArray(stats.evaluation.problems)).toBe(true);

      // Budget
      expect(typeof stats.budget.taxRate).toBe('number');
      expect(typeof stats.budget.cashFlow).toBe('number');
      expect(typeof stats.budget.roadPercent).toBe('number');
      expect(typeof stats.budget.firePercent).toBe('number');
      expect(typeof stats.budget.policePercent).toBe('number');
      expect(typeof stats.budget.roadEffect).toBe('number');
      expect(typeof stats.budget.fireEffect).toBe('number');
      expect(typeof stats.budget.policeEffect).toBe('number');
      expect(typeof stats.budget.roadMaintenanceBudget).toBe('number');
      expect(typeof stats.budget.fireMaintenanceBudget).toBe('number');
      expect(typeof stats.budget.policeMaintenanceBudget).toBe('number');
    });

    test('problems are human-readable strings', () => {
      const game = HeadlessGame.fromSeed(42);
      game.tick(12);
      const stats = game.getFullStats();
      const validProblems = ['crime', 'pollution', 'housing', 'taxes', 'traffic', 'unemployment', 'fire'];
      for (const p of stats.evaluation.problems) {
        expect(validProblems).toContain(p);
      }
    });
  });

  describe('evaluation persistence', () => {
    test('approval survives save/load cycle', () => {
      const game = HeadlessGame.fromSeed(42);

      // Build a small city: power + residential + road
      const spot = findClearSpot(game, 4);
      game.placeTool('coal', spot.x, spot.y);
      game.placeTool('road', spot.x - 1, spot.y);
      game.placeTool('road', spot.x - 1, spot.y + 1);
      game.placeTool('road', spot.x - 1, spot.y + 2);
      game.placeTool('residential', spot.x - 4, spot.y);
      game.placeTool('residential', spot.x - 4, spot.y + 3);

      // Advance enough for evaluation to run (TAX_FREQUENCY = 48 cityTime)
      game.tick(24); // 2 years

      const statsBefore = game.getFullStats();
      // With a score > 0, approval should be > 0 after evaluation runs
      expect(statsBefore.evaluation.approval).toBeGreaterThan(0);

      // Save and reload
      const saveData = game.save();
      const restored = HeadlessGame.fromSave(saveData);
      const statsAfter = restored.getFullStats();

      expect(statsAfter.evaluation.approval).toBe(statsBefore.evaluation.approval);
      expect(statsAfter.evaluation.assessedValue).toBe(statsBefore.evaluation.assessedValue);
    });
  });

  describe('getCensusHistory', () => {
    test('returns six 120-entry arrays', () => {
      const game = HeadlessGame.fromSeed(42);
      game.tick(12);
      const history = game.getCensusHistory();

      expect(history.residential).toHaveLength(120);
      expect(history.commercial).toHaveLength(120);
      expect(history.industrial).toHaveLength(120);
      expect(history.crime).toHaveLength(120);
      expect(history.pollution).toHaveLength(120);
      expect(history.money).toHaveLength(120);

      // All entries are numbers
      for (const key of ['residential', 'commercial', 'industrial', 'crime', 'pollution', 'money'] as const) {
        expect(history[key].every((v: number) => typeof v === 'number')).toBe(true);
      }
    });

    test('crime history contains non-zero values for a developed city', () => {
      const game = HeadlessGame.fromSeed(42);

      // Build a small city: coal + residential + road
      const spot = findClearSpot(game, 4);
      game.placeTool('coal', spot.x, spot.y);
      const rx = spot.x + 9;
      game.placeTool('residential', rx, spot.y);
      for (let x = spot.x + 3; x <= rx - 2; x++) game.placeTool('wire', x, spot.y);
      game.placeTool('road', rx, spot.y + 3);
      game.placeTool('road', rx - 1, spot.y + 3);
      game.placeTool('road', rx + 1, spot.y + 3);
      game.placeTool('road', rx, spot.y + 2);

      // Advance 5 years — enough for crime to appear
      game.tick(60);

      const history = game.getCensusHistory();
      const nonZeroCrime = history.crime.filter((v: number) => v > 0);
      expect(nonZeroCrime.length).toBeGreaterThan(0);
    });
  });
});

// Helper: find a clear NxN spot on the map for building placement
function findClearSpot(game: HeadlessGame, size: number): { x: number; y: number } {
  const map = game.getMap();
  const DIRT = 0;
  for (let x = size; x < map.width - size; x++) {
    for (let y = size; y < map.height - size; y++) {
      let allClear = true;
      for (let dx = -(size - 1); dx <= (size - 1) && allClear; dx++) {
        for (let dy = -(size - 1); dy <= (size - 1) && allClear; dy++) {
          if (map.tiles[(y + dy) * map.width + (x + dx)] !== DIRT) {
            allClear = false;
          }
        }
      }
      if (allClear) return { x, y };
    }
  }
  throw new Error(`No clear ${size}x${size} spot found`);
}
