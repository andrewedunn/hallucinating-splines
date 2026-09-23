// ABOUTME: Verifies request telemetry uses route patterns and bounded client labels.
// ABOUTME: Credentials, raw URLs, and arbitrary client header values are never included.
import { usageEvent } from '../worker/src/usageTelemetry';

test('captures MCP timing and status using a route template', () => {
  expect(usageEvent('POST', '/v1/cities/:id/batch', 'hallucinating-splines-mcp', 429, 12.6)).toEqual({
    event: 'api_request', method: 'POST', route: '/v1/cities/:id/batch', client: 'mcp', status: 429, duration_ms: 13,
  });
});
test('never logs an arbitrary client header', () => {
  const record = usageEvent('GET', undefined, 'hs_secret-example', 404, 0);
  expect(record.client).toBe('api_or_other');
  expect(JSON.stringify(record)).not.toContain('hs_secret');
});
