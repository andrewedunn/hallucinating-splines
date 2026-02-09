// ABOUTME: POST /v1/keys endpoint for API key generation.
// ABOUTME: Creates a new key, hashes it, stores in D1, returns plaintext key once. IP rate limited.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { generateApiKey, generateKeyId, hashKey } from '../auth';
import { generateMayorName } from '../names';
import { errorResponse } from '../errors';
import { KeyStatusSchema, CreateKeySchema, ErrorSchema } from '../schemas';

type Bindings = { DB: D1Database };

const keys = new OpenAPIHono<{ Bindings: Bindings }>();

const MAX_ACTIVE_KEYS = 500;

const getStatusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Keys'],
  summary: 'Check key availability',
  description: 'Returns active key count, global limit, and whether new keys can be created.',
  responses: {
    200: {
      content: { 'application/json': { schema: KeyStatusSchema } },
      description: 'Key availability status',
    },
  },
});

keys.openapi(getStatusRoute, async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM api_keys WHERE active = 1'
  ).first<{ count: number }>();

  const active = result?.count ?? 0;
  const available = active < MAX_ACTIVE_KEYS;

  return c.json({ active, limit: MAX_ACTIVE_KEYS, available }, 200);
});

const createKeyRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Keys'],
  summary: 'Create an API key',
  description: 'Generates a new API key with a random mayor name. The key is shown once — store it immediately. Rate limited to 2 keys per hour per IP.',
  responses: {
    201: {
      content: { 'application/json': { schema: CreateKeySchema } },
      description: 'API key created',
    },
    429: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Rate limited — max 2 keys per hour per IP',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Capacity reached — all key slots claimed',
    },
  },
});

keys.openapi(createKeyRoute, async (c) => {
  // Global cap on active keys
  const activeCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM api_keys WHERE active = 1'
  ).first<{ count: number }>();

  if (activeCount && activeCount.count >= MAX_ACTIVE_KEYS) {
    return errorResponse(c, 503, 'capacity_reached', `All ${MAX_ACTIVE_KEYS} API keys are claimed. Check back later — keys expire after 14 days of inactivity.`);
  }

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
