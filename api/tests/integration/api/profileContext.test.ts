/**
 * Integration Tests - Profile Context Endpoint
 *
 * Tests:
 * - GET /v1/profile/context
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { grantConsent } from '../../../src/services/consent.service';
import { resetAllRateLimits } from '../../../src/services/rateLimit.service';

describe('Profile Context API Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // getUserContext is consent-aware and returns richer sections when allowed.
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'profile',
      permission: 'read',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'tables',
      permission: 'read',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors',
      permission: 'read',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'graph',
      permission: 'read',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('should return user context for authenticated API-key requests', async () => {
    const response = await app.request('/v1/profile/context?topic=project priorities', {
      method: 'GET',
      headers: createTestAuthHeaders(testUser),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('meta');
    expect(json.data).toHaveProperty('profile');
    expect(json.data).toHaveProperty('tables');
    expect(json.data).toHaveProperty('collections');
    expect(json.data).toHaveProperty('topEntities');
    expect(json.data).toHaveProperty('recentMemories');
  });

  it('should return 400 for invalid topic query params', async () => {
    const tooLongTopic = 'x'.repeat(501);
    const response = await app.request(`/v1/profile/context?topic=${tooLongTopic}`, {
      method: 'GET',
      headers: createTestAuthHeaders(testUser),
    });

    expect(response.status).toBe(400);
  });

  it('should return 401 when unauthenticated', async () => {
    const response = await app.request('/v1/profile/context', {
      method: 'GET',
    });

    expect(response.status).toBe(401);
  });

  it('should return 403 for session-authenticated requests', async () => {
    const response = await app.request('/v1/profile/context', {
      method: 'GET',
      headers: createTestSessionHeaders(testUser),
    });

    expect(response.status).toBe(403);
    const json = await response.json() as any;
    expect(json.error?.code).toBe('FORBIDDEN');
  });
});
