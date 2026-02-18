/**
 * Integration Tests - Graph API Endpoints
 *
 * Tests knowledge graph endpoints:
 * - GET /v1/graph/entities
 * - GET /v1/graph/entities/:id
 * - GET /v1/graph/entities/:id/neighbors
 * - POST /v1/graph/traverse
 * - POST /v1/graph/query
 * - POST /v1/graph/pattern
 * - GET /v1/graph/stats
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser, factories } from '../../helpers/db';
import { createTestAuthHeaders } from '../../helpers/app';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { grantConsent } from '@/services/consent.service';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Graph API Integration Tests', () => {
  let testUser: TestUser;
  let aliceId: string;
  let bobId: string;
  let charlieId: string;
  let davidId: string;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // Grant consent for test agent to access graph endpoints
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'graph',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'profile',
      permission: 'read',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'tables',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors',
      permission: 'write',
    });

    // Create test graph (using actual schema column names: type, name, properties)
    const aliceResult = await db.execute(sql.raw(`
      INSERT INTO ${testUser.schemaName}.entities
      (type, name, properties, mention_count)
      VALUES ('person', 'Alice', '{"aliases": ["Alice Smith"]}'::jsonb, 3)
      RETURNING id
    `));
    aliceId = (aliceResult[0] as any).id;

    const bobResult = await db.execute(sql.raw(`
      INSERT INTO ${testUser.schemaName}.entities
      (type, name, properties, mention_count)
      VALUES ('person', 'Bob', '{}'::jsonb, 2)
      RETURNING id
    `));
    bobId = (bobResult[0] as any).id;

    const charlieResult = await db.execute(sql.raw(`
      INSERT INTO ${testUser.schemaName}.entities
      (type, name, properties, mention_count)
      VALUES ('person', 'Charlie', '{}'::jsonb, 1)
      RETURNING id
    `));
    charlieId = (charlieResult[0] as any).id;

    // Create David - entity with no neighbors (for testing empty neighbors)
    const davidResult = await db.execute(sql.raw(`
      INSERT INTO ${testUser.schemaName}.entities
      (type, name, properties, mention_count)
      VALUES ('person', 'David', '{}'::jsonb, 1)
      RETURNING id
    `));
    davidId = (davidResult[0] as any).id;

    // Create edges (using actual schema column names: source_id, target_id, relation)
    await db.execute(sql.raw(`
      INSERT INTO ${testUser.schemaName}.edges
      (source_id, target_id, relation, weight)
      VALUES
      (${aliceId}, ${bobId}, 'FRIEND_OF', 1.5),
      (${bobId}, ${charlieId}, 'COLLEAGUE_OF', 1.0)
    `));
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('GET /v1/graph/entities', () => {
    it('should return all entities', async () => {
      const headers = createTestAuthHeaders(testUser);
      const response = await app.request('/v1/graph/entities', {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.entities).toBeInstanceOf(Array);
      expect(data.entities.length).toBe(4); // Alice, Bob, Charlie, David
    });

    it('should filter by type', async () => {
      // Add a Location entity
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name)
        VALUES ('place', 'New York')
      `));

      const response = await app.request('/v1/graph/entities?type=person', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.entities.length).toBe(4); // Alice, Bob, Charlie, David (all persons)
      expect(data.entities.every((e: any) => e.type === 'person')).toBe(true);
    });

    it('should paginate results', async () => {
      const response = await app.request('/v1/graph/entities?limit=2', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.entities.length).toBe(2);
    });

    it('should scope returned edges to paged entities (no global truncation artifacts)', async () => {
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight, confidence)
        VALUES (${charlieId}, ${davidId}, 'NOISE_EDGE', 9.9, 1.0)
      `));

      const response = await app.request('/v1/graph/entities?limit=2&edgeLimit=1', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.entities.length).toBe(2);
      expect(data.edges.length).toBe(1);

      const visibleEntityIds = new Set(data.entities.map((entity: any) => entity.id));
      expect(visibleEntityIds.has(data.edges[0].source_id)).toBe(true);
      expect(visibleEntityIds.has(data.edges[0].target_id)).toBe(true);
      expect(data.meta.edge_pagination.limit).toBe(1);
      expect(data.meta.edge_total).toBe(1);
    });

    it('should return all edges in stableMode (edges scoped to visible entities only)', async () => {
      const stableEdgeResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight, confidence)
        VALUES (${aliceId}, ${davidId}, 'MENTOR_OF', 2.2, 0.98)
        RETURNING id
      `));
      const stableEdgeId = (stableEdgeResult[0] as any).id;

      const inferredEdgeResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight, confidence)
        VALUES (${bobId}, ${davidId}, 'KNOWS', 2.1, 0.98)
        RETURNING id
      `));
      const inferredEdgeId = (inferredEdgeResult[0] as any).id;

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, status, confidence)
        VALUES
        ('edge', 'edge:${stableEdgeId}', 'user_stated', 'active', 0.98),
        ('edge', 'edge:${inferredEdgeId}', 'ai_inferred', 'active', 0.98)
      `));

      const response = await app.request('/v1/graph/entities?stableMode=true&stableConfidenceMin=0.95&edgeLimit=50', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      const edgeIds = new Set(data.edges.map((edge: any) => edge.id));
      // Stable mode no longer filters edges — edges are scoped to visible entities by SQL
      expect(edgeIds.has(stableEdgeId)).toBe(true);
      expect(edgeIds.has(inferredEdgeId)).toBe(true);
      expect(data.meta.stableMode).toBe(true);
    });

    it('should exclude soft-deleted entities', async () => {
      // Soft-delete Bob
      await db.execute(sql.raw(`
        UPDATE ${testUser.schemaName}.entities
        SET _deleted_at = NOW()
        WHERE id = '${bobId}'
      `));

      const response = await app.request('/v1/graph/entities', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.entities.length).toBe(3); // Alice, Charlie, David (Bob deleted)
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/graph/entities', { method: "GET" });

      expect(response.status).toBe(401);
      const data = await response.json();
    });
  });

  describe('GET /v1/graph/entities/:id', () => {
    it('should return entity details', async () => {
      const response = await app.request(`/v1/graph/entities/${aliceId}`, {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(aliceId);
      expect(data.name).toBe('Alice');
      expect(data.type).toBe('person');
      expect(data.properties.aliases).toEqual(['Alice Smith']);
    });

    it('should return 404 for non-existent entity', async () => {
      const fakeId = 999999; // Non-existent integer ID

      const response = await app.request(`/v1/graph/entities/${fakeId}`, {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
    });

    it('should return 404 for soft-deleted entity', async () => {
      // Soft-delete Alice
      await db.execute(sql.raw(`
        UPDATE ${testUser.schemaName}.entities
        SET _deleted_at = NOW()
        WHERE id = '${aliceId}'
      `));

      const response = await app.request(`/v1/graph/entities/${aliceId}`, {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request(`/v1/graph/entities/${aliceId}`, { method: "GET" });

      expect(response.status).toBe(401);
      const data = await response.json();
    });
  });

  describe('GET /v1/graph/entities/:id/neighbors', () => {
    it('should return direct neighbors', async () => {
      const response = await app.request(`/v1/graph/entities/${aliceId}/neighbors`, {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.neighbors).toBeInstanceOf(Array);
      expect(data.neighbors.length).toBe(1); // Bob
      expect(data.neighbors[0].entity.name).toBe('Bob');
      expect(data.neighbors[0].relation).toBe('FRIEND_OF');
    });

    it('should filter by relation', async () => {
      // Add another edge with different type
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight)
        VALUES ('${aliceId}', '${charlieId}', 'COLLEAGUE_OF', 1.0)
      `));

      const response = await app.request(`/v1/graph/entities/${aliceId}/neighbors?relation=FRIEND_OF`, {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.neighbors.length).toBe(1);
      expect(data.neighbors[0].relation).toBe('FRIEND_OF');
    });

    it('should return empty array for entity with no neighbors', async () => {
      const response = await app.request(`/v1/graph/entities/${davidId}/neighbors`, {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.neighbors).toEqual([]);
    });

    it('should return 404 for non-existent entity', async () => {
      const fakeId = 999999; // Non-existent integer ID

      const response = await app.request(`/v1/graph/entities/${fakeId}/neighbors`, {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request(`/v1/graph/entities/${aliceId}/neighbors`, { method: "GET" });

      expect(response.status).toBe(401);
      const data = await response.json();
    });
  });

  describe('POST /v1/graph/traverse', () => {
    it('should perform multi-hop traversal', async () => {
      const response = await app.request('/v1/graph/traverse', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          startId: aliceId,
          maxDepth: 2,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.paths).toBeInstanceOf(Array);
      expect(data.paths.length).toBeGreaterThan(0);
    });

    it('should respect max_depth parameter', async () => {
      const response = await app.request('/v1/graph/traverse', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  startId: aliceId,
                  maxDepth: 1,
                }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      // All nodes should be at most 1 hop deep
      expect(data.paths.every((node: any) => node.depth <= 1)).toBe(true);
    });

    it('should filter by relations', async () => {
      const response = await app.request('/v1/graph/traverse', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  startId: aliceId,
                  maxDepth: 2,
                  relationFilter: 'FRIEND_OF',
                }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should only return nodes reachable via FRIEND_OF edges
      expect(data.paths).toBeInstanceOf(Array);
      // Bob is reachable via FRIEND_OF, Charlie is not (only via COLLEAGUE_OF)
      const names = data.paths.map((node: any) => node.name);
      expect(names).toContain('Bob');
      expect(names).not.toContain('Charlie');
    });

    it('should return 404 for non-existent start entity', async () => {
      const fakeId = 999999; // Non-existent integer ID

      const response = await app.request('/v1/graph/traverse', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  startId: fakeId,
                  maxDepth: 2,
                }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
    });

    it('should return 400 with invalid max_depth', async () => {
      const response = await app.request('/v1/graph/traverse', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  startId: aliceId,
                  maxDepth: -1,
                }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/graph/traverse', {
        method: "POST",
        body: JSON.stringify({
                  startId: aliceId,
                  maxDepth: 2,
                }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
    });
  });

  describe('POST /v1/graph/query', () => {
    it('should query entities by name', async () => {
      const response = await app.request('/v1/graph/query', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          sql: "SELECT * FROM entities WHERE name LIKE '%Alice%';",
          limit: 10,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
      expect(data.results.some((r: any) => r.name === 'Alice')).toBe(true);
    });

    it('should search aliases', async () => {
      const response = await app.request('/v1/graph/query', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  query: 'Alice Smith', // This is an alias
                }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results.some((r: any) => r.name === 'Alice')).toBe(true);
    });

    it('should filter by type', async () => {
      // Add a Location entity
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name)
        VALUES ('place', 'Alice Springs')
      `));

      const response = await app.request('/v1/graph/query', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  query: 'Alice',
                  type: 'person',
                }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results.every((r: any) => r.type === 'person')).toBe(true);
    });

    it('should limit results', async () => {
      const response = await app.request('/v1/graph/query', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  query: 'e', // Match multiple entities
                  limit: 1,
                }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results.length).toBeLessThanOrEqual(1);
    });

    it('should return empty array for no matches', async () => {
      const response = await app.request('/v1/graph/query', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  query: 'NonexistentEntity',
                }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/graph/query', {
        method: "POST",
        body: JSON.stringify({
                  query: 'Alice',
                }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
    });
  });

  describe('POST /v1/graph/pattern', () => {
    it('should find pattern matches with "what X do I like?" pattern', async () => {
      // Add test data: food entities with 'likes' edges
      const pizzaResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name)
        VALUES ('food', 'Pizza')
        RETURNING id
      `));
      const pizzaId = (pizzaResult[0] as any).id;

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight)
        VALUES (${aliceId}, ${pizzaId}, 'likes', 2.0)
      `));

      const response = await app.request('/v1/graph/pattern', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  pattern: 'what food do I like?',
                }),
      });

      expect(response.status).toBe(200);
      const response_data = await response.json();
      expect(response_data.data.entities).toBeInstanceOf(Array);
      expect(response_data.data.entities.length).toBeGreaterThan(0);
      expect(response_data.data.explanation).toContain('food');
    });

    it('should find pattern matches with "where do I X?" pattern', async () => {
      // Add test data: place entities with activity edges
      const gymResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name)
        VALUES ('place', 'City Gym')
        RETURNING id
      `));
      const gymId = (gymResult[0] as any).id;

      const activityResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name)
        VALUES ('activity', 'Running')
        RETURNING id
      `));
      const activityId = (activityResult[0] as any).id;

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight)
        VALUES (${activityId}, ${gymId}, 'located_at', 1.0)
      `));

      const response = await app.request('/v1/graph/pattern', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  pattern: 'where do I run?',
                }),
      });

      expect(response.status).toBe(200);
      const response_data = await response.json();
      expect(response_data.data.entities).toBeInstanceOf(Array);
      expect(response_data.data.explanation).toContain('places');
    });

    it('should return error for unrecognized pattern', async () => {
      const response = await app.request('/v1/graph/pattern', {
        method: "POST",
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
                  pattern: 'this is not a valid pattern format',
                }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Supported patterns');
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/graph/pattern', {
        method: "POST",
        body: JSON.stringify({
                  pattern: {
                    type: 'person',
                  },
                }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
    });
  });

  describe('GET /v1/graph/stats', () => {
    it('should return graph statistics', async () => {
      const response = await app.request('/v1/graph/stats', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('total_entities');
      expect(data).toHaveProperty('total_edges');
      expect(data).toHaveProperty('types');
      expect(data).toHaveProperty('relations');
    });

    it('should count entities correctly', async () => {
      const response = await app.request('/v1/graph/stats', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.total_entities).toBe(4); // Alice, Bob, Charlie, David
    });

    it('should count edges correctly', async () => {
      const response = await app.request('/v1/graph/stats', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.total_edges).toBe(2);
    });

    it('should break down entity types', async () => {
      const response = await app.request('/v1/graph/stats', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.types).toHaveProperty('person', 4); // Alice, Bob, Charlie, David
    });

    it('should break down edge types', async () => {
      const response = await app.request('/v1/graph/stats', {
        method: "GET",
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.relations).toHaveProperty('FRIEND_OF', 1);
      expect(data.relations).toHaveProperty('COLLEAGUE_OF', 1);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/graph/stats', { method: "GET" });

      expect(response.status).toBe(401);
      const data = await response.json();
    });
  });
});
