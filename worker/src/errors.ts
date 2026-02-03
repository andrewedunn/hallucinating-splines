// ABOUTME: Standardized JSON error responses for the API.
// ABOUTME: Used across all route handlers for consistent error formatting.

import type { Context } from 'hono';

export function errorResponse(c: Context, status: number, error: string, reason?: string) {
  return c.json({ error, reason }, status);
}
