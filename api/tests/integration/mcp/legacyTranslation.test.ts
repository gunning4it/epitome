/**
 * Integration Tests — Legacy tool translation on /mcp protocol route
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

describe('MCP legacy tool translation (/mcp)', () => {
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

  it('translates legacy list_tables call through recall', async () => {
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

  it('translates legacy get_user_context with topic to context mode', async () => {
    const response = await jsonRpc(
      app,
      'tools/call',
      { name: 'get_user_context', arguments: { topic: 'food' } },
      headers,
    );
    expect(response.status).toBe(200);

    const body = await parseResponse(response);
    expect(body.result).toBeDefined();
    expect(body.result.isError).toBeUndefined();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload).toHaveProperty('profile');
    expect(payload).not.toHaveProperty('facts');
  });

  it('translates legacy add_record and query_table calls', async () => {
    const addResponse = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'add_record',
        arguments: {
          table: 'books',
          data: { title: 'Dune', rating: 5 },
        },
      },
      headers,
    );
    expect(addResponse.status).toBe(200);
    const addBody = await parseResponse(addResponse);
    expect(addBody.result.isError).toBeUndefined();

    const queryResponse = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'query_table',
        arguments: {
          table: 'books',
          filters: { title: 'Dune' },
        },
      },
      headers,
    );
    expect(queryResponse.status).toBe(200);
    const queryBody = await parseResponse(queryResponse);
    expect(queryBody.result.isError).toBeUndefined();

    const payload = JSON.parse(queryBody.result.content[0].text);
    expect(payload).toHaveProperty('table', 'books');
    expect(payload).toHaveProperty('records');
  });
});
