// ABOUTME: Durable Object that holds one HeadlessGame instance per city.
// ABOUTME: Persists game state to DO storage, restores on wake from hibernation.

import { DurableObject } from 'cloudflare:workers';
import { HeadlessGame } from '../../src/headlessGame';
import { withSeed } from '../../src/seededRandom';
import { autoBulldoze, autoPower, autoRoad } from './autoInfra';
import type { AutoAction } from './autoInfra';
import { analyzeMap } from './mapAnalysis';

interface CityState {
  seed: number;
  cityId: string;
  saveData: any;
  zeroFundsMonths: number;
}

type Env = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
  SNAPSHOTS: R2Bucket;
};

export class CityDO extends DurableObject<Env> {
  private game: HeadlessGame | null = null;
  private cityId: string | null = null;
  private seed: number | null = null;
  private zeroFundsMonths: number = 0;
  private actionTimestamps: number[] = [];
  private advanceTimestamps: number[] = [];

  private checkRateLimit(timestamps: number[], maxPerMinute: number): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    while (timestamps.length > 0 && timestamps[0] < oneMinuteAgo) {
      timestamps.shift();
    }
    if (timestamps.length >= maxPerMinute) {
      return false;
    }
    timestamps.push(now);
    return true;
  }

  private async ensureGame(): Promise<HeadlessGame> {
    if (this.game) return this.game;

    const stored = await this.ctx.storage.get<CityState>('state');
    if (stored) {
      this.cityId = stored.cityId;
      this.seed = stored.seed;
      this.zeroFundsMonths = stored.zeroFundsMonths || 0;
      this.game = HeadlessGame.fromSave(stored.saveData);
    }

    if (!this.game) {
      throw new Error('CityDO has no game state. Call init() first.');
    }

    return this.game;
  }

  private async persist(): Promise<void> {
    if (!this.game || !this.cityId || this.seed === null) return;
    const state: CityState = {
      seed: this.seed,
      cityId: this.cityId,
      saveData: this.game.save(),
      zeroFundsMonths: this.zeroFundsMonths,
    };
    await this.ctx.storage.put('state', state);
  }

  // --- RPC methods called by the Worker ---

  async init(cityId: string, seed: number): Promise<any> {
    this.cityId = cityId;
    this.seed = seed;
    this.game = withSeed(seed, () => HeadlessGame.fromSeed(seed));
    await this.persist();
    return this.getStatsInternal();
  }

  async placeToolAction(toolName: string, x: number, y: number): Promise<any> {
    if (!this.checkRateLimit(this.actionTimestamps, 30)) {
      return { success: false, error: 'rate_limited', reason: 'Max 30 actions per minute' };
    }
    const game = await this.ensureGame();
    const result = game.placeTool(toolName, x, y);
    if (result.success) {
      await this.persist();
    }
    return { ...result, stats: this.getStatsInternal() };
  }

  async placeToolWithAuto(
    toolName: string,
    x: number,
    y: number,
    flags: { auto_bulldoze?: boolean; auto_power?: boolean; auto_road?: boolean },
  ): Promise<any> {
    if (!this.checkRateLimit(this.actionTimestamps, 30)) {
      return { success: false, error: 'rate_limited', reason: 'Max 30 actions per minute' };
    }
    const game = await this.ensureGame();
    const autoActions: AutoAction[] = [];

    // Tool size lookup for auto-bulldoze footprint
    const TOOL_SIZES: Record<string, number> = {
      residential: 3, commercial: 3, industrial: 3,
      coal: 4, nuclear: 4, port: 4, stadium: 4,
      airport: 6,
    };
    const toolSize = TOOL_SIZES[toolName] ?? 1;

    // Step 1: auto-bulldoze before placement
    if (flags.auto_bulldoze) {
      const bdResult = autoBulldoze(game, x, y, toolSize);
      if (bdResult.tiles && bdResult.tiles.length > 0) {
        autoActions.push(bdResult);
      }
    }

    // Step 2: primary placement
    const result = game.placeTool(toolName, x, y);

    if (result.success) {
      // Step 3: auto-power after successful placement
      if (flags.auto_power) {
        const pwResult = autoPower(game, x, y);
        if (!pwResult.failed) {
          autoActions.push(pwResult);
        }
      }

      // Step 4: auto-road after successful placement
      if (flags.auto_road) {
        const rdResult = autoRoad(game, x, y);
        if (!rdResult.failed) {
          autoActions.push(rdResult);
        }
      }

      await this.persist();
    }

    const autoCost = autoActions.reduce((sum, a) => sum + a.cost, 0);

    return {
      ...result,
      cost: result.cost + autoCost,
      auto_actions: autoActions,
      stats: this.getStatsInternal(),
    };
  }

  async advance(months: number): Promise<any> {
    if (!this.checkRateLimit(this.advanceTimestamps, 10)) {
      return { error: 'rate_limited', reason: 'Max 10 advances per minute' };
    }
    const game = await this.ensureGame();
    const tickResult = game.tick(months);

    // Track bankruptcy (funds are clamped to 0, never negative)
    const stats = game.getStats();
    if (stats.funds === 0) {
      this.zeroFundsMonths += months;
    } else {
      this.zeroFundsMonths = 0;
    }

    const bankrupt = this.zeroFundsMonths >= 12;

    await this.persist();
    return {
      months_advanced: months,
      ...tickResult,
      demand: game.getDemand(),
      city_ended: bankrupt,
      ended_reason: bankrupt ? 'bankruptcy' : undefined,
    };
  }

  async getStats(): Promise<any> {
    await this.ensureGame();
    return this.getStatsInternal();
  }

  async getMapData(): Promise<any> {
    const game = await this.ensureGame();
    return game.getMap();
  }

  async getMapRegion(x: number, y: number, w: number, h: number): Promise<any> {
    const game = await this.ensureGame();
    const fullMap = game.getMap();
    const tiles: number[][] = [];
    for (let row = y; row < y + h && row < fullMap.height; row++) {
      const rowTiles: number[] = [];
      for (let col = x; col < x + w && col < fullMap.width; col++) {
        rowTiles.push(fullMap.tiles[row * fullMap.width + col]);
      }
      tiles.push(rowTiles);
    }
    return { x, y, width: w, height: h, tiles };
  }

  async getDemandData(): Promise<any> {
    const game = await this.ensureGame();
    return game.getDemand();
  }

  async getSnapshotData(): Promise<any> {
    const game = await this.ensureGame();
    const stats = this.game!.getStats();
    const mapData = this.game!.getMap();
    return {
      city_id: this.cityId,
      game_year: stats.year,
      population: stats.population,
      funds: stats.funds,
      score: stats.score,
      tiles: mapData.tiles,
    };
  }

  async getMapSummary(): Promise<any> {
    const game = await this.ensureGame();
    const mapData = game.getMap();
    return analyzeMap(mapData.tiles, mapData.width, mapData.height);
  }

  async getBuildablePositions(toolName: string, maxResults: number = 200): Promise<any> {
    const game = await this.ensureGame();
    const mapData = game.getMap();
    const { width, height, tiles } = mapData;

    const toolSizes: Record<string, number> = {
      residential: 3, commercial: 3, industrial: 3,
      coal: 4, nuclear: 4, fire: 3, police: 3,
      port: 4, airport: 6, stadium: 4,
      road: 1, rail: 1, wire: 1, park: 1, bulldozer: 1,
    };
    const size = toolSizes[toolName] || 1;
    const halfSize = Math.floor(size / 2);

    const validPositions: number[][] = [];

    for (let y = halfSize; y < height - halfSize; y++) {
      for (let x = halfSize; x < width - halfSize; x++) {
        let allClear = true;
        for (let dy = -halfSize; dy < size - halfSize && allClear; dy++) {
          for (let dx = -halfSize; dx < size - halfSize && allClear; dx++) {
            const tx = x + dx, ty = y + dy;
            const tileId = tiles[ty * width + tx] & 0x3FF;
            if (tileId !== 0 && !(tileId >= 21 && tileId <= 39)) {
              allClear = false;
            }
          }
        }
        if (allClear) validPositions.push([x, y]);
      }
    }

    let sampled = validPositions;
    if (validPositions.length > maxResults) {
      sampled = [];
      const step = Math.floor(validPositions.length / maxResults);
      for (let i = 0; i < validPositions.length && sampled.length < maxResults; i += step) {
        sampled.push(validPositions[i]);
      }
    }

    return {
      tool: toolName,
      size: { width: size, height: size },
      valid_positions: sampled.map(([x, y]) => ({ x, y })),
      total_valid: validPositions.length,
    };
  }

  async deleteCity(): Promise<void> {
    this.game = null;
    await this.ctx.storage.deleteAll();
  }

  private getStatsInternal(): any {
    if (!this.game) return null;
    const stats = this.game.getStats();
    const demand = this.game.getDemand();
    return { ...stats, demand };
  }
}
