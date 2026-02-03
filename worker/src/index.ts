// ABOUTME: Worker entry point. Routes requests via Hono.
// ABOUTME: Stateless — delegates city operations to Durable Objects.

import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  CITY: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

// Stub: real implementation in a later task
export class CityDO {
  constructor(private state: DurableObjectState) {}
  async fetch(_request: Request): Promise<Response> {
    return new Response('not implemented', { status: 501 });
  }
}

export default app;
