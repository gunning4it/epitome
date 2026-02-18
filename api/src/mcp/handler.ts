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
import { z } from 'zod';
import { getToolDefinitions, executeTool, McpContext } from './server.js';
import { createMcpProtocolServer } from './protocol.js';
import { logger } from '@/utils/logger';
import { recordApiCall } from '@/services/metering.service';
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
 * Initialize x402 resource server (lazy, once per process).
 * Returns null when X402_ENABLED is not 'true'.
 */
let x402ServerInstance: Awaited<ReturnType<typeof initX402Server>> | null = null;
let x402InitAttempted = false;

async function initX402Server() {
  if (!process.env.X402_PAY_TO_ADDRESS) {
    logger.warn('x402: X402_PAY_TO_ADDRESS not set, x402 payments disabled');
    return null;
  }
  try {
    const { x402ResourceServer, HTTPFacilitatorClient } = await import('@x402/core/server');
    const { registerExactEvmScheme } = await import('@x402/evm/exact/server');

    const facilitatorClient = new HTTPFacilitatorClient({
      url: process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org',
    });
    const server = new x402ResourceServer(facilitatorClient);
    registerExactEvmScheme(server);
    return server;
  } catch (err) {
    logger.error('x402: Failed to initialize resource server', { error: String(err) });
    return null;
  }
}

/**
 * Zod schema for x402 PAYMENT-RESPONSE header (base64-encoded JSON).
 * Validates extracted fields; keeps raw header in metadata for debugging.
 */
const x402PaymentSchema = z.object({
  txHash: z.string().optional(),
  network: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  value: z.string().optional(),
});

type X402PaymentParsed = z.infer<typeof x402PaymentSchema>;

function parseX402PaymentResponse(header: string): X402PaymentParsed & { raw: string } {
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString());
    const extracted = {
      txHash: decoded?.payload?.txHash || decoded?.txHash,
      network: decoded?.payload?.network || decoded?.network,
      from: decoded?.payload?.authorization?.from,
      to: decoded?.payload?.authorization?.to,
      value: decoded?.payload?.authorization?.value,
    };
    const parsed = x402PaymentSchema.parse(extracted);
    return { ...parsed, raw: header };
  } catch (err) {
    logger.warn('x402: Failed to parse payment response header', { error: String(err) });
    return { raw: header };
  }
}

/**
 * Create MCP routes
 */
export function createMcpRoutes(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  // ─── x402 conditional payment middleware ───────────────────
  // Applies only to free-tier agent requests when X402_ENABLED=true.
  // Pro/enterprise users and session-authed humans skip x402.
  app.use('*', async (c, next) => {
    if (process.env.X402_ENABLED !== 'true') return next();

    const tier = c.get('tier') || 'free';
    const authType = c.get('authType');

    // Pro/enterprise users already paid via subscription; session = human in dashboard
    if (tier === 'pro' || tier === 'enterprise' || authType === 'session') {
      return next();
    }

    // Lazy-init x402 server
    if (!x402InitAttempted) {
      x402InitAttempted = true;
      x402ServerInstance = await initX402Server();
    }
    if (!x402ServerInstance) return next();

    try {
      const { paymentMiddleware } = await import('@x402/hono');
      const network = (process.env.X402_NETWORK || 'eip155:84532') as `${string}:${string}`;
      const mw = paymentMiddleware(
        {
          '/': {
            accepts: [{
              scheme: 'exact',
              price: process.env.X402_PRICE_PER_CALL || '$0.01',
              network,
              payTo: process.env.X402_PAY_TO_ADDRESS!,
            }],
            description: 'Epitome MCP tool call',
            mimeType: 'application/json',
          },
        },
        x402ServerInstance,
      );

      // Wrap: if payment succeeds, set x402Paid on context
      await mw(c, async () => {
        c.set('x402Paid', true);
        await next();
      });
    } catch (err) {
      // If x402 verification fails, the middleware itself returns 402
      // Any other error: log and let the request through (graceful degradation)
      if (err instanceof Response) throw err;
      logger.error('x402: middleware error', { error: String(err) });
      return next();
    }
  });

  // ─── x402 payment recording (after response) ──────────────
  app.use('*', async (c, next) => {
    await next();

    const userId = c.get('userId');
    if (!userId) return;

    // Record MCP call for metering
    const agentId = c.get('agentId');
    void recordApiCall(userId, 'mcp_calls', agentId || undefined).catch(() => {});

    // Record x402 payment to billing_transactions
    if (c.get('x402Paid')) {
      const paymentHeader = c.res.headers.get('X-Payment-Response');
      const parsed = paymentHeader ? parseX402PaymentResponse(paymentHeader) : { raw: '' };
      try {
        const { sql } = await import('@/db/client');
        await sql`
          INSERT INTO public.billing_transactions
            (user_id, payment_type, x402_tx_hash, x402_network, amount_micros, currency, asset, status, description, metadata)
          VALUES (
            ${userId},
            'x402',
            ${parsed.txHash || null},
            ${parsed.network || process.env.X402_NETWORK || 'eip155:84532'},
            ${10_000},
            'usd',
            'usdc',
            'succeeded',
            'MCP tool call',
            ${JSON.stringify({ from: parsed.from, to: parsed.to, value: parsed.value, rawHeader: parsed.raw })}
          )
        `;
      } catch (err) {
        logger.error('x402: Failed to record payment', { error: String(err) });
      }
    }
  });

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
