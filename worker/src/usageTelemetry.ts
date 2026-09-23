// ABOUTME: Records request shape and timing without URLs, credentials, IPs, or bodies.
// ABOUTME: Client source is self-reported metadata and must never influence authorization.
export function usageEvent(method: string, route: string | undefined, client: string | undefined, status: number, durationMs: number) {
  return {
    event: 'api_request',
    method,
    route: route || 'unmatched',
    client: client === 'hallucinating-splines-mcp' ? 'mcp' : 'api_or_other',
    status,
    duration_ms: Math.max(0, Math.round(durationMs)),
  };
}
