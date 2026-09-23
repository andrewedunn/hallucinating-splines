// ABOUTME: Verifies truthful batch outcome classification, including final-item failures.
// ABOUTME: Protects action-log success rates and client retry decisions.
import { batchOutcome } from '../worker/src/batchOutcome';

test('last-item failure is partial, not success', () => {
  expect(batchOutcome([{ success: true }, { success: false }], 2)).toEqual({
    attempted: 2, succeeded: 1, failed: 1, skipped: 0, outcome: 'partial',
  });
});
test('first-item failure preserves skipped count', () => {
  expect(batchOutcome([{ success: false }], 3)).toEqual({
    attempted: 1, succeeded: 0, failed: 1, skipped: 2, outcome: 'failed',
  });
});
test('all successful actions is a success', () => {
  expect(batchOutcome([{ success: true }], 1).outcome).toBe('success');
});
