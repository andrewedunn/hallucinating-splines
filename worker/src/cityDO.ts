// ABOUTME: Durable Object that holds one HeadlessGame instance per city.
// ABOUTME: Persists game state to DO storage, restores on wake from hibernation.

import { DurableObject } from 'cloudflare:workers';
import { HeadlessGame } from '../../src/headlessGame';
import { withSeed } from '../../src/seededRandom';

interface CityState {
  seed: number;
  cityId: string;
  saveData: any;
}

type Env = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
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
