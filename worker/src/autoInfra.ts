// ABOUTME: Cost-aware auto-infrastructure helpers for placing power lines, roads, and bulldozing.
// ABOUTME: Uses Dijkstra pathfinding with water crossing, bulldoze-along-path, and budget guards.

import {
  DIRT, RIVER, WATER_HIGH, TREEBASE, WOODS_HIGH,
  RUBBLE, LASTRUBBLE, ROADBASE, LASTROAD, POWERBASE, LASTPOWER,
  COALBASE, LASTPOWERPLANT, NUCLEARBASE, LASTZONE,
  HROADPOWER, VROADPOWER,
} from '../../src/engine/tileValues';
import { BIT_MASK, POWERBIT, CONDBIT } from '../../src/engine/tileFlags';

import type { HeadlessGame } from '../../src/headlessGame';

export interface AutoAction {
  type: string;
  path?: number[][];
  tiles?: number[][];
  cost: number;
  failed?: boolean;
  reason?: string;
}

const MAX_PATH = 80;
const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // up, down, left, right

// -- Tile classification helpers --

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

function isPoweredRoad(tileId: number): boolean {
  return tileId === HROADPOWER || tileId === VROADPOWER;
}

function isPowerPlant(tileId: number): boolean {
  return (tileId >= COALBASE && tileId <= LASTPOWERPLANT) ||
         (tileId >= NUCLEARBASE && tileId <= LASTZONE);
}

function isBuilding(tileId: number): boolean {
  return tileId >= 240;
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

// -- Cost-aware pathfinding --

type PathMode = 'wire' | 'road';

/**
 * Get the cost of traversing a tile for a given infrastructure mode.
 * Returns -1 if the tile is impassable.
 */
function tileCost(raw: number, tileId: number, mode: PathMode): number {
  // Buildings are impassable
  if (isBuilding(tileId)) return -1;

  // Existing matching infrastructure — free to traverse
  if (mode === 'wire') {
    if (isPowerLine(tileId)) return 0;
    if (isPoweredRoad(tileId)) return 0;
    // Can check CONDBIT for zone-adjacent conductive tiles
    if ((raw & CONDBIT) && !isBuilding(tileId)) return 0;
  }
  if (mode === 'road') {
    if (isRoad(tileId)) return 0;
  }

  // Water — crossable but expensive
  if (isWater(tileId)) {
    return mode === 'wire' ? 25 : 50;
  }

  // Trees — need bulldoze ($1) + placement
  if (isTree(tileId)) {
    return 1 + (mode === 'wire' ? 5 : 10);
  }

  // Rubble — similar to trees
  if (isRubble(tileId)) {
    return 1 + (mode === 'wire' ? 5 : 10);
  }

  // Dirt — base cost
  if (tileId === DIRT) {
    return mode === 'wire' ? 5 : 10;
  }

  // Road tiles when laying wire — wire-on-road creates powered road, costs wire price
  if (mode === 'wire' && isRoad(tileId)) {
    return 5;
  }

  // Power line tiles when laying road — road-on-wire, costs road price
  if (mode === 'road' && isPowerLine(tileId)) {
    return 10;
  }

  // Anything else is impassable
  return -1;
}

interface DijkstraResult {
  path: number[][];
  totalCost: number;
}

/**
 * Dijkstra pathfinding from a zone footprint to the nearest target tile.
 * Returns the cheapest path (by actual tile costs) rather than shortest hop count.
 * Supports water crossings and prefers existing infrastructure (free traversal).
 */
function dijkstraPath(
  map: { width: number; height: number; tiles: number[] },
  centerX: number,
  centerY: number,
  toolSize: number,
  mode: PathMode,
  isTarget: (raw: number, tileId: number) => boolean,
): DijkstraResult | null {
  const key = (cx: number, cy: number) => cy * map.width + cx;

  // Distance map: best known cost to reach each tile
  const dist = new Map<number, number>();
  const parents = new Map<number, number>(); // childKey -> parentKey
  const coords = new Map<number, [number, number]>(); // key -> [x, y]

  // Zone footprint bounds (engine places with center coords for zones)
  const halfBelow = Math.floor((toolSize - 1) / 2);
  const halfAbove = Math.floor(toolSize / 2);
  const zoneLeft = centerX - halfBelow;
  const zoneTop = centerY - halfBelow;
  const zoneRight = centerX + halfAbove;
  const zoneBottom = centerY + halfAbove;

  const ORIGIN_KEY = -1;
  const zoneKeys = new Set<number>();

  // Mark all zone tiles so we don't path through them
  for (let zy = zoneTop; zy <= zoneBottom; zy++) {
    for (let zx = zoneLeft; zx <= zoneRight; zx++) {
      if (zx >= 0 && zy >= 0 && zx < map.width && zy < map.height) {
        zoneKeys.add(key(zx, zy));
      }
    }
  }

  // Min-heap using a simple binary heap (priority queue)
  // Each entry: [cost, x, y]
  const heap: [number, number, number][] = [];

  function heapPush(cost: number, x: number, y: number) {
    heap.push([cost, x, y]);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  function heapPop(): [number, number, number] | undefined {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
        if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  // Seed from tiles adjacent to the zone perimeter
  const seeded = new Set<number>();
  for (let zy = zoneTop; zy <= zoneBottom; zy++) {
    for (let zx = zoneLeft; zx <= zoneRight; zx++) {
      if (zx > zoneLeft && zx < zoneRight && zy > zoneTop && zy < zoneBottom) continue;
      for (const [ddx, ddy] of DIRS) {
        const nx = zx + ddx;
        const ny = zy + ddy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const nk = key(nx, ny);
        if (zoneKeys.has(nk) || seeded.has(nk)) continue;
        seeded.add(nk);

        const raw = map.tiles[ny * map.width + nx];
        const tileId = raw & BIT_MASK;

        // Check if target is immediately adjacent
        if (isTarget(raw, tileId)) {
          return { path: [], totalCost: 0 };
        }

        const cost = tileCost(raw, tileId, mode);
        if (cost < 0) continue; // impassable

        dist.set(nk, cost);
        coords.set(nk, [nx, ny]);
        parents.set(nk, ORIGIN_KEY);
        heapPush(cost, nx, ny);
      }
    }
  }

  while (heap.length > 0) {
    const [curCost, cx, cy] = heapPop()!;
    const ck = key(cx, cy);

    // Skip if we already found a cheaper way here
    if (curCost > (dist.get(ck) ?? Infinity)) continue;

    // Enforce max path length via cost proxy (each tile costs at least 1 for new infra)
    // We use Manhattan distance as a rough depth check
    const depth = Math.abs(cx - centerX) + Math.abs(cy - centerY);
    if (depth > MAX_PATH) continue;

    for (const [ddx, ddy] of DIRS) {
      const nx = cx + ddx;
      const ny = cy + ddy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const nk = key(nx, ny);
      if (zoneKeys.has(nk)) continue;

      const raw = map.tiles[ny * map.width + nx];
      const tileId = raw & BIT_MASK;

      // Check if this neighbor is the target
      if (isTarget(raw, tileId)) {
        // Reconstruct path from (cx,cy) back to zone perimeter
        const path: number[][] = [];
        let cur = ck;
        while (cur !== ORIGIN_KEY) {
          const [px, py] = coords.get(cur)!;
          path.push([px, py]);
          cur = parents.get(cur)!;
        }
        path.reverse();
        return { path, totalCost: curCost };
      }

      const stepCost = tileCost(raw, tileId, mode);
      if (stepCost < 0) continue; // impassable

      const newCost = curCost + stepCost;
      const prevCost = dist.get(nk);
      if (prevCost === undefined || newCost < prevCost) {
        dist.set(nk, newCost);
        coords.set(nk, [nx, ny]);
        parents.set(nk, ck);
        heapPush(newCost, nx, ny);
      }
    }
  }

  return null; // No path found
}

/**
 * Bulldoze trees/rubble along a computed path before placing infrastructure.
 */
function bulldozePath(game: HeadlessGame, path: number[][]): number {
  const map = game.getMap();
  let cost = 0;
  for (const [px, py] of path) {
    const raw = map.tiles[py * map.width + px];
    const tileId = raw & BIT_MASK;
    if (isTree(tileId) || isRubble(tileId)) {
      const result = game.placeTool('bulldozer', px, py);
      if (result.success) {
        cost += result.cost;
      }
    }
  }
  return cost;
}

/**
 * Estimate the placement cost of a path (for budget checking).
 */
function estimatePathCost(
  map: { width: number; height: number; tiles: number[] },
  path: number[][],
  mode: PathMode,
): number {
  let cost = 0;
  for (const [px, py] of path) {
    const raw = map.tiles[py * map.width + px];
    const tileId = raw & BIT_MASK;

    // Bulldoze cost
    if (isTree(tileId) || isRubble(tileId)) cost += 1;

    // Placement cost (skip tiles that already have the right infra)
    if (mode === 'wire') {
      if (!isPowerLine(tileId) && !isPoweredRoad(tileId) && !(raw & CONDBIT)) {
        if (isWater(tileId)) cost += 25;
        else if (isRoad(tileId)) cost += 5;
        else cost += 5;
      }
    } else {
      if (!isRoad(tileId)) {
        if (isWater(tileId)) cost += 50;
        else cost += 10;
      }
    }
  }
  return cost;
}

/**
 * Dijkstra from zone at (x,y) to nearest powered tile; place power lines along the path.
 * Prefers routing through existing wires/powered roads (free traversal).
 * Supports water crossings and bulldozes trees along the path.
 */
export function autoPower(game: HeadlessGame, x: number, y: number, toolSize: number = 1): AutoAction {
  const map = game.getMap();

  // Check if origin is already powered or is a power plant
  const originRaw = map.tiles[y * map.width + x];
  const originTileId = originRaw & BIT_MASK;
  if ((originRaw & POWERBIT) || isPowerPlant(originTileId)) {
    return { type: 'power_line', path: [], cost: 0 };
  }

  const result = dijkstraPath(
    map, x, y, toolSize, 'wire',
    (raw, tileId) => (raw & POWERBIT) !== 0 || isPowerPlant(tileId),
  );

  if (result === null) {
    return { type: 'power_line', cost: 0, failed: true, reason: 'no_powered_tile_reachable' };
  }

  const { path } = result;

  // Budget guard: estimate total cost and check funds
  const funds = game.getStats().funds;
  const estimatedCost = estimatePathCost(map, path, 'wire');
  if (estimatedCost > funds) {
    return { type: 'power_line', cost: 0, failed: true, reason: 'insufficient_funds' };
  }

  // Phase 1: bulldoze trees/rubble along the path
  let totalCost = bulldozePath(game, path);

  // Phase 2: place wire on each path tile
  const placed: number[][] = [];
  for (const [px, py] of path) {
    const raw = map.tiles[py * map.width + px];
    const tileId = raw & BIT_MASK;

    // Skip tiles that already conduct power
    if (isPowerLine(tileId) || isPoweredRoad(tileId)) {
      placed.push([px, py]);
      continue;
    }

    const placeResult = game.placeTool('wire', px, py);
    if (placeResult.success) {
      totalCost += placeResult.cost;
      placed.push([px, py]);
    }
  }

  return { type: 'power_line', path: placed, cost: totalCost };
}

/**
 * Dijkstra from zone at (x,y) to nearest road tile; place road tiles along the path.
 * Prefers routing through existing roads (free traversal).
 * Supports water crossings and bulldozes trees along the path.
 */
export function autoRoad(game: HeadlessGame, x: number, y: number, toolSize: number = 1): AutoAction {
  const map = game.getMap();

  // Check if origin is already a road
  const originTileId = map.tiles[y * map.width + x] & BIT_MASK;
  if (isRoad(originTileId)) {
    return { type: 'road', path: [], cost: 0 };
  }

  const result = dijkstraPath(
    map, x, y, toolSize, 'road',
    (_raw, tileId) => isRoad(tileId),
  );

  if (result === null) {
    return { type: 'road', cost: 0, failed: true, reason: 'no_road_reachable' };
  }

  const { path } = result;

  // Budget guard: estimate total cost and check funds
  const funds = game.getStats().funds;
  const estimatedCost = estimatePathCost(map, path, 'road');
  if (estimatedCost > funds) {
    return { type: 'road', cost: 0, failed: true, reason: 'insufficient_funds' };
  }

  // Phase 1: bulldoze trees/rubble along the path
  let totalCost = bulldozePath(game, path);

  // Phase 2: place road on each path tile
  const placed: number[][] = [];
  for (const [px, py] of path) {
    const raw = map.tiles[py * map.width + px];
    const tileId = raw & BIT_MASK;

    // Skip tiles that already are roads
    if (isRoad(tileId)) {
      placed.push([px, py]);
      continue;
    }

    const placeResult = game.placeTool('road', px, py);
    if (placeResult.success) {
      totalCost += placeResult.cost;
      placed.push([px, py]);
    }
  }

  return { type: 'road', path: placed, cost: totalCost };
}
