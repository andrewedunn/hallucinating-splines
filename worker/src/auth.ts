// ABOUTME: API key generation, hashing, and middleware for request authentication.
// ABOUTME: Uses SHA-256 via Web Crypto API for key hashing.

import type { Context, Next } from 'hono';
import { errorResponse } from './errors';

type Env = { Bindings: { DB: D1Database } };

export async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `hs_${hex}`;
}

export function generateKeyId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `key_${hex}`;
}

export async function authMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(c, 401, 'unauthorized', 'Missing or invalid Authorization header');
  }

  const key = authHeader.slice(7);
  const hash = await hashKey(key);

  const result = await c.env.DB.prepare(
    'SELECT id, mayor_name FROM api_keys WHERE key_hash = ?'
  ).bind(hash).first();

  if (!result) {
    return errorResponse(c, 401, 'unauthorized', 'Invalid API key');
  }

  // Update last_used (fire and forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE api_keys SET last_used = datetime(\'now\') WHERE id = ?')
      .bind(result.id)
      .run()
  );

  c.set('keyId', result.id);
  c.set('mayorName', result.mayor_name);

  await next();
}
