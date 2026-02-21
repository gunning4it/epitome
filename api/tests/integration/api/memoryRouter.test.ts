/**
 * Integration Tests - Memory Router API
 *
 * Task 1 focuses on route scaffolding:
 * - Auth guard behavior
 * - Request validation
 * - Expensive rate-limit middleware hook
 * - Unsupported path handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders } from '../../helpers/app';
import { grantConsent } from '@/services/consent.service';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Memory Router API Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // Grant broad consent needed for recall + save flows used by memory router.
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'profile',
      permission: 'read',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors/*',
      permission: 'write',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('POST /v1/memory-router/openai/v1/chat/completions', () => {
    const validBody = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'What do you know about me?' },
      ],
    };

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(validBody),
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid payload with auth', async () => {
      const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          model: '',
          messages: [],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should apply expensive operation rate-limit middleware', async () => {
      const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify(validBody),
      });

      expect(response.headers.get('x-ratelimit-limit-expensive')).toBeDefined();
      expect(response.headers.get('x-ratelimit-remaining-expensive')).toBeDefined();
    });
  });

  describe('POST /v1/memory-router/anthropic/v1/messages', () => {
    const validBody = {
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 256,
      messages: [
        { role: 'user', content: 'What do you know about me?' },
      ],
    };

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/memory-router/anthropic/v1/messages', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(validBody),
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid payload with auth', async () => {
      const headers = createTestAuthHeaders(testUser);
      headers.set('x-anthropic-api-key', 'sk-ant-test');

      const response = await app.request('/v1/memory-router/anthropic/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: '',
          messages: [],
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('unsupported provider paths', () => {
    it('should return 404 for unknown provider route', async () => {
      const response = await app.request('/v1/memory-router/unknown/v1/chat/completions', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });

      expect(response.status).toBe(404);
    });
  });
});
