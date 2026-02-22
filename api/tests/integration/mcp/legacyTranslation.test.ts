/**
 * Integration Tests — MCP protocol tool-surface contract on /mcp.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authResolver } from '@/middleware/auth';
import { createMcpRoutes } from '@/mcp/handler';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { grantConsent } from '@/services/consent.service';
import { createTestAuthHeaders } from '../../helpers/app';
import type { HonoEnv } from '@/types/hono';

function buildTestApp() {
  const app = new Hono<HonoEnv>();
  app.use('*', authResolver);
  app.route('/mcp', createMcpRoutes());
  return app;
}

async function jsonRpc(
  app: Hono<HonoEnv>,
  method: string,
  params: Record<string, unknown> = {},
  headers: Headers,
) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Content-Type', 'application/json');
  requestHeaders.set('Accept', 'application/json, text/event-stream');

  return app.request('/mcp', {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
}

async function parseResponse(response: Response) {
  return JSON.parse(await response.text());
}

describe('MCP canonical tool contract (/mcp)', () => {
  let testUser: TestUser;
  let app: Hono<HonoEnv>;
  let headers: Headers;

  beforeEach(async () => {
    testUser = await createTestUser();
    app = buildTestApp();
    headers = createTestAuthHeaders(testUser, 'test-mcp-agent');

    for (const resource of [
      'profile', 'tables', 'tables/*', 'vectors', 'vectors/*',
      'graph', 'graph/*', 'memory',
    ]) {
      await grantConsent(testUser.userId, {
        agentId: 'test-mcp-agent',
        resource,
        permission: 'write',
      });
    }
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('keeps tools/list to 3 facade tools', async () => {
    const response = await jsonRpc(app, 'tools/list', {}, headers);
    expect(response.status).toBe(200);

    const body = await parseResponse(response);
    const names = body.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(['memorize', 'recall', 'review']);
  });

  it('translates legacy tool names on tools/call ingress', async () => {
    const response = await jsonRpc(
      app,
      'tools/call',
      { name: 'list_tables', arguments: {} },
      headers,
    );
    expect(response.status).toBe(200);

    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBeUndefined();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload).toHaveProperty('tables');
  });

  it('still executes canonical tools', async () => {
    const response = await jsonRpc(
      app,
      'tools/call',
      { name: 'recall', arguments: {} },
      headers,
    );
    expect(response.status).toBe(200);

    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBeUndefined();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload).toHaveProperty('profile');
  });

  it('translates get_user_context topic phrases to knowledge retrieval', async () => {
    const response = await jsonRpc(
      app,
      'tools/call',
      { name: 'get_user_context', arguments: { topic: 'books read / reading history' } },
      headers,
    );
    expect(response.status).toBe(200);

    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBeUndefined();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload).toHaveProperty('topic', 'books read / reading history');
    expect(Array.isArray(payload.facts)).toBe(true);
  });
});
