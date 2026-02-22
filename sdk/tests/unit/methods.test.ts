import { describe, expect, it } from 'vitest';
import { EpitomeClient } from '../../src/client.js';
import { createFetchMock, jsonResponse } from '../fixtures/fetch.js';

function parseJsonBody(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== 'string') return undefined;
  return JSON.parse(init.body);
}

describe('SDK endpoint methods', () => {
  it('saveMemory wraps request body and maps response fields', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({
        data: {
          id: 10,
          pending_id: null,
          collection: 'journal',
          sourceRef: 'vectors:10',
          writeId: 'w_123',
          writeStatus: 'active',
          jobId: null,
        },
        meta: {},
      }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      baseUrl: 'https://example.test',
      fetch: fetchMock,
    });

    const result = await client.saveMemory({
      text: 'Planning sprint goals',
      collection: 'journal',
      metadata: { source: 'unit-test' },
    });

    expect(requests[0].url).toBe('https://example.test/v1/vectors/journal/add');
    expect(parseJsonBody(requests[0].init)).toEqual({
      body: {
        text: 'Planning sprint goals',
        metadata: { source: 'unit-test' },
      },
    });
    expect(result.pendingId).toBeNull();
    expect(result.writeId).toBe('w_123');
  });

  it('searchMemory uses default collection when omitted', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({
        data: [
          {
            id: 1,
            collection: 'memories',
            text: 'I prefer async updates',
            metadata: {},
            similarity: 0.91,
            confidence: 0.8,
            status: 'active',
            created_at: '2026-02-22T00:00:00.000Z',
          },
        ],
        meta: { total: 1, query: 'async updates', minSimilarity: 0.7 },
      }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      baseUrl: 'https://example.test',
      fetch: fetchMock,
      defaultCollection: 'memories',
    });

    const result = await client.searchMemory({ query: 'async updates' });

    expect(requests[0].url).toBe(
      'https://example.test/v1/vectors/memories/search',
    );
    expect(result.results[0].createdAt).toBe('2026-02-22T00:00:00.000Z');
  });

  it('updateProfile wraps patch payload in body envelope', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({
        data: {
          version: 2,
          data: { timezone: 'America/New_York' },
          changedFields: ['timezone'],
          changedAt: '2026-02-22T00:00:00.000Z',
          sourceRef: 'profile:2',
          writeId: 'w_2',
          writeStatus: 'active',
          jobId: null,
        },
        meta: {},
      }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    await client.updateProfile({ patch: { timezone: 'America/New_York' } });

    expect(requests[0].url).toBe('https://example.test/v1/profile');
    expect(parseJsonBody(requests[0].init)).toEqual({
      body: { timezone: 'America/New_York' },
    });
  });

  it('queryGraph sends direct body (no body wrapper)', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({
        results: [{ id: 1, name: 'Bruce Wayne' }],
        meta: { resultCount: 1 },
      }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    const result = await client.queryGraph({ query: 'Bruce Wayne', limit: 5 });

    expect(requests[0].url).toBe('https://example.test/v1/graph/query');
    expect(parseJsonBody(requests[0].init)).toEqual({
      query: 'Bruce Wayne',
      limit: 5,
    });
    expect(result.results).toHaveLength(1);
  });

  it('queryTable sends wrapped table query body', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({
        data: [{ title: 'Long Halloween' }],
        meta: { total: 1, executionTime: 12 },
      }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    const result = await client.queryTable({
      table: 'books',
      filters: { status: 'reading' },
      limit: 10,
    });

    expect(requests[0].url).toBe('https://example.test/v1/tables/books/query');
    expect(parseJsonBody(requests[0].init)).toEqual({
      body: {
        filters: { status: 'reading' },
        limit: 10,
      },
    });
    expect(result.total).toBe(1);
  });

  it('addRecord sends wrapped body to table records endpoint', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse(
        {
          data: {
            id: 7,
            tableName: 'books',
            sourceRef: 'books:7',
            writeId: 'w_7',
            writeStatus: 'active',
            jobId: null,
          },
          meta: {},
        },
        201,
      ),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    const result = await client.addRecord({
      table: 'books',
      data: { title: 'Year One' },
    });

    expect(requests[0].url).toBe('https://example.test/v1/tables/books/records');
    expect(parseJsonBody(requests[0].init)).toEqual({
      body: { title: 'Year One' },
    });
    expect(result.id).toBe(7);
  });

  it('getUserContext encodes topic as query string', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({
        data: {
          profile: {},
          tables: [],
          collections: [],
          topEntities: [],
          recentMemories: [],
          hints: {
            hasStructuredData: false,
            hasMemories: false,
            hasGraphData: false,
            suggestedTools: [],
          },
        },
        meta: { message: 'ok' },
      }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    await client.getUserContext({ topic: 'project priorities' });

    expect(requests[0].url).toBe(
      'https://example.test/v1/profile/context?topic=project+priorities',
    );
  });
});
