/**
 * Integration Tests - Activity API Endpoints
 *
 * Tests activity and audit endpoints:
 * - GET /v1/activity (user-only, returns 403 for api_key auth)
 * - DELETE /v1/agents/:id (user-only)
 * - GET /v1/export (user-only)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { grantConsent } from '@/services/consent.service';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Activity API Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // Grant consent for test agent to access activity
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'activity',
      permission: 'write',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('GET /v1/activity', () => {
    beforeEach(async () => {
      // Insert audit log entries using the correct schema columns
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.audit_log
        (agent_id, agent_name, action, resource, details, created_at)
        VALUES
        ('claude', 'Claude', 'read', 'profile', '{"detail": "test1"}', NOW() - INTERVAL '2 hours'),
        ('claude', 'Claude', 'write', 'tables/meals', '{"detail": "test2"}', NOW() - INTERVAL '1 hour'),
        ('gpt-4', 'GPT-4', 'read', 'graph/entities', '{"detail": "test3"}', NOW())
      `));
    });

    it('should return audit log entries', async () => {
      const response = await app.request('/v1/activity', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toBeInstanceOf(Array);
      // 3 pre-inserted + 1 from the handler logging this access = 4
      expect(json.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by agentId', async () => {
      const response = await app.request('/v1/activity?agentId=claude', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.length).toBe(2);
      expect(json.data.every((e: any) => e.agent_id === 'claude')).toBe(true);
    });

    it('should filter by action', async () => {
      const response = await app.request('/v1/activity?action=read', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.length).toBe(2);
      expect(json.data.every((e: any) => e.action === 'read')).toBe(true);
    });

    it('should filter by resource', async () => {
      const response = await app.request('/v1/activity?resource=profile', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.length).toBe(1);
      expect(json.data[0].resource).toBe('profile');
    });

    it('should paginate results', async () => {
      const response = await app.request('/v1/activity?limit=2', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.length).toBe(2);
    });

    it('should support offset pagination', async () => {
      const response = await app.request('/v1/activity?offset=1&limit=1', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.length).toBe(1);
    });

    it('should return events in reverse chronological order', async () => {
      const response = await app.request('/v1/activity', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;

      const timestamps = json.data.map((e: any) => new Date(e.created_at).getTime());

      // Should be descending order
      for (let i = 0; i < timestamps.length - 1; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
      }
    });

    it('should return 403 for api_key auth (user-only endpoint)', async () => {
      const response = await app.request('/v1/activity', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/activity', { method: 'GET' });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /v1/agents/:id', () => {
    beforeEach(async () => {
      // Insert consent rules in the user schema
      await grantConsent(testUser.userId, {
        agentId: 'claude',
        resource: 'profile',
        permission: 'read',
      });
      await grantConsent(testUser.userId, {
        agentId: 'claude',
        resource: 'tables',
        permission: 'write',
      });
      await grantConsent(testUser.userId, {
        agentId: 'gpt-4',
        resource: 'profile',
        permission: 'read',
      });
    });

    it('should revoke all permissions for agent', async () => {
      const response = await app.request('/v1/agents/claude', {
        method: 'DELETE',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.success).toBe(true);
      expect(json.data.agentId).toBe('claude');
    });

    it('should return 200 even if no permissions exist for agent', async () => {
      const response = await app.request('/v1/agents/nonexistent', {
        method: 'DELETE',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.success).toBe(true);
    });

    it('should return 403 for api_key auth (user-only endpoint)', async () => {
      const response = await app.request('/v1/agents/claude', {
        method: 'DELETE',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/agents/claude', {
        method: 'DELETE',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/export', () => {
    it('should export user data', async () => {
      const response = await app.request('/v1/export', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toHaveProperty('exportedAt');
      expect(json.data).toHaveProperty('profile');
      expect(json.data).toHaveProperty('tables');
    });

    it('should include vectors and graph payloads with seeded data', async () => {
      // Seed one table record through API (real write flow)
      const tableWriteResponse = await app.request('/v1/tables/meals/records', {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({
          body: {
            dish: 'Pasta',
            calories: 550,
          },
        }),
      });
      expect(tableWriteResponse.status).toBe(201);

      // Seed one vector collection + vector row
      const vectorMetaRows = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, confidence, status, access_count, contradictions, promote_history)
        VALUES ('vector', 'memories:seed', 'user_stated', 0.85, 'trusted', 0, '[]', '[]')
        RETURNING id
      `));
      const vectorMetaId = Number((vectorMetaRows[0] as any).id);

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}._vector_collections
        (collection, description, entry_count, embedding_dim, created_at, updated_at)
        VALUES ('memories', 'Seeded vectors', 1, 1536, NOW(), NOW())
        ON CONFLICT (collection)
        DO UPDATE SET entry_count = EXCLUDED.entry_count, updated_at = NOW()
      `));

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.vectors
        (collection, text, embedding, metadata, created_at, _meta_id)
        VALUES (
          'memories',
          'I love weekend hikes',
          array_fill(0.0::real, ARRAY[1536])::vector,
          '{"source":"integration-test"}'::jsonb,
          NOW(),
          ${vectorMetaId}
        )
      `));

      // Seed graph entities + edge + memory metadata
      const entityRows = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name, properties, confidence, mention_count, first_seen, last_seen)
        VALUES
        ('person', 'Alice', '{}'::jsonb, 0.90, 1, NOW(), NOW()),
        ('person', 'Bob', '{}'::jsonb, 0.88, 1, NOW(), NOW())
        RETURNING id
      `));
      const aliceId = Number((entityRows[0] as any).id);
      const bobId = Number((entityRows[1] as any).id);

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, confidence, status, access_count, contradictions, promote_history)
        VALUES
        ('entity', 'entity:${aliceId}', 'user_stated', 0.9, 'trusted', 0, '[]', '[]'),
        ('entity', 'entity:${bobId}', 'user_stated', 0.88, 'trusted', 0, '[]', '[]')
      `));

      const edgeRows = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight, confidence, evidence, first_seen, last_seen, properties)
        VALUES
        (${aliceId}, ${bobId}, 'related_to', 1.0, 0.8, '[]'::jsonb, NOW(), NOW(), '{}'::jsonb)
        RETURNING id
      `));
      const edgeId = Number((edgeRows[0] as any).id);

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, confidence, status, access_count, contradictions, promote_history)
        VALUES
        ('edge', 'edge:${edgeId}', 'ai_inferred', 0.6, 'active', 0, '[]', '[]')
      `));

      const response = await app.request('/v1/export', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.vectors).toBeDefined();
      expect(json.data.vectors.collections.length).toBeGreaterThanOrEqual(1);
      expect(json.data.vectors.entries.memories).toBeInstanceOf(Array);
      expect(json.data.vectors.entries.memories.length).toBeGreaterThan(0);

      expect(json.data.graph).toBeDefined();
      expect(json.data.graph.entities.length).toBeGreaterThanOrEqual(2);
      expect(json.data.graph.edges.length).toBeGreaterThanOrEqual(1);

      expect(json.data.meta.vectorCount).toBeGreaterThanOrEqual(1);
      expect(json.data.meta.graphEntityCount).toBeGreaterThanOrEqual(2);
      expect(json.data.meta.graphEdgeCount).toBeGreaterThanOrEqual(1);
    });

    it('should be valid JSON format', async () => {
      const response = await app.request('/v1/export', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(() => JSON.stringify(json)).not.toThrow();
    });

    it('should return 403 for api_key auth (user-only endpoint)', async () => {
      const response = await app.request('/v1/export', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/export', { method: 'GET' });

      expect(response.status).toBe(401);
    });
  });
});
