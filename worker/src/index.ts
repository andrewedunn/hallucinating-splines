// ABOUTME: Worker entry point. Routes requests via Hono.
// ABOUTME: Stateless — delegates city operations to Durable Objects.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { keys } from './routes/keys';
import { seeds } from './routes/seeds';
import { cities } from './routes/cities';

type Bindings = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/v1/keys', keys);
app.route('/v1/seeds', seeds);
app.route('/v1/cities', cities);

export { CityDO } from './cityDO';

export default app;
