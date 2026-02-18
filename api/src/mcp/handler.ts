/**
 * MCP Hono Route Handler
 *
 * Handles MCP protocol requests over HTTP
 * Mounted at /mcp on the Hono server
 *
 * Routes:
 * - / (all methods) - MCP Streamable HTTP protocol (JSON-RPC 2.0)
 * - /tools - List available tools (legacy REST)
 * - /call/:toolName - Call a specific tool (legacy REST)
 */

import { Context, Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getToolDefinitions, executeTool, McpContext } from './server.js';
import { createMcpProtocolServer } from './protocol.js';
import { logger } from '@/utils/logger';
import type { HonoEnv } from '@/types/hono';

/**
 * Extract agent ID from request headers as fallback
 */
function extractAgentId(c: Context): string {
  const agentIdHeader = c.req.header('X-Agent-ID');
  if (agentIdHeader) {
    return agentIdHeader;
  }

  const userAgent = c.req.header('User-Agent');
  if (userAgent) {
    const match = userAgent.match(/^([^/\s]+)/);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return 'unknown-agent';
}

/**
 * Build MCP context from auth middleware context
 *
 * Uses userId and agentId already resolved by the auth middleware
 * (no double-validation). Falls back to X-Agent-ID / User-Agent
 * header only if the API key has no stored agentId.
 */
function buildMcpContext(c: Context): McpContext {
  const userId = c.get('userId') as string | undefined;

  if (!userId) {
    throw new Error('UNAUTHORIZED: Authentication required. Provide a Bearer token.');
  }

  // Use agentId from auth middleware (API key's stored agentId)
  // Fall back to X-Agent-ID header or User-Agent
  const agentId = c.get('agentId') || extractAgentId(c);

  return { userId, agentId };
}

/**
 * Create MCP routes
 */
export function createMcpRoutes(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  // MCP Streamable HTTP protocol handler (JSON-RPC 2.0)
  // Handles initialize, tools/list, tools/call from Claude Desktop and other MCP clients
  app.all('/', async (c) => {
    const userId = c.get('userId') as string | undefined;
    const agentId = (c.get('agentId') as string | undefined) || extractAgentId(c);

    // M-4 SECURITY FIX: Require auth for ALL methods, not just POST
    if (!userId) {
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      c.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      );
      return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Authentication required' }, id: null }, 401);
    }

    // Per-request server + transport (stateless mode — each request has different auth)
    const server = createMcpProtocolServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      const response = await transport.handleRequest(c.req.raw, {
        authInfo: {
          token: c.req.header('Authorization')?.replace('Bearer ', '') || '',
          clientId: 'epitome',
          scopes: [],
          extra: { userId: userId || '', agentId },
        },
      });
      return response;
    } catch (error) {
      logger.error('MCP protocol error', { error: String(error) });
      return c.json(
        { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
        500,
      );
    } finally {
      await transport.close();
      await server.close();
    }
  });

  // --- Legacy REST endpoints (backward compatibility) ---

  // List tools
  // M-2 SECURITY FIX: Require authentication for tool listing
  app.get('/tools', (c) => {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    return c.json({
      tools: getToolDefinitions(),
    });
  });

  // Call a tool
  // M-1 SECURITY FIX: Validate tool name and request body before execution
  app.post('/call/:toolName', async (c) => {
    const toolName = c.req.param('toolName');

    // M-1: Validate toolName against known tool names
    const knownTools = getToolDefinitions().map((t) => t.name);
    if (!knownTools.includes(toolName)) {
      return c.json(
        { success: false, error: { code: 'BAD_REQUEST', message: `Unknown tool: ${toolName}` } },
        400
      );
    }

    try {
      // Build MCP context from auth middleware
      const context = buildMcpContext(c);
      const args = await c.req.json();

      // M-1: Validate request body is a plain object (not array, not primitive)
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return c.json(
          { success: false, error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } },
          400
        );
      }

      // Execute tool
      const result = await executeTool(toolName, args, context);

      return c.json({
        success: true,
        result,
      });
    } catch (error: unknown) {
      logger.error('MCP call error', { tool: toolName, error: String(error) });

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const statusCode = errorMessage.startsWith('UNAUTHORIZED') ? 401 :
        errorMessage.startsWith('FORBIDDEN') ? 403 :
        errorMessage.startsWith('NOT_FOUND') ? 404 :
        errorMessage.startsWith('CONSENT_DENIED') ? 403 : 500;

      if (statusCode === 401) {
        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
        c.header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
        );
      }

      return c.json(
        {
          success: false,
          error: {
            code: errorMessage.split(':')[0],
            message: errorMessage,
          },
        },
        statusCode
      );
    }
  });

  return app;
}

/**
 * Legacy handler for backward compatibility
 */
export async function mcpHandler(c: Context) {
  const routes = createMcpRoutes();
  return routes.fetch(c.req.raw, c.env);
}
