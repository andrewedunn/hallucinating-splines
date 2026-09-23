// ABOUTME: Verifies local API/MCP guide resources, city links and owner-scoped listing.
// ABOUTME: Creates one local test key/city on ports 8798/8799; never targets production.
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8798';
const key=await fetch(base+'/v1/keys',{method:'POST'}).then(r=>r.json()).then(r=>r.key);
assert(key,'local key creation');
const client=new Client({name:'docs-local-verification',version:'1.0.0'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8799/mcp?key='+key)));
const tools=await client.listTools(); assert.equal(tools.tools.length,19);
const guide=await client.readResource({uri:'hallucinating-splines://guide'});
assert(guide.contents[0].text.includes('at most 30 game API/tool calls'));
const created=await client.callTool({name:'create_city',arguments:{seed:42}});
const text=created.content.map(c=>c.text||'').join('\n');
const url=text.match(/https:\/\/hallucinatingsplines.com\/cities\/[a-z0-9-]+/)?.[0];assert(url,'MCP creation public link');
const own=await client.callTool({name:'list_my_cities',arguments:{}});assert(own.content.some(c=>c.text?.includes(url)));
const cities=await fetch(base+'/v1/cities?mine=true',{headers:{Authorization:'Bearer '+key}}).then(r=>r.json());
assert.equal(cities.cities.length,1); assert(url.endsWith(cities.cities[0].slug));
const apiGuide=await fetch(base+'/v1/docs').then(r=>r.text()); assert(apiGuide.includes('/v1/cities/{id}/batch'));assert(!apiGuide.includes('global cap: 100'));
await client.close();
const bad=new Client({name:'docs-local-missing-key-check',version:'1.0.0'});
await bad.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8799/mcp')));
const others=await bad.callTool({name:'list_my_cities',arguments:{}});assert(others.content.some(c=>c.text==='No cities found.'));
await bad.close();
console.log('Local API/MCP integration passed: 19 tools, shared guide resource, create/list public links, missing key does not list public cities, generated API docs.');
