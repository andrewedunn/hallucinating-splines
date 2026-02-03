// ABOUTME: Tests for the TickRunner that drives the simulation forward without Date-based throttling.
// ABOUTME: Verifies phase cycle advancement, city time progression, and budget auto-resolution.

import { MapGenerator } from '../src/engine/mapGenerator.js';
import { Simulation } from '../src/engine/simulation.js';
import { TickRunner } from '../src/tickRunner.js';
import { withSeed } from '../src/seededRandom.js';

function createSimulation() {
  const map = withSeed(42, () => MapGenerator(120, 100));
  return new Simulation(map, Simulation.LEVEL_EASY, Simulation.SPEED_SLOW);
}

describe('TickRunner', () => {
  test('single tick advances _phaseCycle', () => {
    const sim = createSimulation();
    const initialPhase = sim._phaseCycle;
    const runner = new TickRunner(sim);
    runner.tick(1);
    // After first tick from init, _simulate is replaced, and phase advances
    expect(sim._phaseCycle).toBe((initialPhase + 1) & 15);
  });

  test('16 ticks complete a full phase cycle and increment _cityTime', () => {
    const sim = createSimulation();
    const initialCityTime = sim._cityTime;
    const runner = new TickRunner(sim);
    runner.tick(16);
    // Phase 0 increments _cityTime, so after 16 ticks we should have gone
    // through phase 0 once
    expect(sim._cityTime).toBe(initialCityTime + 1);
  });

  test('48 ticks advance one month (cityTime increments by 3)', () => {
    const sim = createSimulation();
    const runner = new TickRunner(sim);
    // 48 ticks = 3 full phase cycles = cityTime increments 3 times
    // Each phase cycle is 16 ticks, phase 0 increments cityTime
    runner.tick(48);
    expect(sim._cityTime).toBe(3);
  });

  test('budget auto-resolution when awaitingValues is true', () => {
    const sim = createSimulation();
    const runner = new TickRunner(sim);

    // Force the budget to be awaiting values
    sim.budget.awaitingValues = true;
    sim.budget.autoBudget = false;

    // Tick should auto-resolve the budget and continue
    runner.tick(1);

    // Budget should no longer be awaiting values
    expect(sim.budget.awaitingValues).toBe(false);
  });

  test('many ticks do not throw', () => {
    const sim = createSimulation();
    const runner = new TickRunner(sim);
    // Run 160 ticks (10 full cycles) without error
    expect(() => runner.tick(160)).not.toThrow();
    expect(sim._cityTime).toBe(10);
  });
});
