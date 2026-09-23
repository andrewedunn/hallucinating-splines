// ABOUTME: Regression tests for actionable MCP placement and batch feedback.
// ABOUTME: Ensures partial work and failed automatic connections remain visible.
import { formatActionResult, formatBatchResult, formatCreateCity, formatCityList } from '../mcp/src/format';

test('gives agents a public city link on creation and when resuming', () => {
  const city = { id: 'city_abcdef1234567890', name: 'Crystal Bay', slug: 'crystal-bay-abcd', population: 0 };
  const url = 'https://hallucinatingsplines.com/cities/crystal-bay-abcd';
  expect(formatCreateCity(city)).toContain(url);
  expect(formatCityList({ cities: [city], total: 1 })).toContain(url);
});

test('does not invent public links when the API omits a slug or returns an invalid one', () => {
  for (const slug of [undefined, '//example.com', '../keys', 'city?key=secret']) {
    const city = { id: 'city_abcdef1234567890', name: 'Crystal Bay', slug };
    expect(formatCreateCity(city)).not.toContain('https://');
    expect(formatCityList({ cities: [city], total: 1 })).not.toContain('https://');
  }
});

test('reports automatic connection failures after a successful building placement', () => {
  expect(formatActionResult({ success: true, cost: 100, auto_actions: [
    { type: 'power_line', failed: true, reason: 'no_powered_tile_reachable', cost: 0 },
  ] })).toContain('FAILED (no_powered_tile_reachable)');
});

test('distinguishes attempted, successful, and skipped batch actions', () => {
  const text = formatBatchResult({ completed: 2, total: 3, total_cost: 100, results: [
    { success: true, cost: 100, auto_actions: [{ type: 'road', failed: true, reason: 'insufficient_funds' }] },
    { success: false, cost: 0, reason: 'needs_bulldoze' },
  ] });
  expect(text).toContain('1/3 actions succeeded');
  expect(text).toContain('1 skipped');
  expect(text).toContain('road: FAILED (insufficient_funds)');
});
