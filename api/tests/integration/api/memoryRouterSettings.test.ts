import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Memory Router Settings Integration', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('GET /settings is session-auth only', async () => {
    const sessionResponse = await app.request('/v1/memory-router/settings', {
      method: 'GET',
      headers: createTestSessionHeaders(testUser),
    });
    expect(sessionResponse.status).toBe(200);

    const apiKeyResponse = await app.request('/v1/memory-router/settings', {
      method: 'GET',
      headers: createTestAuthHeaders(testUser),
    });
    expect(apiKeyResponse.status).toBe(403);
  });

  it('PATCH /settings persists router config into profile', async () => {
    const patchResponse = await app.request('/v1/memory-router/settings', {
      method: 'PATCH',
      headers: createTestSessionHeaders(testUser),
      body: JSON.stringify({
        body: {
          enabled: true,
          defaultCollection: 'journal',
        },
      }),
    });
    expect(patchResponse.status).toBe(200);

    const settings = await patchResponse.json() as any;
    expect(settings.data.enabled).toBe(true);
    expect(settings.data.defaultCollection).toBe('journal');

    const profileResponse = await app.request('/v1/profile', {
      method: 'GET',
      headers: createTestSessionHeaders(testUser),
    });
    expect(profileResponse.status).toBe(200);
    const profile = await profileResponse.json() as any;
    expect(profile.data.feature_flags.memory_router.enabled).toBe(true);
    expect(profile.data.feature_flags.memory_router.default_collection).toBe('journal');
  });

  it('proxy endpoint returns feature-disabled while toggle is off', async () => {
    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(403);
    const body = await response.json() as any;
    expect(body.error.code).toBe('FEATURE_DISABLED');
  });
});
