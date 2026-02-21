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
import { rewriteLegacyJsonRpc, translateLegacyToolCall } from './legacyTranslator.js';
import { logger } from '@/utils/logger';
import { recordApiCall, getEffectiveTier } from '@/services/metering.service';
import { x402Service } from '@/services/x402.service';
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
  const tier = getEffectiveTier(c as Context<HonoEnv>);

  return { userId, agentId, tier };
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
    if (!x402Service.isEnabled()) return next();

    const tier = c.get('tier') || 'free';
    const authType = c.get('authType');

    // Pro/enterprise users already paid via subscription; session = human in dashboard
    if (tier === 'pro' || tier === 'enterprise' || authType === 'session') {
      return next();
    }

    // Lazy-init on first free-tier request
    if (!x402Service.getMiddleware()) {
      await x402Service.initialize();
    }

    const mw = x402Service.getMiddleware();
    if (!mw) {
      // Fail open: if x402 is degraded, let free-tier requests through without payment upgrade.
      // They'll still hit normal rate limits — just won't get pay-per-call tier override.
      const status = x402Service.getStatus();
      logger.warn('x402: middleware unavailable, failing open for free-tier request', {
        status: status.status,
        reason: status.reason,
      });
      return next();
    }

    try {
      // Wrap: only set x402Paid if request actually included a payment header
      // (paymentMiddleware calls next() both for "no-payment-required" AND
      // "payment-verified" — we must distinguish between the two)
      await mw(c, async () => {
        const paymentHeader = c.req.header('payment-signature') || c.req.header('x-payment');
        if (paymentHeader) {
          c.set('x402Paid', true);
        }
        await next();
      });
    } catch (err) {
      // If x402 verification fails, the middleware itself returns 402
      if (err instanceof Response) throw err;
      // Fail open: x402 runtime errors shouldn't block free-tier requests
      logger.error('x402: middleware error, failing open for free-tier request', { error: String(err) });
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

    logger.info('MCP request received', {
      method: c.req.method,
      hasAuth: !!c.req.header('Authorization'),
      userId: userId || null,
      agentId,
      userAgent: c.req.header('User-Agent')?.substring(0, 100),
    });

    // M-4 SECURITY FIX: Require auth for ALL methods, not just POST
    if (!userId) {
      logger.warn('MCP request rejected: no auth', {
        method: c.req.method,
        hasBearer: !!c.req.header('Authorization'),
        hasCookie: !!c.req.header('Cookie'),
      });
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
      let parsedBody: unknown | undefined;
      if (c.req.method === 'POST') {
        const contentType = c.req.header('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            // Parse a clone so transport can still parse the original request body on its own.
            const body = await c.req.raw.clone().json();
            parsedBody = rewriteLegacyJsonRpc(body);
          } catch {
            // Leave parsedBody undefined on parse errors; transport will return protocol-level errors.
          }
        }
      }

      const response = await transport.handleRequest(c.req.raw, {
        authInfo: {
          token: c.req.header('Authorization')?.replace('Bearer ', '') || '',
          clientId: 'epitome',
          scopes: [],
          extra: { userId: userId || '', agentId, tier: getEffectiveTier(c as any) },
        },
        ...(parsedBody !== undefined ? { parsedBody } : {}),
      });
      logger.info('MCP request completed', { userId, agentId, status: response.status });
      return response;
    } catch (error) {
      logger.error('MCP protocol error', { error: String(error), userId, agentId });
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
    let toolName = c.req.param('toolName');

    try {
      // Build MCP context from auth middleware (runs before tool validation
      // so unauthenticated requests get 401, not a tool-enumeration signal)
      const context = buildMcpContext(c);

      let args: unknown;
      try {
        args = await c.req.json();
      } catch {
        return c.json(
          { success: false, error: { code: 'BAD_REQUEST', message: 'Request body must be valid JSON' } },
          400,
        );
      }

      // M-1: Validate request body is a plain object (not array, not primitive)
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return c.json(
          { success: false, error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } },
          400
        );
      }

      const legacy = translateLegacyToolCall(toolName, args as Record<string, unknown>);
      if (legacy) {
        toolName = legacy.toolName;
        args = legacy.args;
      }

      // M-1: Validate toolName against known tool names
      const knownTools = getToolDefinitions().map((t) => t.name);
      if (!knownTools.includes(toolName)) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: `Unknown tool: ${toolName}` } },
          404
        );
      }

      // Execute tool — returns ToolResult (success or failure)
      const result = await executeTool(toolName, args, context);

      if (!result.success) {
        const statusCode =
          result.code === 'CONSENT_DENIED' ? 403 :
          result.code === 'NOT_FOUND' ? 404 :
          result.code === 'INVALID_ARGS' ? 400 :
          result.code === 'RATE_LIMITED' ? 429 : 500;

        return c.json(
          {
            success: false,
            error: {
              code: result.code,
              message: result.message,
            },
          },
          statusCode,
        );
      }

      return c.json({
        success: true,
        result: result.data,
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
