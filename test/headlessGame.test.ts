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
