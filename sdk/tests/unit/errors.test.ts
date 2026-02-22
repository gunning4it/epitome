import { describe, expect, it } from 'vitest';
import {
  EpitomeAuthError,
  EpitomeConsentError,
  EpitomeRateLimitError,
  EpitomeValidationError,
  createEpitomeError,
} from '../../src/errors.js';
import { EpitomeClient } from '../../src/client.js';
import { createFetchMock, jsonResponse } from '../fixtures/fetch.js';

describe('error mapping', () => {
  it('maps context to specialized error types', () => {
    expect(
      createEpitomeError('auth', { status: 401, code: 'UNAUTHENTICATED' }),
    ).toBeInstanceOf(EpitomeAuthError);
    expect(
      createEpitomeError('consent', { status: 403, code: 'CONSENT_DENIED' }),
    ).toBeInstanceOf(EpitomeConsentError);
    expect(
      createEpitomeError('rate', { status: 429, code: 'RATE_LIMIT_EXCEEDED' }),
    ).toBeInstanceOf(EpitomeRateLimitError);
    expect(
      createEpitomeError('validation', { status: 400, code: 'VALIDATION_ERROR' }),
    ).toBeInstanceOf(EpitomeValidationError);
  });

  it('maps API 401 response to EpitomeAuthError', async () => {
    const { fetchMock } = createFetchMock(() =>
      jsonResponse(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication required',
          },
        },
        401,
      ),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    await expect(client.getProfile()).rejects.toBeInstanceOf(EpitomeAuthError);
  });

  it('captures rate-limit headers on 429 responses', async () => {
    const { fetchMock } = createFetchMock(() =>
      jsonResponse(
        {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
          },
        },
        429,
        {
          'x-ratelimit-limit': '100',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1700000000',
          'retry-after': '60',
        },
      ),
    );

    const client = new EpitomeClient({
      apiKey: 'epi_test_key',
      fetch: fetchMock,
      baseUrl: 'https://example.test',
    });

    try {
      await client.listTables();
      throw new Error('Expected listTables to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EpitomeRateLimitError);
      if (!(error instanceof EpitomeRateLimitError)) return;
      expect(error.rateLimit?.limit).toBe(100);
      expect(error.rateLimit?.remaining).toBe(0);
      expect(error.rateLimit?.retryAfter).toBe(60);
    }
  });
});
