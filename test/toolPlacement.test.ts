// ABOUTME: Tests for direct tool placement on a generated map.
// ABOUTME: Verifies building, road, wire, and bulldozer tools work in headless mode.

import { MapGenerator } from '../src/engine/mapGenerator.js';
import { GameTools } from '../src/engine/gameTools.js';
import { Budget } from '../src/engine/budget.js';
import { withSeed } from '../src/seededRandom';
import { DIRT } from '../src/engine/tileValues';

function setup() {
  const map = withSeed(42, () => MapGenerator(120, 100));
  const tools = GameTools(map);
  const budget = new Budget();
  budget.setFunds(20000);
  return { map, tools, budget };
}

// Find a clear land tile (DIRT) on the map
function findClearLand(map: any, startX = 10, startY = 10): { x: number; y: number } {
  for (let x = startX; x < map.width - 10; x++) {
    for (let y = startY; y < map.height - 10; y++) {
      // Check a 3x3 area is all clear (for building placement)
      let allClear = true;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (map.getTile(x + dx, y + dy).getValue() !== DIRT) {
            allClear = false;
          }
        }
      }
      if (allClear) return { x, y };
    }
  }
  throw new Error('No clear land found');
}

describe('Tool placement', () => {
  test('place residential zone on clear land succeeds', () => {
    const { map, tools, budget } = setup();
    const { x, y } = findClearLand(map);

    const tool = tools.residential;
    tool.doTool(x, y, {});
    const applied = tool.modifyIfEnoughFunding(budget);
    expect(applied).toBe(true);
  });

  test('place road on clear land succeeds', () => {
    const { map, tools, budget } = setup();
    const { x, y } = findClearLand(map);

    const tool = tools.road;
    tool.doTool(x, y, {});
    const applied = tool.modifyIfEnoughFunding(budget);
    expect(applied).toBe(true);
  });

  test('place wire on clear land succeeds', () => {
    const { map, tools, budget } = setup();
    const { x, y } = findClearLand(map);

    const tool = tools.wire;
    tool.doTool(x, y, {});
    const applied = tool.modifyIfEnoughFunding(budget);
    expect(applied).toBe(true);
  });

  test('place coal power plant on clear land succeeds', () => {
    const { map, tools, budget } = setup();
    const { x, y } = findClearLand(map);

    const tool = tools.coal;
    tool.doTool(x, y, {});
    const applied = tool.modifyIfEnoughFunding(budget);
    expect(applied).toBe(true);
  });

  test('bulldoze trees succeeds', () => {
    const { map, tools, budget } = setup();

    // Find a tile with trees (WOODS range)
    let treeX = -1, treeY = -1;
    for (let x = 0; x < map.width && treeX < 0; x++) {
      for (let y = 0; y < map.height && treeX < 0; y++) {
        const val = map.getTile(x, y).getValue();
        if (val >= 21 && val <= 39) { // WOODS range
          treeX = x;
          treeY = y;
        }
      }
    }
    expect(treeX).toBeGreaterThanOrEqual(0);

    const tool = tools.bulldozer;
    tool.doTool(treeX, treeY, {});
    const applied = tool.modifyIfEnoughFunding(budget);
    expect(applied).toBe(true);
    // After bulldozing, tile should be dirt
    expect(map.getTile(treeX, treeY).getValue()).toBe(DIRT);
  });

  test('placement fails with insufficient funds', () => {
    const { map, tools, budget } = setup();
    const { x, y } = findClearLand(map);

    budget.setFunds(0);
    const tool = tools.coal; // costs 3000
    tool.doTool(x, y, {});
    const applied = tool.modifyIfEnoughFunding(budget);
    expect(applied).toBe(false);
  });
});
