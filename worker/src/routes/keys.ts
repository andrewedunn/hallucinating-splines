// ABOUTME: POST /v1/keys endpoint for API key generation.
// ABOUTME: Creates a new key, hashes it, stores in D1, returns plaintext key once.

import { Hono } from 'hono';
import { generateApiKey, generateKeyId, hashKey } from '../auth';
import { generateMayorName } from '../names';

type Bindings = { DB: D1Database };

const keys = new Hono<{ Bindings: Bindings }>();

keys.post('/', async (c) => {
  const keyId = generateKeyId();
  const rawKey = generateApiKey();
  const hash = await hashKey(rawKey);
  const prefix = rawKey.slice(0, 11); // "hs_" + first 8 hex chars
  const mayorName = generateMayorName(keyId);

  await c.env.DB.prepare(
    'INSERT INTO api_keys (id, key_hash, prefix, mayor_name) VALUES (?, ?, ?, ?)'
  ).bind(keyId, hash, prefix, mayorName).run();

  return c.json({
    key: rawKey,
    mayor: mayorName,
    note: 'Store this key. It will not be shown again.',
  }, 201);
});

export { keys };
