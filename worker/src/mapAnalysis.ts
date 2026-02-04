// ABOUTME: Analyzes a city's tile grid and returns a structured semantic summary.
// ABOUTME: Counts terrain, infrastructure, buildings, and detects common issues.

import * as TV from '../../src/engine/tileValues';
import { BIT_MASK, POWERBIT, ZONEBIT } from '../../src/engine/tileFlags';

interface TerrainCell {
  land: number;
  water: number;
  trees: number;
}

interface MapSummary {
  terrain: { water_tiles: number; tree_tiles: number; empty_tiles: number };
  terrain_grid: { cell_size: number; cols: number; rows: number; cells: string[][] };
  buildings: Array<{ type: string; x: number; y: number; powered: boolean }>;
  infrastructure: { road_tiles: number; rail_tiles: number; power_line_tiles: number };
  analysis: {
    unpowered_buildings: number;
    unroaded_zones: number;
    largest_empty_area: { x: number; y: number; approx_size: string } | null;
  };
}

function classifyBuilding(tileId: number): string | null {
  if (tileId >= TV.RESBASE && tileId < TV.COMBASE) return 'residential';
  if (tileId >= TV.COMBASE && tileId < TV.INDBASE) return 'commercial';
  if (tileId >= TV.INDBASE && tileId < TV.PORTBASE) return 'industrial';
  if (tileId >= TV.PORTBASE && tileId < TV.AIRPORTBASE) return 'seaport';
  if (tileId >= TV.AIRPORTBASE && tileId < TV.COALBASE) return 'airport';
  if (tileId >= TV.COALBASE && tileId <= TV.LASTPOWERPLANT) return 'coal_power';
  if (tileId >= TV.FIRESTBASE && tileId < TV.POLICESTBASE) return 'fire_station';
  if (tileId >= TV.POLICESTBASE && tileId < TV.STADIUMBASE) return 'police_station';
  if (tileId >= TV.STADIUMBASE && tileId < TV.NUCLEARBASE) return 'stadium';
  if (tileId >= TV.NUCLEARBASE && tileId <= TV.LASTZONE) return 'nuclear_power';
  return null;
}

function hasRoadNearby(tiles: number[], width: number, height: number, cx: number, cy: number): boolean {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const raw = tiles[ny * width + nx];
      const id = raw & BIT_MASK;
      if (id >= TV.ROADBASE && id <= TV.LASTROAD) return true;
    }
  }
  return false;
}

function findLargestEmptyArea(
  tiles: number[],
  width: number,
  height: number,
): { x: number; y: number; approx_size: string } | null {
  const visited = new Uint8Array(width * height);
  let bestSize = 0;
  let bestX = 0;
  let bestY = 0;

  for (let i = 0; i < width * height; i++) {
    if (visited[i]) continue;
    const id = tiles[i] & BIT_MASK;
    const isEmpty = id === TV.DIRT || (id >= TV.TREEBASE && id <= TV.WOODS_HIGH);
    if (!isEmpty) continue;

    // Flood fill
    const stack = [i];
    visited[i] = 1;
    let size = 0;
    let minX = i % width;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      size++;
      const x = idx % width;
      const y = (idx - x) / width;

      const neighbors = [
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
      ];

      for (const ni of neighbors) {
        if (ni < 0 || visited[ni]) continue;
        const nid = tiles[ni] & BIT_MASK;
        const nEmpty = nid === TV.DIRT || (nid >= TV.TREEBASE && nid <= TV.WOODS_HIGH);
        if (!nEmpty) continue;
        visited[ni] = 1;
        stack.push(ni);
      }
    }

    if (size > bestSize) {
      bestSize = size;
      bestX = i % width;
      bestY = (i - bestX) / width;
    }
  }

  if (bestSize === 0) return null;

  let approx: string;
  if (bestSize < 100) approx = 'small';
  else if (bestSize < 500) approx = 'medium';
  else if (bestSize < 2000) approx = 'large';
  else approx = 'very_large';

  return { x: bestX, y: bestY, approx_size: approx };
}

export function analyzeMap(tiles: number[], width: number, height: number): MapSummary {
  let waterTiles = 0;
  let treeTiles = 0;
  let emptyTiles = 0;
  let roadTiles = 0;
  let railTiles = 0;
  let powerLineTiles = 0;

  const buildings: Array<{ type: string; x: number; y: number; powered: boolean }> = [];
  let unpoweredBuildings = 0;
  let unroadedZones = 0;

  for (let i = 0; i < width * height; i++) {
    const raw = tiles[i];
    const id = raw & BIT_MASK;
    const x = i % width;
    const y = (i - x) / width;

    // Terrain
    if (id >= TV.RIVER && id <= TV.WATER_HIGH) waterTiles++;
    else if (id >= TV.TREEBASE && id <= TV.WOODS_HIGH) treeTiles++;
    else if (id === TV.DIRT) emptyTiles++;

    // Infrastructure
    if (id >= TV.ROADBASE && id <= TV.LASTROAD) roadTiles++;
    else if (id >= TV.RAILBASE && id <= TV.LASTRAIL) railTiles++;
    else if (id >= TV.POWERBASE && id <= TV.LASTPOWER) powerLineTiles++;

    // Buildings — zone centers only
    if (raw & ZONEBIT) {
      const type = classifyBuilding(id);
      if (type) {
        const powered = !!(raw & POWERBIT);
        buildings.push({ type, x, y, powered });
        if (!powered) unpoweredBuildings++;
        if (!hasRoadNearby(tiles, width, height, x, y)) unroadedZones++;
      }
    }
  }

  const largestEmpty = findLargestEmptyArea(tiles, width, height);

  // Build coarse terrain grid (10×10 tile cells)
  const cellSize = 10;
  const gridCols = Math.ceil(width / cellSize);
  const gridRows = Math.ceil(height / cellSize);
  const terrainCells: string[][] = [];

  for (let gr = 0; gr < gridRows; gr++) {
    const row: string[] = [];
    for (let gc = 0; gc < gridCols; gc++) {
      let water = 0;
      let total = 0;
      for (let dy = 0; dy < cellSize && gr * cellSize + dy < height; dy++) {
        for (let dx = 0; dx < cellSize && gc * cellSize + dx < width; dx++) {
          const idx = (gr * cellSize + dy) * width + (gc * cellSize + dx);
          const id = tiles[idx] & BIT_MASK;
          total++;
          if (id >= TV.RIVER && id <= TV.WATER_HIGH) water++;
        }
      }
      const pct = water / total;
      if (pct > 0.8) row.push('~');       // mostly water
      else if (pct > 0.3) row.push('/');   // mixed (coast)
      else row.push('.');                  // mostly land
    }
    terrainCells.push(row);
  }

  return {
    terrain: { water_tiles: waterTiles, tree_tiles: treeTiles, empty_tiles: emptyTiles },
    terrain_grid: { cell_size: cellSize, cols: gridCols, rows: gridRows, cells: terrainCells },
    buildings,
    infrastructure: { road_tiles: roadTiles, rail_tiles: railTiles, power_line_tiles: powerLineTiles },
    analysis: {
      unpowered_buildings: unpoweredBuildings,
      unroaded_zones: unroadedZones,
      largest_empty_area: largestEmpty,
    },
  };
}
