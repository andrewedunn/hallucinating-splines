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

  private async ensureGame(): Promise<HeadlessGame> {
    if (this.game) return this.game;

    const stored = await this.ctx.storage.get<CityState>('state');
    if (stored) {
      this.cityId = stored.cityId;
      this.seed = stored.seed;
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
    const game = await this.ensureGame();
    const tickResult = game.tick(months);
    await this.persist();
    return {
      months_advanced: months,
      ...tickResult,
      demand: game.getDemand(),
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
