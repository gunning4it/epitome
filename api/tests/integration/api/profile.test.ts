/**
 * Integration Tests - Profile API Endpoints
 *
 * Tests all profile endpoints:
 * - GET /v1/profile
 * - PATCH /v1/profile
 * - GET /v1/profile/history
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser, factories } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { grantConsent } from '@/services/consent.service';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Profile API Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // Grant consent for test agent to access profile
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'profile',
      permission: 'write',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('GET /v1/profile', () => {
    it('should return the current user profile', async () => {
      const response = await app.request('/v1/profile', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json).toHaveProperty('data');
      expect(json).toHaveProperty('meta');
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/profile', { method: 'GET' });

      expect(response.status).toBe(401);
    });

    it('should return 401 with invalid API key', async () => {
      const headers = new Headers();
      headers.set('authorization', 'Bearer invalid_key');
      headers.set('content-type', 'application/json');

      const response = await app.request('/v1/profile', {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /v1/profile', () => {
    it('should update profile with valid data', async () => {
      const profileData = factories.profile.basic();

      const response = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: profileData }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toHaveProperty('version');
      expect(json.data).toHaveProperty('changedFields');
    });

    it('should perform deep merge on nested objects', async () => {
      // First update
      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            name: 'Test User',
            preferences: { dietary: ['vegetarian'] },
          },
        }),
      });

      // Second update - should merge with existing preferences
      const response = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            preferences: { allergies: ['peanuts'] },
          },
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.data.preferences).toEqual({
        dietary: ['vegetarian'],
        allergies: ['peanuts'],
      });
    });

    it('should track changed fields correctly', async () => {
      // Initial profile
      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            name: 'Test User',
            timezone: 'America/New_York',
          },
        }),
      });

      // Update only timezone
      const response = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            timezone: 'America/Los_Angeles',
          },
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.changedFields).toEqual(['timezone']);
    });

    it('should register contradictions when an existing fact changes', async () => {
      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { name: 'Alice' } }),
      });

      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { name: 'Bob' } }),
      });

      const rows = await db.execute(sql.raw(`
        SELECT contradictions
        FROM ${testUser.schemaName}.memory_meta
        ORDER BY created_at DESC
        LIMIT 1
      `));

      const contradictions = ((rows[0] as any)?.contradictions || []) as Array<{ field: string }>;
      expect(contradictions.length).toBeGreaterThan(0);
      expect(contradictions[0].field).toBe('profile.name');
    });

    it('should reinforce previous memory on reaffirmed profile values', async () => {
      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { name: 'Alice' } }),
      });

      const firstMetaRows = await db.execute(sql.raw(`
        SELECT _meta_id
        FROM ${testUser.schemaName}.profile
        ORDER BY version DESC
        LIMIT 1
      `));
      const firstMetaId = Number((firstMetaRows[0] as any)?._meta_id);

      const beforeRows = await db.execute(sql.raw(`
        SELECT confidence, last_reinforced
        FROM ${testUser.schemaName}.memory_meta
        WHERE id = ${firstMetaId}
      `));
      const beforeConfidence = Number((beforeRows[0] as any)?.confidence || 0);

      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { name: 'Alice' } }),
      });

      const afterRows = await db.execute(sql.raw(`
        SELECT confidence, last_reinforced
        FROM ${testUser.schemaName}.memory_meta
        WHERE id = ${firstMetaId}
      `));
      const afterConfidence = Number((afterRows[0] as any)?.confidence || 0);
      const lastReinforced = (afterRows[0] as any)?.last_reinforced;

      expect(afterConfidence).toBeGreaterThan(beforeConfidence);
      expect(lastReinforced).toBeTruthy();
    });

    it('should promote ai_inferred profile memory to active after repeated reads', async () => {
      const writeResponse = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { nickname: 'runner' } }),
      });
      expect(writeResponse.status).toBe(200);

      const metaRows = await db.execute(sql.raw(`
        SELECT _meta_id
        FROM ${testUser.schemaName}.profile
        ORDER BY version DESC
        LIMIT 1
      `));
      const metaId = Number((metaRows[0] as any)?._meta_id);
      expect(Number.isInteger(metaId)).toBe(true);

      const beforeRows = await db.execute(sql.raw(`
        SELECT confidence, status, access_count
        FROM ${testUser.schemaName}.memory_meta
        WHERE id = ${metaId}
      `));
      const before = beforeRows[0] as any;
      expect(before.status).toBe('unvetted');

      for (let i = 0; i < 5; i++) {
        const readResponse = await app.request('/v1/profile', {
          method: 'GET',
          headers: createTestAuthHeaders(testUser),
        });
        expect(readResponse.status).toBe(200);
      }

      const afterRows = await db.execute(sql.raw(`
        SELECT confidence, status, access_count
        FROM ${testUser.schemaName}.memory_meta
        WHERE id = ${metaId}
      `));
      const after = afterRows[0] as any;

      expect(Number(after.access_count)).toBeGreaterThan(Number(before.access_count));
      expect(Number(after.confidence)).toBeGreaterThan(Number(before.confidence));
      expect(Number(after.confidence)).toBeGreaterThanOrEqual(0.5);
      expect(after.status).toBe('active');
    });

    it('should move conflicting high-confidence profile facts into review and allow confirm resolution', async () => {
      const initialResponse = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { timezone: 'America/New_York' } }),
      });
      expect(initialResponse.status).toBe(200);

      const contradictionResponse = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { timezone: 'America/Los_Angeles' } }),
      });
      expect(contradictionResponse.status).toBe(200);

      const reviewRows = await db.execute(sql.raw(`
        SELECT id, status
        FROM ${testUser.schemaName}.memory_meta
        WHERE source_type = 'profile'
        ORDER BY created_at DESC
        LIMIT 2
      `));

      expect(reviewRows).toHaveLength(2);
      const statuses = reviewRows.map((row: any) => row.status);
      expect(statuses).toEqual(['review', 'review']);

      const reviewMetaId = Number((reviewRows[0] as any).id);
      const resolveResponse = await app.request(`/v1/memory/review/${reviewMetaId}/resolve`, {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({ body: { action: 'confirm' } }),
      });
      expect(resolveResponse.status).toBe(200);

      const resolvedRows = await db.execute(sql.raw(`
        SELECT status, confidence
        FROM ${testUser.schemaName}.memory_meta
        WHERE id = ${reviewMetaId}
      `));
      const resolved = resolvedRows[0] as any;
      expect(resolved.status).toBe('trusted');
      expect(Number(resolved.confidence)).toBeCloseTo(0.95, 2);
    });

    it('should reject invalid profile data', async () => {
      const response = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify('not-an-object'),
      });

      expect(response.status).toBe(400);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ body: { name: 'Test' } }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/profile/history', () => {
    beforeEach(async () => {
      // Create profile history using session headers (user-only endpoint)
      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { name: 'Version 2' } }),
      });

      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { name: 'Version 3' } }),
      });
    });

    it('should return profile history', async () => {
      // Profile history is a user-only endpoint (requireUser middleware)
      const response = await app.request('/v1/profile/history', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should paginate history with limit', async () => {
      const response = await app.request('/v1/profile/history?limit=1', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.length).toBe(1);
    });

    it('should return 403 for api_key auth (user-only endpoint)', async () => {
      const response = await app.request('/v1/profile/history', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/profile/history', { method: 'GET' });

      expect(response.status).toBe(401);
    });
  });

  // ---------------------------------------------------
  // Phase 0 — red baseline: identity safety
  // ---------------------------------------------------
  describe('Phase 0 — red baseline: identity safety', () => {
    it('should block agent from setting profile.name to a known family member name', async () => {
      // First, set up profile with family data
      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            name: 'Bruce Wayne',
            family: [
              { name: 'Georgia', relation: 'daughter' },
            ],
          },
        }),
      });

      // Now, agent tries to set name to 'Georgia' (a family member)
      const response = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: { name: 'Georgia' },
        }),
      });

      // Should be blocked with identity violation
      expect(response.status).toBe(409);
      const json = await response.json() as any;
      expect(json.error).toMatch(/identity/i);
    });

    it('should allow agent to set profile.name to a non-family name', async () => {
      // Set up profile with family data
      await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            name: 'Bruce Wayne',
            family: [
              { name: 'Georgia', relation: 'daughter' },
            ],
          },
        }),
      });

      // Agent sets name to a non-family name
      const response = await app.request('/v1/profile', {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: { name: 'Bruce Thomas Wayne' },
        }),
      });

      expect(response.status).toBe(200);
    });
  });
});
