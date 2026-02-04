// ABOUTME: Standardized JSON error responses for the API.
// ABOUTME: Used across all route handlers for consistent error formatting.

import type { Context } from 'hono';

const FUN_MESSAGES: Record<number, string> = {
  404: "The city you're looking for must have been bulldozed.",
  429: "Easy there, Mayor. Rome wasn't built in a day.",
};

export function errorResponse(
  c: Context,
  status: number,
  error: string,
  reason?: string,
  headers?: Record<string, string>,
) {
  const message = reason || FUN_MESSAGES[status];
  const res = c.json({ error, reason: message }, status);
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      res.headers.set(key, value);
    }
  }
  return res;
}
