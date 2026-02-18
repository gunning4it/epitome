/**
 * Integration Tests - Memory Quality API Endpoints
 *
 * Tests memory quality endpoints:
 * - GET /v1/memory/review (user-only)
 * - POST /v1/memory/review/:id/resolve (user-only)
 * - GET /v1/memory/stats
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { grantConsent } from '@/services/consent.service';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Memory Quality API Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // Grant consent for test agent to access memory
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'memory',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'memory/*',
      permission: 'write',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('GET /v1/memory/review', () => {
    beforeEach(async () => {
      // Insert memory_meta entries in 'review' status
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, confidence, status, access_count, contradictions, promote_history)
        VALUES
        ('profile', 'v1', 'user_stated', 0.30, 'review', 0, '[]', '[]'),
        ('profile', 'v2', 'user_stated', 0.30, 'review', 0, '[]', '[]'),
        ('profile', 'v3', 'user_stated', 0.80, 'active', 0, '[]', '[]')
      `));
    });

    it('should return memories pending review', async () => {
      const response = await app.request('/v1/memory/review', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBe(2); // Only 'review' status
    });

    it('should not return active memories', async () => {
      const response = await app.request('/v1/memory/review', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      const sourceRefs = json.data.map((item: any) => item.sourceRef);
      expect(sourceRefs).not.toContain('v3'); // active status
    });

    it('should return empty array when no reviews pending', async () => {
      // Clean up test user and create new one with no memories
      await cleanupTestUser(testUser.userId);
      testUser = await createTestUser();

      const response = await app.request('/v1/memory/review', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toEqual([]);
    });

    it('should return 403 for api_key auth (user-only endpoint)', async () => {
      const response = await app.request('/v1/memory/review', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/memory/review', { method: 'GET' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/memory/review/:id/resolve', () => {
    let memoryId: number;

    beforeEach(async () => {
      // Insert memory in 'review' status
      const result = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, confidence, status, access_count, contradictions, promote_history)
        VALUES ('profile', 'v1', 'user_stated', 0.30, 'review', 0, '[]', '[]')
        RETURNING id
      `));

      memoryId = (result[0] as any).id;
    });

    it('should resolve memory with confirm action', async () => {
      const response = await app.request(`/v1/memory/review/${memoryId}/resolve`, {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { action: 'confirm' } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.success).toBe(true);
      expect(json.data.action).toBe('confirm');
    });

    it('should resolve memory with reject action', async () => {
      const response = await app.request(`/v1/memory/review/${memoryId}/resolve`, {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { action: 'reject' } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.success).toBe(true);
      expect(json.data.action).toBe('reject');
    });

    it('should resolve memory with keep_both action', async () => {
      const response = await app.request(`/v1/memory/review/${memoryId}/resolve`, {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { action: 'keep_both' } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.success).toBe(true);
      expect(json.data.action).toBe('keep_both');
    });

    it('should return 404 for non-existent memory', async () => {
      const fakeId = 999999;

      const response = await app.request(`/v1/memory/review/${fakeId}/resolve`, {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { action: 'confirm' } }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 with invalid action', async () => {
      const response = await app.request(`/v1/memory/review/${memoryId}/resolve`, {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { action: 'INVALID_DECISION' } }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 403 for api_key auth (user-only endpoint)', async () => {
      const response = await app.request(`/v1/memory/review/${memoryId}/resolve`, {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { action: 'confirm' } }),
      });

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request(`/v1/memory/review/${memoryId}/resolve`, {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ body: { action: 'confirm' } }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/memory/stats', () => {
    beforeEach(async () => {
      // Insert various memory_meta entries
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, confidence, status, access_count, contradictions, promote_history)
        VALUES
        ('profile', 'v1', 'user_stated', 0.80, 'active', 0, '[]', '[]'),
        ('profile', 'v2', 'user_stated', 0.75, 'active', 0, '[]', '[]'),
        ('entity', 'e1', 'ai_inferred', 0.40, 'unvetted', 0, '[]', '[]'),
        ('profile', 'v3', 'user_stated', 0.30, 'review', 0, '[]', '[]'),
        ('profile', 'v4', 'user_stated', 0.30, 'review', 0, '[]', '[]')
      `));
    });

    it('should return memory statistics', async () => {
      const response = await app.request('/v1/memory/stats', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toHaveProperty('totalMemories');
      expect(json.data).toHaveProperty('avgConfidence');
      expect(json.data).toHaveProperty('statusBreakdown');
      expect(json.data).toHaveProperty('needingReview');
    });

    it('should count memories by status correctly', async () => {
      const response = await app.request('/v1/memory/stats', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.statusBreakdown.active).toBe(2);
      expect(json.data.statusBreakdown.unvetted).toBe(1);
      expect(json.data.statusBreakdown.review).toBe(2);
    });

    it('should calculate average confidence', async () => {
      const response = await app.request('/v1/memory/stats', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(typeof json.data.avgConfidence).toBe('number');
      expect(json.data.avgConfidence).toBeGreaterThan(0);
      expect(json.data.avgConfidence).toBeLessThan(1);
    });

    it('should return zero stats for new user', async () => {
      const newUser = await createTestUser();

      // Grant consent for stats endpoint
      await grantConsent(newUser.userId, {
        agentId: 'test-agent',
        resource: 'memory',
        permission: 'read',
      });
      await grantConsent(newUser.userId, {
        agentId: 'test-agent',
        resource: 'memory/*',
        permission: 'read',
      });

      const response = await app.request('/v1/memory/stats', {
        method: 'GET',
        headers: createTestAuthHeaders(newUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.totalMemories).toBe(0);

      await cleanupTestUser(newUser.userId);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/memory/stats', { method: 'GET' });

      expect(response.status).toBe(401);
    });
  });
});
