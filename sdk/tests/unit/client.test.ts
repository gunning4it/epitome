import { describe, expect, it } from 'vitest';
import { EpitomeClient } from '../../src/client.js';
import { createFetchMock, jsonResponse } from '../fixtures/fetch.js';

describe('EpitomeClient', () => {
  it('requires a non-empty api key', () => {
    expect(() => {
      new EpitomeClient({ apiKey: '' });
    }).toThrow('EpitomeClient requires a non-empty apiKey');
  });

  it('sends X-API-Key by default when no auth header is provided', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({ data: [], meta: { total: 0 } }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      baseUrl: 'https://example.test',
      fetch: fetchMock,
    });

    await client.listTables();

    expect(requests).toHaveLength(1);
    const headers = new Headers(requests[0].init?.headers);
    expect(headers.get('x-api-key')).toBe('epi_test_key');
  });

  it('uses /v1 base path normalization only once', async () => {
    const { fetchMock, requests } = createFetchMock(() =>
      jsonResponse({ data: [], meta: { total: 0 } }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      baseUrl: 'https://example.test/v1',
      fetch: fetchMock,
    });

    await client.listTables();

    expect(requests[0].url).toBe('https://example.test/v1/tables');
  });

  it('search alias delegates to searchMemory', async () => {
    const { fetchMock } = createFetchMock(() =>
      jsonResponse({
        data: [],
        meta: { total: 0, query: 'project', minSimilarity: 0.7 },
      }),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    const result = await client.search({ query: 'project' });
    expect(result.query).toBe('project');
    expect(result.results).toEqual([]);
  });
});
