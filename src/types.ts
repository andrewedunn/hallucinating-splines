// ABOUTME: Public TypeScript interfaces for the HeadlessGame API.
// ABOUTME: Defines shapes for tick results, city stats, tile info, and tool results.

export interface TickResult {
  cityTime: number;
  year: number;
  month: number;
  population: number;
  funds: number;
}

export interface CityStats {
  population: number;
  score: number;
  funds: number;
  cityTime: number;
  year: number;
  month: number;
  classification: string;
  isPowered: boolean;
}

export interface TileInfo {
  value: number;
  x: number;
  y: number;
}

export interface MapData {
  width: number;
  height: number;
  tiles: number[];
}

export interface DemandLevels {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface PlaceResult {
  success: boolean;
  cost: number;
  result: number; // TOOLRESULT_* constant
}

export interface BudgetOpts {
  fire?: number;
  police?: number;
  road?: number;
}

export interface CensusData {
  resPop: number;
  comPop: number;
  indPop: number;
  roadTotal: number;
  railTotal: number;
  poweredZoneCount: number;
  unpoweredZoneCount: number;
  policeStationPop: number;
  fireStationPop: number;
  coalPowerPop: number;
  nuclearPowerPop: number;
  seaportPop: number;
  airportPop: number;
  stadiumPop: number;
  crimeAverage: number;
  pollutionAverage: number;
  landValueAverage: number;
}

export interface EvaluationData {
  approval: number;
  populationDelta: number;
  assessedValue: number;
  scoreDelta: number;
  problems: string[];
}

export interface BudgetData {
  taxRate: number;
  cashFlow: number;
  roadPercent: number;
  firePercent: number;
  policePercent: number;
  roadEffect: number;
  fireEffect: number;
  policeEffect: number;
  roadMaintenanceBudget: number;
  fireMaintenanceBudget: number;
  policeMaintenanceBudget: number;
}

export interface CensusHistory {
  residential: number[];
  commercial: number[];
  industrial: number[];
  crime: number[];
  pollution: number[];
  money: number[];
}

export interface FullCityStats extends CityStats {
  demand: DemandLevels;
  census: CensusData;
  evaluation: EvaluationData;
  budget: BudgetData;
}
