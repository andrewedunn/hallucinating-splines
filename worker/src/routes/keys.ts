// ABOUTME: POST /v1/keys endpoint for API key generation.
// ABOUTME: Creates a new key, hashes it, stores in D1, returns plaintext key once. IP rate limited.

import { Hono } from 'hono';
import { generateApiKey, generateKeyId, hashKey } from '../auth';
import { generateMayorName } from '../names';
import { errorResponse } from '../errors';

type Bindings = { DB: D1Database };

const keys = new Hono<{ Bindings: Bindings }>();

keys.post('/', async (c) => {
  // IP-based rate limiting: max 2 keys per hour per IP
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

  const recentKeys = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM api_keys WHERE created_from_ip = ? AND created_at > datetime('now', '-1 hour')"
  ).bind(ip).first<{ count: number }>();

  if (recentKeys && recentKeys.count >= 2) {
    return errorResponse(c, 429, 'rate_limited', "Easy there, Mayor. Rome wasn't built in a day.", { 'Retry-After': '3600' });
  }

  const keyId = generateKeyId();
  const rawKey = generateApiKey();
  const hash = await hashKey(rawKey);
  const prefix = rawKey.slice(0, 11); // "hs_" + first 8 hex chars
  const mayorName = generateMayorName(keyId);

  await c.env.DB.prepare(
    'INSERT INTO api_keys (id, key_hash, prefix, mayor_name, created_from_ip) VALUES (?, ?, ?, ?, ?)'
  ).bind(keyId, hash, prefix, mayorName, ip).run();

  return c.json({
    key: rawKey,
    mayor: mayorName,
    welcome: `Welcome, Mayor ${mayorName}! Your city awaits.`,
    note: 'Store this key. It will not be shown again.',
  }, 201);
});

export { keys };
