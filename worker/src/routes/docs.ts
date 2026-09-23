// ABOUTME: GET /v1/docs returns generated API and agent documentation as Markdown.
// ABOUTME: Source content and endpoint/tool inventories are checked in CI.
import { Hono } from 'hono';
import { API_REFERENCE } from '../generated/api-reference';

const docs = new Hono();
docs.get('/', () => new Response(API_REFERENCE, {
  headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
}));
export { docs };
