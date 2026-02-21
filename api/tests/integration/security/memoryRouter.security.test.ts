import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { resetAllRateLimits } from '@/services/rateLimit.service';
import { logger } from '@/utils/logger';

describe('Memory Router Security Integration', () => {
  let testUser: TestUser;
  const savedFetch = global.fetch;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    const enableResponse = await app.request('/v1/memory-router/settings', {
      method: 'PATCH',
      headers: createTestSessionHeaders(testUser),
      body: JSON.stringify({ body: { enabled: true } }),
    });
    expect(enableResponse.status).toBe(200);
  });

  afterEach(async () => {
    global.fetch = savedFetch;
    vi.restoreAllMocks();
    await cleanupTestUser(testUser.userId);
  });

  it('rejects client-supplied upstream URL override headers', async () => {
    const headers = createTestAuthHeaders(testUser);
    headers.set('x-upstream-url', 'https://evil.example.com');
    headers.set('x-epitome-memory-mode', 'off');
    headers.set('authorization', 'Bearer sk-test-openai');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error.code).toBe('UPSTREAM_OVERRIDE_BLOCKED');
  });

  it('redacts sensitive auth headers in request logs', async () => {
    const debugSpy = vi.spyOn(logger, 'debug');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('x-epitome-memory-mode', 'off');
    headers.set('authorization', 'Bearer sk-secret-openai');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);

    const requestLog = debugSpy.mock.calls.find((call) => call[0] === 'memory_router request');
    expect(requestLog).toBeDefined();
    const context = requestLog?.[1] as any;
    expect(context.headers.authorization).toBe('[REDACTED]');
  });

  it('blocks oversized payloads with 413', async () => {
    global.fetch = vi.fn() as any;
    const headers = createTestAuthHeaders(testUser);
    headers.set('x-epitome-memory-mode', 'off');
    headers.set('authorization', 'Bearer sk-test-openai');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'x'.repeat(1_100_000) }],
      }),
    });

    expect(response.status).toBe(413);
    const body = await response.json() as any;
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 403 when consent is denied for recall/search', async () => {
    global.fetch = vi.fn() as any;
    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'What do you know about me?' }],
      }),
    });

    expect(response.status).toBe(403);
    const body = await response.json() as any;
    expect(body.error.code).toBe('CONSENT_DENIED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid collection override header', async () => {
    global.fetch = vi.fn() as any;
    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');
    headers.set('x-epitome-memory-collection', 'invalid collection name');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INVALID_COLLECTION');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
