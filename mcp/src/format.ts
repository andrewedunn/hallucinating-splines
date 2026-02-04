// ABOUTME: Response formatters that convert JSON API responses into readable text for LLMs.
// ABOUTME: Each function highlights what matters for gameplay decisions.

export function formatCreateCity(data: Record<string, unknown>): string {
  const lines = [
    `City created!`,
    `  ID: ${data.id}`,
    `  Name: ${data.name}`,
    `  Seed: ${data.seed}`,
    `  Funds: $${data.funds}`,
    `  Population: ${data.population}`,
    ``,
    `Next steps:`,
    `  1. Place a coal power plant (build_coal_power, $3000, 4×4)`,
    `  2. Zone residential/commercial/industrial near it`,
    `  3. Use auto_road and auto_power flags for automatic connections`,
    `  4. Advance time to let the city grow`,
  ];
  return lines.join('\n');
}

export function formatSeeds(data: Record<string, unknown>): string {
  const seeds = data.seeds as Array<Record<string, unknown>>;
  if (!seeds?.length) return 'No curated seeds available.';

  const lines = ['Curated map seeds:', ''];
  for (const s of seeds) {
    const parts = [`  Seed ${s.seed}`];
    if (s.terrain) parts.push(`terrain: ${s.terrain}`);
    if (s.water) parts.push(`water: ${s.water}`);
    if (s.description) parts.push(`— ${s.description}`);
    lines.push(parts.join('  '));
  }
  lines.push('', `Total: ${data.total || seeds.length}`);
  return lines.join('\n');
}

export function formatCityStats(data: Record<string, unknown>): string {
  const demand = data.demand as Record<string, number> | undefined;
  const census = data.census as Record<string, number> | undefined;
  const evaluation = data.evaluation as Record<string, unknown> | undefined;
  const budget = data.budget as Record<string, number> | undefined;

  const lines = [
    `City Stats (Year ${data.year}, Month ${data.month})`,
    `  Classification: ${data.classification}`,
    `  Population: ${data.population}`,
    `  Funds: $${data.funds}`,
    `  Score: ${data.score}`,
    `  Powered: ${data.isPowered ? 'yes' : 'no'}`,
  ];

  if (demand) {
    lines.push('', 'Demand (positive = city wants more):');
    lines.push(`  Residential: ${demand.residential > 0 ? '+' : ''}${demand.residential}`);
    lines.push(`  Commercial: ${demand.commercial > 0 ? '+' : ''}${demand.commercial}`);
    lines.push(`  Industrial: ${demand.industrial > 0 ? '+' : ''}${demand.industrial}`);
  }

  if (census) {
    lines.push('', 'Census:');
    lines.push(`  Residential pop: ${census.resPop}  Commercial pop: ${census.comPop}  Industrial pop: ${census.indPop}`);
    if (census.unpoweredZoneCount > 0) {
      lines.push(`  ⚠ Unpowered zones: ${census.unpoweredZoneCount} (need power connections)`);
    }
    if (census.crimeAverage > 50) {
      lines.push(`  ⚠ High crime: ${census.crimeAverage} (build police stations)`);
    }
    if (census.pollutionAverage > 50) {
      lines.push(`  ⚠ High pollution: ${census.pollutionAverage}`);
    }
  }

  if (evaluation) {
    lines.push('', `Approval: ${evaluation.approval}%`);
    const problems = evaluation.problems as string[] | undefined;
    if (problems?.length) {
      lines.push(`Problems: ${problems.join(', ')}`);
    }
  }

  if (budget) {
    lines.push('', `Budget: tax ${budget.taxRate}%, cash flow $${budget.cashFlow}`);
    lines.push(`  Road funding: ${budget.roadPercent}%  Fire: ${budget.firePercent}%  Police: ${budget.policePercent}%`);
  }

  return lines.join('\n');
}

export function formatMapSummary(data: Record<string, unknown>): string {
  const terrain = data.terrain as Record<string, number> | undefined;
  const buildings = data.buildings as Array<Record<string, unknown>> | undefined;
  const infra = data.infrastructure as Record<string, number> | undefined;
  const analysis = data.analysis as Record<string, unknown> | undefined;

  const lines = ['Map Summary'];

  if (terrain) {
    lines.push('', 'Terrain:');
    lines.push(`  Water: ${terrain.water_tiles}  Trees: ${terrain.tree_tiles}  Empty: ${terrain.empty_tiles}`);
  }

  if (buildings?.length) {
    const counts: Record<string, number> = {};
    let unpowered = 0;
    for (const b of buildings) {
      const t = b.type as string;
      counts[t] = (counts[t] || 0) + 1;
      if (!b.powered) unpowered++;
    }
    lines.push('', 'Buildings:');
    for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${type}: ${count}`);
    }
    if (unpowered > 0) {
      lines.push(`  ⚠ ${unpowered} unpowered buildings`);
    }
  } else {
    lines.push('', 'No buildings yet.');
  }

  if (infra) {
    lines.push('', 'Infrastructure:');
    lines.push(`  Roads: ${infra.road_tiles}  Rail: ${infra.rail_tiles}  Power lines: ${infra.power_line_tiles}`);
  }

  if (analysis) {
    const unpoweredCount = analysis.unpowered_buildings as number;
    const unroaded = analysis.unroaded_zones as number;
    if (unpoweredCount > 0 || unroaded > 0) {
      lines.push('', 'Issues:');
      if (unpoweredCount > 0) lines.push(`  ${unpoweredCount} buildings need power`);
      if (unroaded > 0) lines.push(`  ${unroaded} zones need road access`);
    }
    const empty = analysis.largest_empty_area as Record<string, unknown> | null;
    if (empty) {
      lines.push(``, `Largest empty area: ~${empty.approx_size} near (${empty.x}, ${empty.y})`);
    }
  }

  return lines.join('\n');
}

export function formatMapRegion(data: Record<string, unknown>): string {
  const x = data.x as number;
  const y = data.y as number;
  const w = data.width as number;
  const h = data.height as number;
  const tiles = data.tiles as number[][];

  const lines = [`Map region (${x},${y}) ${w}×${h}:`];

  if (!tiles?.length) {
    lines.push('  No tile data.');
    return lines.join('\n');
  }

  // Header row with x coordinates
  const colLabels = Array.from({ length: w }, (_, i) => String(x + i).padStart(4));
  lines.push('    ' + colLabels.join(''));

  for (let row = 0; row < tiles.length; row++) {
    const rowLabel = String(y + row).padStart(3);
    const cells = tiles[row].map((t) => {
      const tileId = t & 0x3ff;
      return String(tileId).padStart(4);
    });
    lines.push(`${rowLabel} ${cells.join('')}`);
  }

  return lines.join('\n');
}

export function formatBuildable(data: Record<string, unknown>): string {
  const action = data.action as string;
  const tool = data.tool as string;
  const size = data.size as Record<string, number> | undefined;
  const positions = data.valid_positions as Array<Record<string, number>> | undefined;
  const total = data.total_valid as number;

  const lines = [`Buildable positions for ${action || tool}:`];
  if (size) {
    lines.push(`  Size: ${size.width}×${size.height}`);
  }
  lines.push(`  Total valid: ${total}`);

  if (positions?.length) {
    const sample = positions.slice(0, 20);
    lines.push('', '  Sample positions:');
    for (const p of sample) {
      lines.push(`    (${p.x}, ${p.y})`);
    }
    if (total > 20) {
      lines.push(`    ... and ${total - 20} more`);
    }
  } else {
    lines.push('', '  No valid positions found. The map may be full or terrain blocks placement.');
  }

  return lines.join('\n');
}

export function formatActionResult(data: Record<string, unknown>): string {
  const success = data.success as boolean;
  const cost = data.cost as number;
  const fundsRemaining = data.funds_remaining as number | undefined;
  const autoActions = data.auto_actions as Array<Record<string, unknown>> | undefined;

  if (!success) {
    const reason = (data.reason as string) || (data.error as string) || 'unknown';
    return `Action failed: ${reason}`;
  }

  const lines = [`Action succeeded.`];
  if (cost !== undefined) lines.push(`  Cost: $${cost}`);
  if (fundsRemaining !== undefined) lines.push(`  Funds remaining: $${fundsRemaining}`);

  if (autoActions?.length) {
    lines.push('', '  Auto-infrastructure:');
    for (const a of autoActions) {
      const tilesOrPath = (a.path || a.tiles) as Array<[number, number]> | undefined;
      const count = tilesOrPath?.length || 0;
      const typeName = a.type === 'bulldoze' ? 'cleared' : (a.type as string || 'infra');
      lines.push(`    ${typeName}: ${count} placed (cost: $${a.cost || 0})`);
    }
  }

  return lines.join('\n');
}

export function formatLineRectResult(data: Record<string, unknown>): string {
  const success = data.success as boolean;
  const cost = data.cost as number;
  const placed = data.tiles_placed as number;
  const attempted = data.tiles_attempted as number;
  const fundsRemaining = data.funds_remaining as number | undefined;

  if (!success) {
    return `Action failed: no tiles could be placed (${attempted} attempted)`;
  }

  const lines = [`Placed ${placed}/${attempted} tiles.`];
  lines.push(`  Cost: $${cost}`);
  if (fundsRemaining !== undefined) lines.push(`  Funds remaining: $${fundsRemaining}`);
  return lines.join('\n');
}

export function formatBatchResult(data: Record<string, unknown>): string {
  const results = data.results as Array<Record<string, unknown>> | undefined;
  const totalCost = data.total_cost as number;
  const completed = data.completed as number;
  const total = data.total as number;
  const fundsRemaining = data.funds_remaining as number | undefined;

  const lines = [`Batch: ${completed}/${total} actions completed.`];
  lines.push(`  Total cost: $${totalCost}`);
  if (fundsRemaining !== undefined) lines.push(`  Funds remaining: $${fundsRemaining}`);

  if (results?.length) {
    lines.push('');
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const status = r.success ? 'ok' : `FAILED${r.reason ? ` (${r.reason})` : ''}`;
      lines.push(`  ${i + 1}. ${status} — $${r.cost || 0}`);
    }
  }

  return lines.join('\n');
}

export function formatBudgetResult(data: Record<string, unknown>): string {
  const budget = data.budget as Record<string, number> | undefined;
  const funds = data.funds as number | undefined;

  const lines = ['Budget updated.'];
  if (budget) {
    lines.push(`  Tax rate: ${budget.taxRate}%`);
    lines.push(`  Cash flow: $${budget.cashFlow}`);
    lines.push(`  Road funding: ${budget.roadPercent}%  Fire: ${budget.firePercent}%  Police: ${budget.policePercent}%`);
  }
  if (funds !== undefined) {
    lines.push(`  Current funds: $${funds}`);
  }
  return lines.join('\n');
}

export function formatAdvanceResult(data: Record<string, unknown>): string {
  const months = data.months_advanced as number;
  const year = data.year as number;
  const month = data.month as number;
  const pop = data.population as number;
  const funds = data.funds as number;
  const demand = data.demand as Record<string, number> | undefined;
  const ended = data.city_ended as boolean;
  const endedReason = data.ended_reason as string | undefined;

  const lines = [
    `Advanced ${months} month${months === 1 ? '' : 's'} → Year ${year}, Month ${month}`,
    `  Population: ${pop}`,
    `  Funds: $${funds}`,
  ];

  if (demand) {
    lines.push(`  Demand — R: ${demand.residential > 0 ? '+' : ''}${demand.residential}  C: ${demand.commercial > 0 ? '+' : ''}${demand.commercial}  I: ${demand.industrial > 0 ? '+' : ''}${demand.industrial}`);
  }

  if (ended) {
    lines.push('', `⚠ City ended${endedReason ? `: ${endedReason}` : ''}`);
  }

  return lines.join('\n');
}

export function formatActionLog(data: Record<string, unknown>): string {
  const actions = data.actions as Array<Record<string, unknown>> | undefined;
  const total = data.total as number;

  if (!actions?.length) return 'No actions recorded yet.';

  const lines = [`Action log (${total} total):`];
  for (const a of actions) {
    const params = a.params as Record<string, unknown> | undefined;
    const xy = params ? `(${params.x}, ${params.y})` : '';
    lines.push(`  Year ${a.game_year} | ${a.action_type} ${xy} | ${a.result} | cost: $${a.cost || 0}`);
  }

  return lines.join('\n');
}

export function formatCityList(data: Record<string, unknown>): string {
  const cities = data.cities as Array<Record<string, unknown>> | undefined;
  const total = data.total as number;

  if (!cities?.length) return 'No cities found.';

  const lines = [`Cities (${total} total):`];
  for (const c of cities) {
    lines.push(`  ${c.name} (${c.id}) — pop: ${c.population}, year: ${c.game_year}, score: ${c.score}, status: ${c.status}`);
  }

  return lines.join('\n');
}
