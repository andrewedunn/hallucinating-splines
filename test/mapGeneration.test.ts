// ABOUTME: Smoke tests for map generation in a headless Node.js environment.
// ABOUTME: Verifies MapGenerator works without DOM and that seeded generation is reproducible.

import { MapGenerator } from '../src/engine/mapGenerator.js';
import { withSeed } from '../src/seededRandom';

describe('MapGenerator', () => {
  test('generates a map with correct dimensions', () => {
    const map = withSeed(42, () => MapGenerator(120, 100));
    expect(map.width).toBe(120);
    expect(map.height).toBe(100);
  });

  test('map has tile data for every cell', () => {
    const map = withSeed(42, () => MapGenerator(120, 100));
    // GameMap stores tiles in a flat array accessed via getTile(x, y)
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const tile = map.getTile(x, y);
        expect(tile).toBeDefined();
        expect(typeof tile.getValue()).toBe('number');
      }
    }
  });

  test('same seed produces identical maps', () => {
    const map1 = withSeed(42, () => MapGenerator(120, 100));
    const map2 = withSeed(42, () => MapGenerator(120, 100));

    // Compare a sampling of tiles across the map
    for (let x = 0; x < 120; x += 10) {
      for (let y = 0; y < 100; y += 10) {
        expect(map1.getTile(x, y).getValue()).toBe(map2.getTile(x, y).getValue());
      }
    }
  });

  test('different seeds produce different maps', () => {
    const map1 = withSeed(42, () => MapGenerator(120, 100));
    const map2 = withSeed(99, () => MapGenerator(120, 100));

    // At least some tiles should differ
    let differences = 0;
    for (let x = 0; x < 120; x += 10) {
      for (let y = 0; y < 100; y += 10) {
        if (map1.getTile(x, y).getValue() !== map2.getTile(x, y).getValue()) {
          differences++;
        }
      }
    }
    expect(differences).toBeGreaterThan(0);
  });
});
