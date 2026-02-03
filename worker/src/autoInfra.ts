// ABOUTME: BFS-based auto-infrastructure helpers for placing power lines, roads, and bulldozing.
// ABOUTME: Called before/after tool placement to auto-connect zones to existing infrastructure.

import {
  DIRT, RIVER, WATER_HIGH, TREEBASE, WOODS_HIGH,
  RUBBLE, LASTRUBBLE, ROADBASE, LASTROAD, POWERBASE, LASTPOWER,
} from '../../src/engine/tileValues';
import { BIT_MASK, POWERBIT } from '../../src/engine/tileFlags';

import type { HeadlessGame } from '../../src/headlessGame';

export interface AutoAction {
  type: string;
  path?: number[][];
  tiles?: number[][];
  cost: number;
  failed?: boolean;
  reason?: string;
}

const MAX_PATH = 50;
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // up, down, left, right

function isTree(tileId: number): boolean {
  return tileId >= TREEBASE && tileId <= WOODS_HIGH;
}

function isRubble(tileId: number): boolean {
  return tileId >= RUBBLE && tileId <= LASTRUBBLE;
}

function isWater(tileId: number): boolean {
  return tileId >= RIVER && tileId <= WATER_HIGH;
}

function isRoad(tileId: number): boolean {
  return tileId >= ROADBASE && tileId <= LASTROAD;
}

function isPowerLine(tileId: number): boolean {
  return tileId >= POWERBASE && tileId <= LASTPOWER;
}

/** True if a tile can be traversed by BFS pathfinding (buildable land or existing infra). */
function isPassable(tileId: number): boolean {
  if (tileId === DIRT) return true;
  if (isTree(tileId)) return true;
  if (isRubble(tileId)) return true;
  if (isRoad(tileId)) return true;
  if (isPowerLine(tileId)) return true;
  return false;
}

/**
 * Bulldoze trees and rubble within a tool's footprint before placement.
 */
export function autoBulldoze(game: HeadlessGame, x: number, y: number, toolSize: number): AutoAction {
  const map = game.getMap();
  const bulldozed: number[][] = [];
  let totalCost = 0;

  for (let dy = 0; dy < toolSize; dy++) {
    for (let dx = 0; dx < toolSize; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;

      const raw = map.tiles[ty * map.width + tx];
      const tileId = raw & BIT_MASK;

      if (isTree(tileId) || isRubble(tileId)) {
        const result = game.placeTool('bulldozer', tx, ty);
        if (result.success) {
          bulldozed.push([tx, ty]);
          totalCost += result.cost;
        }
      }
    }
  }

  return { type: 'bulldoze', tiles: bulldozed, cost: totalCost };
}

/**
 * BFS from (x,y) outward; returns path from start to target (exclusive of start).
 * `isTarget` checks whether a tile qualifies as the destination.
 */
function bfsPath(
  map: { width: number; height: number; tiles: number[] },
  startX: number,
  startY: number,
  isTarget: (raw: number, tileId: number) => boolean,
): number[][] | null {
  const key = (cx: number, cy: number) => cy * map.width + cx;
  const visited = new Set<number>();
  // Each entry: [x, y, parentKey | -1]
  const queue: [number, number, number][] = [];
  const parents = new Map<number, number>(); // childKey -> parentKey
  const coords = new Map<number, [number, number]>(); // key -> [x, y]

  const startKey = key(startX, startY);
  visited.add(startKey);
  coords.set(startKey, [startX, startY]);

  // Seed with neighbors of start
  for (const [ddx, ddy] of DIRS) {
    const nx = startX + ddx;
    const ny = startY + ddy;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
    const nk = key(nx, ny);
    if (visited.has(nk)) continue;

    const raw = map.tiles[ny * map.width + nx];
    const tileId = raw & BIT_MASK;

    if (isTarget(raw, tileId)) {
      // Immediate neighbor is target -- no path tiles needed
      return [];
    }

    if (isPassable(tileId) && !isWater(tileId)) {
      visited.add(nk);
      coords.set(nk, [nx, ny]);
      parents.set(nk, startKey);
      queue.push([nx, ny, 0]); // depth 0 from first ring
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [cx, cy, depth] = queue[head++];
    if (depth >= MAX_PATH) continue;

    for (const [ddx, ddy] of DIRS) {
      const nx = cx + ddx;
      const ny = cy + ddy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;

      const raw = map.tiles[ny * map.width + nx];
      const tileId = raw & BIT_MASK;

      if (isTarget(raw, tileId)) {
        // Reconstruct path from (cx,cy) back to start (exclusive of start and target)
        const path: number[][] = [];
        let cur = key(cx, cy);
        while (cur !== startKey) {
          const [px, py] = coords.get(cur)!;
          path.push([px, py]);
          cur = parents.get(cur)!;
        }
        path.reverse();
        return path;
      }

      if (isPassable(tileId) && !isWater(tileId)) {
        visited.add(nk);
        coords.set(nk, [nx, ny]);
        parents.set(nk, key(cx, cy));
        queue.push([nx, ny, depth + 1]);
      }
    }
  }

  return null; // No path found
}

/**
 * BFS from (x,y) to nearest powered tile; place power lines along the path.
 */
export function autoPower(game: HeadlessGame, x: number, y: number): AutoAction {
  const map = game.getMap();

  // Check if origin is already powered
  const originRaw = map.tiles[y * map.width + x];
  if (originRaw & POWERBIT) {
    return { type: 'power_line', path: [], cost: 0 };
  }

  const path = bfsPath(map, x, y, (raw) => (raw & POWERBIT) !== 0);

  if (path === null) {
    return { type: 'power_line', cost: 0, failed: true, reason: 'no_powered_tile_reachable' };
  }

  let totalCost = 0;
  const placed: number[][] = [];

  for (const [px, py] of path) {
    const raw = map.tiles[py * map.width + px];
    const tileId = raw & BIT_MASK;

    // Skip tiles that already have power infrastructure
    if (isPowerLine(tileId)) {
      placed.push([px, py]);
      continue;
    }

    const result = game.placeTool('wire', px, py);
    if (result.success) {
      totalCost += result.cost;
      placed.push([px, py]);
    }
  }

  return { type: 'power_line', path: placed, cost: totalCost };
}

/**
 * BFS from (x,y) to nearest road tile; place road tiles along the path.
 */
export function autoRoad(game: HeadlessGame, x: number, y: number): AutoAction {
  const map = game.getMap();

  // Check if origin is already a road
  const originTileId = map.tiles[y * map.width + x] & BIT_MASK;
  if (isRoad(originTileId)) {
    return { type: 'road', path: [], cost: 0 };
  }

  const path = bfsPath(map, x, y, (_raw, tileId) => isRoad(tileId));

  if (path === null) {
    return { type: 'road', cost: 0, failed: true, reason: 'no_road_reachable' };
  }

  let totalCost = 0;
  const placed: number[][] = [];

  for (const [px, py] of path) {
    const raw = map.tiles[py * map.width + px];
    const tileId = raw & BIT_MASK;

    // Skip tiles that already are roads
    if (isRoad(tileId)) {
      placed.push([px, py]);
      continue;
    }

    const result = game.placeTool('road', px, py);
    if (result.success) {
      totalCost += result.cost;
      placed.push([px, py]);
    }
  }

  return { type: 'road', path: placed, cost: totalCost };
}
