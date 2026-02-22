/**
 * Integration Tests — legacy REST MCP endpoints compatibility mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authResolver } from '@/middleware/auth';
import { createMcpRoutes } from '@/mcp/handler';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders } from '../../helpers/app';
import { grantConsent } from '@/services/consent.service';
import type { HonoEnv } from '@/types/hono';

function buildTestApp() {
  const app = new Hono<HonoEnv>();
  app.use('*', authResolver);
  app.route('/mcp', createMcpRoutes());
  return app;
}

describe('MCP legacy REST endpoints (/mcp/call/:toolName)', () => {
  let testUser: TestUser;
  let headers: Headers;

  beforeEach(async () => {
    delete process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS;
    testUser = await createTestUser();
    headers = createTestAuthHeaders(testUser, 'test-rest-agent');

    for (const resource of [
      'profile', 'tables', 'tables/*', 'vectors', 'vectors/*',
      'graph', 'graph/*', 'memory',
    ]) {
      await grantConsent(testUser.userId, {
        agentId: 'test-rest-agent',
        resource,
        permission: 'write',
      });
    }
  });

  afterEach(async () => {
    delete process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS;
    await cleanupTestUser(testUser.userId);
  });

  it('is disabled by default', async () => {
    const app = buildTestApp();
    const response = await app.request('/mcp/call/list_tables', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(410);
    const body = await response.json() as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('LEGACY_ENDPOINT_DISABLED');
  });

  it('compat mode: supports canonical tools when REST endpoint flag is enabled', async () => {
    process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS = 'true';
    const app = buildTestApp();
    const response = await app.request('/mcp/call/recall', {
      method: 'POST',
      headers,
      body: JSON.stringify({ topic: 'food' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.success).toBe(true);
    expect(body.result).toHaveProperty('facts');
  });

  it('compat mode: translates legacy names on call path', async () => {
    process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS = 'true';
    const app = buildTestApp();

    const addResponse = await app.request('/mcp/call/add_record', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        table: 'books',
        data: { title: 'Dune', rating: 5 },
      }),
    });
    expect(addResponse.status).toBe(200);
    const addBody = await addResponse.json() as any;
    expect(addBody.success).toBe(true);
    expect(addBody.result.table).toBe('books');

    const queryResponse = await app.request('/mcp/call/query_table', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        table: 'books',
        filters: { title: 'Dune' },
      }),
    });
    expect(queryResponse.status).toBe(200);
    const queryBody = await queryResponse.json() as any;
    expect(queryBody.success).toBe(true);
    expect(queryBody.result.table).toBe('books');
    expect(Array.isArray(queryBody.result.records)).toBe(true);
  });

  it('compat mode: translates get_user_context with topic phrase', async () => {
    process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS = 'true';
    const app = buildTestApp();

    const response = await app.request('/mcp/call/get_user_context', {
      method: 'POST',
      headers,
      body: JSON.stringify({ topic: 'books read / reading history' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.success).toBe(true);
    expect(body.result).toHaveProperty('topic', 'books read / reading history');
    expect(Array.isArray(body.result.facts)).toBe(true);
  });
});
