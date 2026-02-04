// ABOUTME: Main public API for the headless micropolisJS engine.
// ABOUTME: Wraps Simulation, GameTools, and TickRunner into a clean interface for programmatic control.

import { GameMap } from './engine/gameMap.js';
import { MapGenerator } from './engine/mapGenerator.js';
import { Simulation } from './engine/simulation.js';
import { GameTools } from './engine/gameTools.js';
import { TickRunner } from './tickRunner';
import { withSeed } from './seededRandom';
import type {
  TickResult,
  CityStats,
  TileInfo,
  MapData,
  DemandLevels,
  PlaceResult,
  BudgetOpts,
  FullCityStats,
  CensusHistory,
} from './types';

// 1 month = 4 cityTime units. 1 cityTime = 16 phase ticks. So 1 month = 64 ticks.
const TICKS_PER_MONTH = 64;

const PROBLEM_NAMES: Record<number, string> = {
  0: 'crime',
  1: 'pollution',
  2: 'housing',
  3: 'taxes',
  4: 'traffic',
  5: 'unemployment',
  6: 'fire',
};

const CITY_CLASS_NAMES: Record<string, string> = {
  VILLAGE: 'Village',
  TOWN: 'Town',
  CITY: 'City',
  CAPITAL: 'Capital',
  METROPOLIS: 'Metropolis',
  MEGALOPOLIS: 'Megalopolis',
};

export class HeadlessGame {
  private sim: any;
  private map: any;
  private tools: any;
  private runner: TickRunner;

  private constructor(map: any, savedGame?: any) {
    this.map = map;
    this.sim = new Simulation(
      map,
      Simulation.LEVEL_EASY,
      Simulation.SPEED_SLOW,
      savedGame,
    );
    this.sim.disasterManager.disastersEnabled = false;
    this.tools = GameTools(map);
    this.runner = new TickRunner(this.sim);
  }

  static fromSeed(seed: number): HeadlessGame {
    const map = withSeed(seed, () => MapGenerator(120, 100));
    return new HeadlessGame(map);
  }

  static fromSave(data: any): HeadlessGame {
    const map = new (GameMap as any)(120, 100);
    return new HeadlessGame(map, data);
  }

  /**
   * Advance the simulation by `months` months.
   * Each month is ~4 simulation ticks.
   */
  tick(months: number): TickResult {
    const totalTicks = months * TICKS_PER_MONTH;
    this.runner.tick(totalTicks);
    const date = this.sim.getDate();
    const pop = this.sim.evaluation.getPopulation(this.sim._census);
    return {
      cityTime: this.sim._cityTime,
      year: date.year,
      month: date.month,
      population: pop,
      funds: this.sim.budget.totalFunds,
    };
  }

  /**
   * Place a tool at the given coordinates.
   * Tool names: bulldozer, road, rail, wire, park, residential, commercial,
   * industrial, coal, nuclear, fire, police, port, airport, stadium, query
   */
  placeTool(toolName: string, x: number, y: number): PlaceResult {
    const tool = this.tools[toolName];
    if (!tool) {
      return { success: false, cost: 0, result: -1 };
    }

    tool.doTool(x, y, this.sim.blockMaps);
    const applied = tool.modifyIfEnoughFunding(this.sim.budget);
    const result = tool.result ?? (applied ? 0 : 1);

    return {
      success: applied,
      cost: applied ? tool.toolCost : 0,
      result,
    };
  }

  setTaxRate(rate: number): void {
    this.sim.budget.cityTax = rate;
  }

  setBudget(opts: BudgetOpts): void {
    if (opts.fire !== undefined) this.sim.budget.firePercent = opts.fire / 100;
    if (opts.police !== undefined) this.sim.budget.policePercent = opts.police / 100;
    if (opts.road !== undefined) this.sim.budget.roadPercent = opts.road / 100;
  }

  getStats(): CityStats {
    const date = this.sim.getDate();
    const pop = this.sim.evaluation.getPopulation(this.sim._census);
    const classKey = this.sim.evaluation.cityClass || 'VILLAGE';
    return {
      population: pop,
      score: this.sim.evaluation.cityScore,
      funds: this.sim.budget.totalFunds,
      cityTime: this.sim._cityTime,
      year: date.year,
      month: date.month,
      classification: CITY_CLASS_NAMES[classKey] || classKey,
      isPowered: this.sim._census.poweredZoneCount > 0,
    };
  }

  getMap(): MapData {
    const w = this.map.width;
    const h = this.map.height;
    const tiles: number[] = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        tiles[y * w + x] = this.map.getTile(x, y).getValue();
      }
    }
    return { width: w, height: h, tiles };
  }

  getRawMap(): MapData {
    const w = this.map.width;
    const h = this.map.height;
    const tiles: number[] = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        tiles[y * w + x] = this.map.getTile(x, y).getRawValue();
      }
    }
    return { width: w, height: h, tiles };
  }

  getTile(x: number, y: number): TileInfo {
    return {
      value: this.map.getTile(x, y).getValue(),
      x,
      y,
    };
  }

  getDemand(): DemandLevels {
    return {
      residential: this.sim._valves.resValve,
      commercial: this.sim._valves.comValve,
      industrial: this.sim._valves.indValve,
    };
  }

  getFullStats(): FullCityStats {
    const base = this.getStats();
    const census = this.sim._census;
    const evaluation = this.sim.evaluation;
    const budget = this.sim.budget;

    const problems: string[] = [];
    for (let i = 0; i < 4; i++) {
      const idx = evaluation.getProblemNumber(i);
      if (idx !== null && PROBLEM_NAMES[idx] !== undefined) {
        problems.push(PROBLEM_NAMES[idx]);
      }
    }

    return {
      ...base,
      demand: this.getDemand(),
      census: {
        resPop: census.resPop,
        comPop: census.comPop,
        indPop: census.indPop,
        roadTotal: census.roadTotal,
        railTotal: census.railTotal,
        poweredZoneCount: census.poweredZoneCount,
        unpoweredZoneCount: census.unpoweredZoneCount,
        policeStationPop: census.policeStationPop,
        fireStationPop: census.fireStationPop,
        coalPowerPop: census.coalPowerPop,
        nuclearPowerPop: census.nuclearPowerPop,
        seaportPop: census.seaportPop,
        airportPop: census.airportPop,
        stadiumPop: census.stadiumPop,
        crimeAverage: census.crimeAverage,
        pollutionAverage: census.pollutionAverage,
        landValueAverage: census.landValueAverage,
      },
      evaluation: {
        approval: evaluation.cityYes,
        populationDelta: evaluation.cityPopDelta,
        assessedValue: evaluation.cityAssessedValue,
        scoreDelta: evaluation.cityScoreDelta,
        problems,
      },
      budget: {
        taxRate: budget.cityTax,
        cashFlow: budget.cashFlow,
        roadPercent: Math.round(budget.roadPercent * 100),
        firePercent: Math.round(budget.firePercent * 100),
        policePercent: Math.round(budget.policePercent * 100),
        roadEffect: budget.roadEffect,
        fireEffect: budget.fireEffect,
        policeEffect: budget.policeEffect,
        roadMaintenanceBudget: budget.roadMaintenanceBudget,
        fireMaintenanceBudget: budget.fireMaintenanceBudget,
        policeMaintenanceBudget: budget.policeMaintenanceBudget,
      },
    };
  }

  getCensusHistory(): CensusHistory {
    const census = this.sim._census;
    return {
      residential: Array.from(census.resHist120),
      commercial: Array.from(census.comHist120),
      industrial: Array.from(census.indHist120),
      crime: Array.from(census.crimeHist120),
      pollution: Array.from(census.pollutionHist120),
      money: Array.from(census.moneyHist120),
    };
  }

  normalizeCensus(): void {
    // After fromSave(), init() runs mapScan + doPowerScan. But mapScan counts
    // powered zones using stale POWERBIT flags, and census populations are
    // double-counted (saved values + mapScan re-adds). Fix by:
    // 1. Clear census, run mapScan to discover power plants and populate powerStack
    // 2. Run doPowerScan to fill powerGridMap from powerStack
    // 3. Clear census again, run mapScan with correct powerGridMap so setTilePower
    //    correctly sets POWERBIT flags before zone counting
    this.sim._clearCensus();
    const simData = this.sim._constructSimData();
    this.sim._mapScanner.mapScan(0, this.map.width, simData);
    this.sim._powerManager.doPowerScan(this.sim._census);
    this.sim._clearCensus();
    this.sim._mapScanner.mapScan(0, this.map.width, this.sim._constructSimData());
    this.sim._powerManager.doPowerScan(this.sim._census);
  }

  save(): any {
    const saveData: any = {};
    this.sim.save(saveData);
    return saveData;
  }
}
