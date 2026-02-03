// ABOUTME: Drives the micropolisJS simulation forward without Date-based throttling.
// ABOUTME: Bypasses _simFrame's time check by calling _constructSimData/_simulate/_updateTime directly.

export class TickRunner {
  private sim: any;

  constructor(sim: any) {
    this.sim = sim;
  }

  /**
   * Advance the simulation by `count` ticks.
   * Each tick is one phase step (16 ticks = 1 full cycle = 1 cityTime increment).
   */
  tick(count: number): void {
    for (let i = 0; i < count; i++) {
      this.resolveBudgetIfNeeded();
      const simData = this.sim._constructSimData();
      this.sim._simulate(simData);
      this.sim._updateTime();
    }
  }

  private resolveBudgetIfNeeded(): void {
    if (this.sim.budget.awaitingValues) {
      this.sim.budget.doBudgetNow(true);
    }
  }
}
