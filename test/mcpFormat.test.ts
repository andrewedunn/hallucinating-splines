// ABOUTME: Regression tests for actionable MCP placement and batch feedback.
// ABOUTME: Ensures partial work and failed automatic connections remain visible.
import { formatActionResult, formatBatchResult } from '../mcp/src/format';

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
