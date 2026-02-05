// ABOUTME: Hidden easter egg endpoints for llama fund/disaster triggers.
// ABOUTME: Not registered with OpenAPI — plain Hono routes so they stay undocumented.

import { Hono } from 'hono';
import { authMiddleware } from '../auth';
import { errorResponse } from '../errors';

type Bindings = { DB: D1Database; CITY: DurableObjectNamespace; SNAPSHOTS: R2Bucket };
type Variables = { keyId: string };

const llamas = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function verifyCityOwner(c: any, cityId: string): Promise<boolean> {
  const row = await c.env.DB.prepare(
    "SELECT api_key_id, status FROM cities WHERE id = ?"
  ).bind(cityId).first<{ api_key_id: string; status: string }>();
  if (!row) return false;
  if (row.status !== 'active') return false;
  if (row.api_key_id !== c.get('keyId')) return false;
  return true;
}

async function syncStats(
  db: D1Database, cityId: string,
  stats: { year?: number; population?: number; funds?: number; score?: number }
): Promise<void> {
  await db.prepare(
    `UPDATE cities SET game_year = ?, population = ?, funds = ?, score = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(stats.year, stats.population, stats.funds, stats.score ?? 0, cityId).run();
}

const LLAMA_HEADLINES: Record<string, { headline: string; url?: string }> = {
  llama_fund: {
    headline: 'Anonymous donor leaves briefcase of cash at City Hall',
  },
  llama_olpc: {
    headline: 'One Laptop Per Child foundation invests in city',
    url: 'https://laptop.org/make-a-donation/',
  },
};

const DISASTER_HEADLINES: Record<string, string> = {
  disaster_earthquake: 'Seismologists report major tremors across the region',
  disaster_tornado: 'Meteorologists track devastating funnel cloud through downtown',
  disaster_fire: 'Fire department scrambles as blaze breaks out',
  disaster_flood: 'Rising waters swamp residential areas',
  disaster_monster: 'Giant creature emerges from polluted waterfront',
  disaster_meltdown: 'Radiation detected — evacuation ordered around power plant',
};

// --- Llama fund endpoints ---

llamas.post('/:id/fund', async (c) => {
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

  const cityId = c.req.param('id');
  if (!await verifyCityOwner(c, cityId)) {
    return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const stats = await stub.llamaFund();

  // Mark as llama
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE cities SET llama = 1 WHERE id = ?').bind(cityId).run()
  );

  // Sync stats
  if (stats) c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, stats));

  // Log action
  const info = LLAMA_HEADLINES.llama_fund;
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO actions (city_id, game_year, action_type, params, result, cost) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(cityId, stats?.year || 0, 'llama_fund', JSON.stringify({ headline: info.headline }), 'success', 0).run()
  );

  return c.json({ success: true, stats }, 200);
});

llamas.post('/:id/olpc', async (c) => {
  const authResult = await authMiddleware(c, async () => {});
  if (authResult) return authResult;

  const cityId = c.req.param('id');
  if (!await verifyCityOwner(c, cityId)) {
    return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
  }

  const doId = c.env.CITY.idFromName(cityId);
  const stub = c.env.CITY.get(doId);
  const stats = await stub.llamaOlpc();

  // Mark as llama
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE cities SET llama = 1 WHERE id = ?').bind(cityId).run()
  );

  // Sync stats
  if (stats) c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, stats));

  // Log action
  const info = LLAMA_HEADLINES.llama_olpc;
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO actions (city_id, game_year, action_type, params, result, cost) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(cityId, stats?.year || 0, 'llama_olpc', JSON.stringify({ headline: info.headline, url: info.url }), 'success', 0).run()
  );

  return c.json({ success: true, stats }, 200);
});

// --- Disaster endpoints ---

const DISASTER_TYPES = ['earthquake', 'tornado', 'fire', 'flood', 'monster', 'meltdown'] as const;

for (const disaster of DISASTER_TYPES) {
  llamas.post(`/:id/${disaster}`, async (c) => {
    const authResult = await authMiddleware(c, async () => {});
    if (authResult) return authResult;

    const cityId = c.req.param('id');
    if (!await verifyCityOwner(c, cityId)) {
      return errorResponse(c, 403, 'forbidden', 'City not found or not owned by you');
    }

    const doId = c.env.CITY.idFromName(cityId);
    const stub = c.env.CITY.get(doId);
    const stats = await stub.triggerDisaster(disaster);

    // Sync stats (disasters don't set llama)
    if (stats) c.executionCtx.waitUntil(syncStats(c.env.DB, cityId, stats));

    // Log action
    const actionType = `disaster_${disaster}`;
    const headline = DISASTER_HEADLINES[actionType];
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `INSERT INTO actions (city_id, game_year, action_type, params, result, cost) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(cityId, stats?.year || 0, actionType, JSON.stringify({ headline }), 'success', 0).run()
    );

    return c.json({ success: true, stats }, 200);
  });
}

export { llamas };
