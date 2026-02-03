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
