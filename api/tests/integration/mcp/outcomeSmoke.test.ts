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
  params: Record<string, unknown>,
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

async function parseBody(response: Response) {
  return JSON.parse(await response.text());
}

function parseToolResultPayload(body: any): Record<string, any> {
  expect(body.error).toBeUndefined();
  expect(body.result).toBeDefined();
  expect(body.result.isError).not.toBe(true);
  const text = body.result.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text);
}

describe('Outcome smoke: life-memory UX expectations', () => {
  let testUser: TestUser;
  let app: Hono<HonoEnv>;
  let claudeHeaders: Headers;
  let chatgptHeaders: Headers;

  beforeEach(async () => {
    delete process.env.MCP_ENABLE_LEGACY_TOOL_TRANSLATION;
    delete process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS;

    testUser = await createTestUser();
    app = buildTestApp();
    claudeHeaders = createTestAuthHeaders(testUser, 'claude');
    chatgptHeaders = createTestAuthHeaders(testUser, 'chatgpt');

    const resources = [
      'profile',
      'tables',
      'tables/*',
      'vectors',
      'vectors/*',
      'graph',
      'graph/*',
      'memory',
    ];

    for (const agentId of ['claude', 'chatgpt']) {
      for (const resource of resources) {
        await grantConsent(testUser.userId, {
          agentId,
          resource,
          permission: 'write',
        });
      }
    }
  });

  afterEach(async () => {
    delete process.env.MCP_ENABLE_LEGACY_TOOL_TRANSLATION;
    delete process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS;
    await cleanupTestUser(testUser.userId);
  });

  it('converges cross-agent updates for the same child profile object and recalls merged state', async () => {
    const firstWrite = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'memorize',
        arguments: {
          text: 'My daughter is Ashley Gunning.',
          category: 'profile',
          data: {
            family: {
              children: [
                {
                  name: 'Ashley Gunning',
                  relationship: 'daughter',
                },
              ],
            },
          },
        },
      },
      chatgptHeaders,
    );
    expect(firstWrite.status).toBe(200);
    parseToolResultPayload(await parseBody(firstWrite));

    const secondWrite = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'memorize',
        arguments: {
          text: 'Ashley is 5 months old and born on 2026-08-31.',
          category: 'profile',
          data: {
            family: {
              children: [
                {
                  name: 'Ashley Gunning',
                  relationship: 'daughter',
                  age: '5 months',
                  birthday: '2026-08-31',
                },
              ],
            },
          },
        },
      },
      claudeHeaders,
    );
    expect(secondWrite.status).toBe(200);
    parseToolResultPayload(await parseBody(secondWrite));

    const recallResponse = await jsonRpc(
      app,
      'tools/call',
      { name: 'recall', arguments: {} },
      chatgptHeaders,
    );
    expect(recallResponse.status).toBe(200);
    const recallPayload = parseToolResultPayload(await parseBody(recallResponse));

    const profile = recallPayload.profile;
    expect(profile).toBeTruthy();
    const children = profile?.family?.children;
    expect(Array.isArray(children)).toBe(true);

    const ashley = (children as Array<Record<string, unknown>>).find((child) =>
      String(child.name || '').toLowerCase().includes('ashley'),
    );
    expect(ashley).toBeDefined();
    expect(ashley?.name).toBe('Ashley Gunning');
    expect(ashley?.age).toBe('5 months');
    expect(ashley?.birthday).toBe('2026-08-31');
  });

  it('supports recall table shorthand and returns retrieval coverage metadata', async () => {
    const saveBook = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'memorize',
        arguments: {
          text: 'Finished reading Dune by Frank Herbert.',
          category: 'books',
          data: {
            title: 'Dune',
            author: 'Frank Herbert',
            status: 'finished',
            rating: 5,
            finished_on: '2026-02-20',
          },
        },
      },
      chatgptHeaders,
    );
    expect(saveBook.status).toBe(200);
    parseToolResultPayload(await parseBody(saveBook));

    const tableShorthandResponse = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'recall',
        arguments: {
          mode: 'table',
          table: 'books',
        },
      },
      claudeHeaders,
    );
    expect(tableShorthandResponse.status).toBe(200);
    const tableShorthandPayload = parseToolResultPayload(await parseBody(tableShorthandResponse));
    expect(tableShorthandPayload.table).toBe('books');
    expect(tableShorthandPayload.recordCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(tableShorthandPayload.records)).toBe(true);
    expect(
      tableShorthandPayload.records.some(
        (record: Record<string, unknown>) => String(record.title || '') === 'Dune',
      ),
    ).toBe(true);

    const topLevelShorthandResponse = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'recall',
        arguments: {
          mode: 'table',
          tableName: 'books',
          limit: 10,
        },
      },
      claudeHeaders,
    );
    expect(topLevelShorthandResponse.status).toBe(200);
    const topLevelShorthandPayload = parseToolResultPayload(await parseBody(topLevelShorthandResponse));
    expect(topLevelShorthandPayload.table).toBe('books');
    expect(topLevelShorthandPayload.recordCount).toBeGreaterThanOrEqual(1);

    const knowledgeResponse = await jsonRpc(
      app,
      'tools/call',
      {
        name: 'recall',
        arguments: {
          topic: "books I've read",
          budget: 'medium',
        },
      },
      chatgptHeaders,
    );
    expect(knowledgeResponse.status).toBe(200);
    const knowledgePayload = parseToolResultPayload(await parseBody(knowledgeResponse));
    expect(knowledgePayload.topic).toBe("books I've read");
    expect(Array.isArray(knowledgePayload.facts)).toBe(true);
    expect(knowledgePayload.coverageDetails).toBeDefined();
    expect(typeof knowledgePayload.coverageDetails.score).toBe('number');
    expect(Array.isArray(knowledgePayload.coverageDetails.plannedSources)).toBe(true);
    expect(Array.isArray(knowledgePayload.coverageDetails.queriedSources)).toBe(true);
    expect(Array.isArray(knowledgePayload.coverageDetails.missingSources)).toBe(true);
  });
});
