/**
 * ChatGPT Apps MCP HTTP Handler
 *
 * Handles MCP protocol requests for the ChatGPT Apps integration.
 * Mounted at /chatgpt-mcp behind CHATGPT_MCP_ENABLED=true flag.
 *
 * Stateless: creates a new server + transport per request (same pattern
 * as the existing /mcp handler). Uses chatgptAdapter for response formatting.
 */

import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createChatGptMcpServer } from './server.js';
import { logger } from '@/utils/logger';
import type { HonoEnv } from '@/types/hono';

export function createChatGptMcpRoutes(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.all('/', async (c) => {
    const userId = c.get('userId');
    const agentId = c.get('agentId') || 'unknown-agent';
    const tier = c.get('tier') || 'free';

    if (!userId) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const server = createChatGptMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);

      const response = await transport.handleRequest(c.req.raw, {
        authInfo: {
          token: c.req.header('Authorization')?.replace('Bearer ', '') || '',
          clientId: 'epitome-chatgpt',
          scopes: [],
          extra: { userId, agentId, tier },
        },
      });

      return response;
    } catch (error) {
      logger.error('ChatGPT MCP handler error', { error: String(error) });
      return c.json(
        { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
        500,
      );
    } finally {
      await transport.close();
      await server.close();
    }
  });

  return app;
}
