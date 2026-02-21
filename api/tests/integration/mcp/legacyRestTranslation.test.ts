/**
 * Integration Tests — Legacy tool translation on /mcp/call/:toolName REST route
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders } from '../../helpers/app';
import { grantConsent } from '@/services/consent.service';

describe('MCP legacy REST translation (/mcp/call/:toolName)', () => {
  let testUser: TestUser;
  let headers: Headers;

  beforeEach(async () => {
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
    await cleanupTestUser(testUser.userId);
  });

  it('translates list_tables to recall table mode', async () => {
    const response = await app.request('/mcp/call/list_tables', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.success).toBe(true);
    expect(body.result).toHaveProperty('tables');
  });

  it('translates get_user_context with topic to context-mode recall', async () => {
    const response = await app.request('/mcp/call/get_user_context', {
      method: 'POST',
      headers,
      body: JSON.stringify({ topic: 'food' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.success).toBe(true);
    expect(body.result).toHaveProperty('profile');
    expect(body.result).not.toHaveProperty('facts');
  });

  it('translates add_record and query_table legacy calls', async () => {
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
});
