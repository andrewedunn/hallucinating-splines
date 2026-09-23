// ABOUTME: Summarizes attempted batch actions without counting failures as successes.
// ABOUTME: Shared by the response and persistent action log for consistent reporting.
export function batchOutcome(results: Array<{ success: boolean }>, total: number) {
  const succeeded = results.filter(result => result.success).length;
  const failed = results.length - succeeded;
  return {
    attempted: results.length,
    succeeded,
    failed,
    skipped: total - results.length,
    outcome: succeeded === total ? 'success' : succeeded > 0 ? 'partial' : 'failed',
  };
}
