/**
 * Integration Tests - Vectors API Endpoints
 *
 * Tests vector embedding endpoints:
 * - POST /v1/vectors/:collection/add
 * - POST /v1/vectors/:collection/search
 *
 * NOTE: Vector add/search tests require OPENAI_API_KEY for embedding generation.
 * Tests that require embedding generation are skipped when the key is not available.
 * Route/auth/validation tests still run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders } from '../../helpers/app';
import { grantConsent } from '@/services/consent.service';
import { resetAllRateLimits } from '@/services/rateLimit.service';

const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

describe('Vectors API Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // Grant consent for test agent to access vectors
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors',
      permission: 'write',
    });
    // Grant wildcard consent for vectors/* (needed for collection-specific access)
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors/*',
      permission: 'write',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('POST /v1/vectors/:collection/add', () => {
    // BUG: Vector service requires OPENAI_API_KEY for embedding generation.
    // Tests that call addVector will fail without a real OpenAI key.
    it.skipIf(!hasOpenAIKey)('should add vector with text', async () => {
      const response = await app.request('/v1/vectors/memories/add', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            text: 'I love pizza and pasta',
            metadata: { source: 'test' },
          },
        }),
      });

      expect(response.status).toBe(201);
      const json = await response.json() as any;
      expect(json.data).toHaveProperty('id');
      expect(json.data.collection).toBe('memories');
    });

    it('should return 400 without required fields', async () => {
      const response = await app.request('/v1/vectors/memories/add', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            // Missing 'text' field
            metadata: { source: 'test' },
          },
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 with empty body', async () => {
      const response = await app.request('/v1/vectors/memories/add', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/vectors/memories/add', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          body: {
            text: 'Test content',
          },
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/vectors/:collection/search', () => {
    it('should return 400 without required fields', async () => {
      const response = await app.request('/v1/vectors/memories/search', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            // Missing 'query' field
            limit: 3,
          },
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 with empty body', async () => {
      const response = await app.request('/v1/vectors/memories/search', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    // BUG: Vector service requires OPENAI_API_KEY for embedding generation in search.
    it.skipIf(!hasOpenAIKey)('should perform semantic search', async () => {
      const response = await app.request('/v1/vectors/memories/search', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            query: 'food preferences',
            limit: 3,
          },
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toBeInstanceOf(Array);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/vectors/memories/search', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          body: {
            query: 'test',
            limit: 3,
          },
        }),
      });

      expect(response.status).toBe(401);
    });
  });
});
