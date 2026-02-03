// ABOUTME: Tests for save/load round-tripping via HeadlessGame.
// ABOUTME: Verifies serialization, deserialization, and state preservation across save/load cycles.

import { HeadlessGame } from '../src/headlessGame';

describe('Save/Load', () => {
  test('save() returns a JSON-serializable object', () => {
    const game = HeadlessGame.fromSeed(42);
    game.tick(12);
    const data = game.save();

    // Should be plain object, not class instance
    expect(typeof data).toBe('object');
    // Should survive JSON round-trip
    const json = JSON.stringify(data);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test('fromSave creates a game with matching state', () => {
    const game1 = HeadlessGame.fromSeed(42);
    game1.tick(12);
    const stats1 = game1.getStats();

    const saved = game1.save();
    const game2 = HeadlessGame.fromSave(saved);
    const stats2 = game2.getStats();

    expect(stats2.cityTime).toBe(stats1.cityTime);
    expect(stats2.funds).toBe(stats1.funds);
    expect(stats2.population).toBe(stats1.population);
  });

  test('round-trip preserves map tiles', () => {
    const game1 = HeadlessGame.fromSeed(42);
    game1.tick(6);
    const map1 = game1.getMap();

    const saved = game1.save();
    const game2 = HeadlessGame.fromSave(saved);
    const map2 = game2.getMap();

    expect(map2.tiles).toEqual(map1.tiles);
  });

  test('loaded game can continue ticking', () => {
    const game1 = HeadlessGame.fromSeed(42);
    game1.tick(12);
    const saved = game1.save();

    const game2 = HeadlessGame.fromSave(saved);
    // Should not throw
    const result = game2.tick(12);
    expect(result.cityTime).toBeGreaterThan(0);
    expect(typeof result.funds).toBe('number');
  });

  test('round-trip: save → load → tick → compare with original', () => {
    const game1 = HeadlessGame.fromSeed(42);
    game1.tick(24);

    const saved = game1.save();
    const game2 = HeadlessGame.fromSave(saved);

    // Both advance the same number of ticks
    const result1 = game1.tick(12);
    const result2 = game2.tick(12);

    expect(result2.cityTime).toBe(result1.cityTime);
    expect(result2.funds).toBe(result1.funds);
    expect(result2.population).toBe(result1.population);
  });
});
