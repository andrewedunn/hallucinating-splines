// ABOUTME: MCP worker entry point. Routes /mcp to the McpAgent Durable Object.
// ABOUTME: Extracts API key from ?key= query parameter for REST API auth.

import { HallucinatingSplinesMCP } from './agent';

export { HallucinatingSplinesMCP };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'hallucinating-splines-mcp' });
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      // Extract API key from URL and pass as props to the Durable Object
      const key = url.searchParams.get('key') || '';
      const ctxWithProps = Object.assign(ctx, { props: { key } });
      return HallucinatingSplinesMCP.serve('/mcp', { binding: 'MCP_AGENT' }).fetch(request, env, ctxWithProps);
    }

    return new Response('Not found', { status: 404 });
  },
};
