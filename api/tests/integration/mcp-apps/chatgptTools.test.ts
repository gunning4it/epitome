/**
 * Integration Tests — ChatGPT MCP Endpoint (/chatgpt-mcp)
 *
 * Tests the /chatgpt-mcp route via JSON-RPC 2.0 MCP protocol messages.
 * Creates a local Hono app with auth middleware + chatgpt-mcp routes
 * to test in isolation without requiring CHATGPT_MCP_ENABLED=true.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authResolver } from '@/middleware/auth';
import { createChatGptMcpRoutes } from '@/mcp-apps/handler';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { grantConsent, revokeAllAgentConsent } from '@/services/consent.service';
import type { HonoEnv } from '@/types/hono';

/**
 * Build a minimal Hono app with auth + chatgpt-mcp for testing.
 */
function buildTestApp() {
  const app = new Hono<HonoEnv>();
  app.use('*', authResolver);
  app.route('/chatgpt-mcp', createChatGptMcpRoutes());
  return app;
}

/**
 * Send a JSON-RPC 2.0 request to the chatgpt-mcp endpoint.
 */
async function jsonRpc(
  app: Hono<HonoEnv>,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });

  const response = await app.request('/chatgpt-mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });

  return response;
}

/** Parse the JSON-RPC response body. */
async function parseResponse(response: Response) {
  const text = await response.text();
  return JSON.parse(text);
}

/** Auth headers for a test user with agent. */
function authHeaders(userId: string, agentId = 'test-chatgpt-agent') {
  return {
    'x-test-user-id': userId,
    'x-test-agent-id': agentId,
  };
}

describe('ChatGPT MCP Tools (/chatgpt-mcp)', () => {
  let testUser: TestUser;
  let app: Hono<HonoEnv>;

  beforeEach(async () => {
    testUser = await createTestUser();
    app = buildTestApp();

    // Grant broad consent for test agent
    for (const resource of [
      'profile', 'tables', 'tables/*', 'vectors', 'vectors/*',
      'graph', 'graph/*', 'memory',
    ]) {
      await grantConsent(testUser.userId, {
        agentId: 'test-chatgpt-agent',
        resource,
        permission: 'write',
      });
    }
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('returns 401 without auth', async () => {
    const response = await jsonRpc(app, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it('completes MCP initialize handshake', async () => {
    const response = await jsonRpc(
      app,
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-chatgpt', version: '1.0.0' },
      },
      authHeaders(testUser.userId),
    );

    expect(response.status).toBe(200);
    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.serverInfo.name).toBe('epitome');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('includes tool annotations in tools/list', async () => {
    const response = await jsonRpc(
      app,
      'tools/list',
      {},
      authHeaders(testUser.userId),
    );

    expect(response.status).toBe(200);
    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.tools).toBeInstanceOf(Array);
    expect(body.result.tools.length).toBe(3);

    // Check that annotations exist on recall (read-only)
    const recall = body.result.tools.find((t: any) => t.name === 'recall');
    expect(recall).toBeDefined();
    expect(recall.annotations).toBeDefined();
    expect(recall.annotations.readOnlyHint).toBe(true);
    expect(recall.annotations.destructiveHint).toBe(false);

    // Write tools should not be readOnly
    const memorize = body.result.tools.find((t: any) => t.name === 'memorize');
    expect(memorize).toBeDefined();
    expect(memorize.annotations.readOnlyHint).toBe(false);
  });

  it('returns structuredContent for recall (no topic)', async () => {
    const response = await jsonRpc(
      app,
      'tools/call',
      { name: 'recall', arguments: {} },
      authHeaders(testUser.userId),
    );

    expect(response.status).toBe(200);
    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.content).toBeInstanceOf(Array);
    expect(body.result.content[0].type).toBe('text');
    // structuredContent should be present (chatgptAdapter feature)
    expect(body.result.structuredContent).toBeDefined();
    // structuredContent should contain profile data
    expect(body.result.structuredContent).toHaveProperty('profile');
  });

  it('translates legacy list_tables through recall facade', async () => {
    const response = await jsonRpc(
      app,
      'tools/call',
      { name: 'list_tables', arguments: {} },
      authHeaders(testUser.userId),
    );

    expect(response.status).toBe(200);
    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toHaveProperty('tables');
  });

  it('translates legacy add_record through memorize facade', async () => {
    const response = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'add_record',
        arguments: {
          table: 'books',
          data: { title: 'Dune', rating: 5 },
        },
      },
      authHeaders(testUser.userId),
    );

    expect(response.status).toBe(200);
    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toHaveProperty('table', 'books');
  });

  it('translates legacy query_table through recall facade', async () => {
    // Seed a table row via translated legacy add_record first
    const seedResponse = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'add_record',
        arguments: {
          table: 'books',
          data: { title: 'Hyperion', rating: 5 },
        },
      },
      authHeaders(testUser.userId),
    );
    expect(seedResponse.status).toBe(200);

    const response = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'query_table',
        arguments: {
          table: 'books',
          filters: { title: 'Hyperion' },
        },
      },
      authHeaders(testUser.userId),
    );

    expect(response.status).toBe(200);
    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toHaveProperty('table', 'books');
    expect(body.result.structuredContent).toHaveProperty('records');
  });

  it('returns isError true on consent denied', async () => {
    // Revoke all consent
    await revokeAllAgentConsent(testUser.userId, 'test-chatgpt-agent');

    const response = await jsonRpc(
      app,
      'tools/call',
      { name: 'memorize', arguments: { text: 'delete this', action: 'delete' } },
      authHeaders(testUser.userId),
    );

    expect(response.status).toBe(200);
    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/CONSENT_DENIED/i);
  });

  it('all 3 tools are registered with correct names', async () => {
    const response = await jsonRpc(
      app,
      'tools/list',
      {},
      authHeaders(testUser.userId),
    );

    const body = await parseResponse(response);
    const toolNames = body.result.tools.map((t: any) => t.name).sort();

    expect(toolNames).toEqual([
      'memorize',
      'recall',
      'review',
    ]);
  });
});
