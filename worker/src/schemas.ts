// ABOUTME: Shared Zod schemas for OpenAPI route definitions.
// ABOUTME: Used across route files for request/response validation and spec generation.

import { z } from '@hono/zod-openapi';

// --- Path params ---

export const CityIdParam = z.string().regex(/^city_/).openapi({
  param: { name: 'id', in: 'path' },
  example: 'city_1a2b3c4d5e6f7890',
});

export const MayorIdParam = z.string().regex(/^key_/).openapi({
  param: { name: 'id', in: 'path' },
  example: 'key_1a2b3c4d5e6f7890',
});

export const SnapshotYearParam = z.string().regex(/^\d+$/).openapi({
  param: { name: 'year', in: 'path' },
  example: '1901',
});

// --- Common response schemas ---

export const ErrorSchema = z.object({
  error: z.string(),
  reason: z.string().optional(),
}).openapi('Error');

// --- Keys schemas ---

export const KeyStatusSchema = z.object({
  active: z.number(),
  limit: z.number(),
  available: z.boolean(),
}).openapi('KeyStatus');

export const CreateKeySchema = z.object({
  key: z.string(),
  mayor: z.string(),
  welcome: z.string(),
  note: z.string(),
}).openapi('CreateKeyResponse');

// --- Seeds schemas ---

export const SeedSchema = z.object({
  seed: z.number(),
  terrain: z.string().optional(),
  water: z.string().optional(),
  description: z.string().optional(),
}).openapi('Seed');

export const SeedsResponseSchema = z.object({
  seeds: z.array(z.any()),
  total: z.number(),
}).openapi('SeedsResponse');

// --- City schemas ---

export const CitySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  mayor: z.string().optional(),
  mayor_id: z.string().optional(),
  population: z.number(),
  game_year: z.number(),
  score: z.number(),
  status: z.string(),
  seed: z.number(),
  updated_at: z.string().optional(),
}).openapi('CitySummary');

export const CityListSchema = z.object({
  cities: z.array(z.any()),
  total: z.number(),
}).openapi('CityList');

export const CreateCityBodySchema = z.object({
  seed: z.number().optional(),
}).openapi('CreateCityBody');

export const CreateCityResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.number(),
  game_year: z.number(),
  funds: z.number(),
  population: z.number(),
  demand: z.any(),
}).openapi('CreateCityResponse');

export const RetireCityResponseSchema = z.object({
  retired: z.boolean(),
  message: z.string(),
}).openapi('RetireCityResponse');

// --- Action schemas ---

export const ActionNameEnum = z.enum([
  'zone_residential', 'zone_commercial', 'zone_industrial',
  'build_road', 'build_rail', 'build_power_line', 'build_park',
  'build_fire_station', 'build_police_station',
  'build_coal_power', 'build_nuclear_power',
  'build_seaport', 'build_airport', 'build_stadium', 'bulldoze',
  'build_road_line', 'build_rail_line', 'build_wire_line',
  'build_road_rect', 'build_rail_rect', 'build_wire_rect',
]).openapi('ActionName');

export const PlaceActionBodySchema = z.object({
  action: ActionNameEnum,
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  x1: z.number().int().optional(),
  y1: z.number().int().optional(),
  x2: z.number().int().optional(),
  y2: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  auto_bulldoze: z.boolean().optional(),
  auto_power: z.boolean().optional(),
  auto_road: z.boolean().optional(),
}).openapi('PlaceActionBody');

export const PlaceActionResponseSchema = z.object({
  success: z.boolean(),
  cost: z.number(),
  funds_remaining: z.number().optional(),
  auto_actions: z.any().optional(),
}).openapi('PlaceActionResponse');

export const BudgetBodySchema = z.object({
  tax_rate: z.number().min(0).max(20).optional(),
  fire_percent: z.number().min(0).max(100).optional(),
  police_percent: z.number().min(0).max(100).optional(),
  road_percent: z.number().min(0).max(100).optional(),
}).openapi('BudgetBody');

export const BudgetResponseSchema = z.object({
  success: z.boolean(),
  budget: z.any().optional(),
  funds: z.number().optional(),
}).openapi('BudgetResponse');

export const AdvanceBodySchema = z.object({
  months: z.number().int().min(1).max(24).optional().default(1),
}).openapi('AdvanceBody');

// --- Leaderboard schemas ---

export const LeaderboardSchema = z.object({
  cities: z.object({
    by_population: z.array(z.any()),
    by_score: z.array(z.any()),
  }),
  mayors: z.object({
    by_best_population: z.array(z.any()),
    by_total_cities: z.array(z.any()),
  }),
}).openapi('Leaderboard');

// --- Mayor schemas ---

export const MayorProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  stats: z.object({
    total_cities: z.number(),
    best_population: z.number(),
    best_score: z.number(),
  }),
  cities: z.array(z.any()),
}).openapi('MayorProfile');

// --- Query param schemas ---

export const CityListQuerySchema = z.object({
  sort: z.enum(['newest', 'active', 'population', 'score']).optional().default('newest'),
  status: z.enum(['all', 'active', 'ended']).optional().default('all'),
  mine: z.enum(['true', 'false']).optional().openapi({ description: 'Filter by ownership. Defaults to true when authenticated (shows only your cities). Pass false to see all cities.' }),
  limit: z.string().optional().default('20'),
  offset: z.string().optional().default('0'),
}).openapi('CityListQuery');

export const PaginationQuerySchema = z.object({
  limit: z.string().optional().default('50'),
  offset: z.string().optional().default('0'),
}).openapi('PaginationQuery');

export const BuildableQuerySchema = z.object({
  action: z.string(),
}).openapi('BuildableQuery');

export const RegionQuerySchema = z.object({
  x: z.string().optional().default('0'),
  y: z.string().optional().default('0'),
  w: z.string().optional().default('20'),
  h: z.string().optional().default('20'),
}).openapi('RegionQuery');
