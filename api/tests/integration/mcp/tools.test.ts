/**
 * Integration Tests - MCP Tools
 *
 * Tests all 9 MCP tools by calling them directly:
 * - get_user_context
 * - update_profile
 * - list_tables
 * - query_table
 * - add_record
 * - search_memory
 * - save_memory
 * - query_graph
 * - review_memories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { grantConsent, revokeAllAgentConsent } from '@/services/consent.service';

// Import MCP tools directly
import { getUserContext } from '@/mcp/tools/getUserContext';
import { updateProfile } from '@/mcp/tools/updateProfile';
import { listTables } from '@/mcp/tools/listTables';
import { queryTable } from '@/mcp/tools/queryTable';
import { addRecord } from '@/mcp/tools/addRecord';
import { searchMemory } from '@/mcp/tools/searchMemory';
import { saveMemory } from '@/mcp/tools/saveMemory';
import { queryGraph } from '@/mcp/tools/queryGraph';
import { reviewMemories } from '@/mcp/tools/reviewMemories';
import type { McpContext } from '@/mcp/server';

// Check if OpenAI API key is available for embedding-dependent tests
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

describe('MCP Tools Integration Tests', () => {
  let testUser: TestUser;
  let mcpContext: McpContext;

  beforeEach(async () => {
    testUser = await createTestUser();
    mcpContext = {
      userId: testUser.userId,
      agentId: 'test-agent',
      tier: 'pro',
    };

    // Grant broad consent for test agent using the consent service
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'profile',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'tables',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'tables/*',
      permission: 'write',
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
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'graph',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'graph/*',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'memory',
      permission: 'write',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('get_user_context', () => {
    beforeEach(async () => {
      // Setup test profile data
      await db.execute(sql.raw(`
        UPDATE ${testUser.schemaName}.profile
        SET data = '{"name": "Test User", "timezone": "America/New_York"}'::jsonb
        WHERE version = 1
      `));

      // Add entities (using correct column names: type, name)
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name, mention_count, confidence)
        VALUES
        ('person', 'Alice', 5, 0.8),
        ('person', 'Bob', 3, 0.6)
      `));

      // Add table registry entry
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}._table_registry (table_name, description)
        VALUES ('workouts', 'Exercise tracking')
      `));
    });

    it('should return user context with profile', async () => {
      const result = await getUserContext({}, mcpContext);

      expect(result).toHaveProperty('profile');
      expect(result).toHaveProperty('tables');
      expect(result).toHaveProperty('collections');
      expect(result).toHaveProperty('topEntities');
      expect(result).toHaveProperty('recentMemories');
    });

    it('should include profile data', async () => {
      const result = await getUserContext({}, mcpContext);

      expect(result.profile).toBeDefined();
      expect(result.profile!.name).toBe('Test User');
      expect(result.profile!.timezone).toBe('America/New_York');
    });

    it('should include table inventory', async () => {
      const result = await getUserContext({}, mcpContext);

      expect(result.tables).toBeInstanceOf(Array);
      // listTables reads from _table_registry
      expect(result.tables.some((t: any) => t.name === 'workouts')).toBe(true);
    });

    it('should include top entities by composite score', async () => {
      const result = await getUserContext({}, mcpContext);

      expect(result.topEntities).toBeInstanceOf(Array);
      expect(result.topEntities.length).toBeGreaterThan(0);
      // Alice should rank higher than Bob (higher confidence and more mentions)
      const aliceIndex = result.topEntities.findIndex((e: any) => e.name === 'Alice');
      const bobIndex = result.topEntities.findIndex((e: any) => e.name === 'Bob');
      if (aliceIndex >= 0 && bobIndex >= 0) {
        expect(aliceIndex).toBeLessThan(bobIndex);
      }
    });

    it('should support optional topic parameter', async () => {
      const result = await getUserContext({ topic: 'food preferences' }, mcpContext);

      expect(result).toHaveProperty('profile');
      // Topic affects ranking but result structure is the same
    });

    it('should throw error without consent', async () => {
      // Revoke consent
      await revokeAllAgentConsent(testUser.userId, 'test-agent');

      await expect(getUserContext({}, mcpContext)).rejects.toThrow(/CONSENT_DENIED/);
    });
  });

  describe('update_profile', () => {
    it('should update profile with new data', async () => {
      const result = await updateProfile(
        {
          data: { name: 'Updated Name', timezone: 'America/Los_Angeles' },
          reason: 'User mentioned new timezone',
        },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.profile).toBeDefined();
      expect(result.profile.data.name).toBe('Updated Name');
      expect(result.profile.data.timezone).toBe('America/Los_Angeles');
      expect(result.profile.version).toBe(2);
    });

    it('should deep merge nested objects', async () => {
      // First update
      await updateProfile(
        {
          data: { preferences: { dietary: ['vegetarian'] } },
        },
        mcpContext
      );

      // Second update
      const result = await updateProfile(
        {
          data: { preferences: { allergies: ['peanuts'] } },
        },
        mcpContext
      );

      expect(result.profile.data.preferences).toEqual({
        dietary: ['vegetarian'],
        allergies: ['peanuts'],
      });
    });

    it('should support reaffirmed nested values while adding a new nested field', async () => {
      await updateProfile(
        {
          data: {
            living_situation: {
              status: 'temporarily living with Moo Moo (Lauren)',
              plan: 'looking to move out and find own place',
            },
          },
        },
        mcpContext
      );

      const result = await updateProfile(
        {
          data: {
            living_situation: {
              status: 'temporarily living with Moo Moo (Lauren)',
              plan: 'looking to move out and find own place',
              preferred_location: 'Newport Beach / Corona Del Mar area',
            },
          },
        },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.profile.data.living_situation).toEqual({
        status: 'temporarily living with Moo Moo (Lauren)',
        plan: 'looking to move out and find own place',
        preferred_location: 'Newport Beach / Corona Del Mar area',
      });
      expect(result.profile.changedFields).toContain('living_situation.preferred_location');
    });

    it('should handle low-confidence contradictions for MCP profile updates', async () => {
      await updateProfile(
        {
          data: {
            living_situation: {
              status: 'temporarily living with Moo Moo (Lauren)',
            },
          },
        },
        mcpContext
      );

      const result = await updateProfile(
        {
          data: {
            living_situation: {
              status: 'temporarily living with Moo Moo (Lauren) in Riverside',
            },
          },
        },
        mcpContext
      );

      expect(result.success).toBe(true);

      const contradictionRows = await db.execute(sql.raw(`
        SELECT contradictions
        FROM ${testUser.schemaName}.memory_meta
        WHERE source_type = 'profile'
        ORDER BY created_at ASC
        LIMIT 1
      `));
      const contradictions = ((contradictionRows[0] as any)?.contradictions ?? []) as Array<{ field: string }>;
      expect(contradictions.length).toBeGreaterThan(0);
      expect(contradictions.some((entry) => entry.field === 'profile.living_situation.status')).toBe(
        true
      );
    });

    it('should track changed fields', async () => {
      const result = await updateProfile(
        {
          data: { name: 'New Name' },
        },
        mcpContext
      );

      expect(result.profile.changedFields).toBeDefined();
      expect(result.profile.changedFields).toContain('name');
    });

    it('should throw error without consent', async () => {
      await revokeAllAgentConsent(testUser.userId, 'test-agent');

      await expect(
        updateProfile({ data: { name: 'Test' } }, mcpContext)
      ).rejects.toThrow(/CONSENT_DENIED/);
    });
  });

  describe('list_tables', () => {
    beforeEach(async () => {
      // Create test tables in _table_registry
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}._table_registry
        (table_name, description)
        VALUES
        ('workouts', 'Exercise tracking'),
        ('meals', 'Food log')
      `));
    });

    it('should return all tables', async () => {
      const result = await listTables({}, mcpContext);

      expect(result.tables).toBeInstanceOf(Array);
      expect(result.tables.length).toBe(2);
    });

    it('should include table metadata', async () => {
      const result = await listTables({}, mcpContext);

      const workout = result.tables.find((t: any) => t.name === 'workouts');
      expect(workout).toBeDefined();
      expect(workout!.description).toBe('Exercise tracking');
    });

    it('should return empty array when no tables exist', async () => {
      await db.execute(sql.raw(`
        DELETE FROM ${testUser.schemaName}._table_registry
      `));

      const result = await listTables({}, mcpContext);

      expect(result.tables).toEqual([]);
    });
  });

  describe('query_table', () => {
    beforeEach(async () => {
      // Create a real workouts table using addRecord (auto-creates)
      // We need to create the physical table first
      await db.execute(sql.raw(`
        CREATE TABLE ${testUser.schemaName}.workouts (
          id SERIAL PRIMARY KEY,
          exercise VARCHAR(500),
          reps INTEGER,
          weight INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          _deleted_at TIMESTAMPTZ,
          _meta_id INTEGER
        )
      `));

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.workouts (exercise, reps, weight)
        VALUES
        ('Bench Press', 10, 135),
        ('Squat', 8, 225),
        ('Deadlift', 5, 315)
      `));

      // Register in _table_registry
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}._table_registry (table_name, description, columns, record_count)
        VALUES ('workouts', 'Exercise tracking', '[]', 3)
      `));
    });

    it('should query table with SQL', async () => {
      const result = await queryTable(
        {
          tableName: 'workouts',
          sql: 'SELECT * FROM workouts ORDER BY weight DESC',
        },
        mcpContext
      );

      expect(result.records).toBeInstanceOf(Array);
      expect(result.records.length).toBe(3);
      expect(result.records[0].weight).toBe(315); // Deadlift first
    });

    it('should support WHERE clauses', async () => {
      const result = await queryTable(
        {
          tableName: 'workouts',
          sql: "SELECT * FROM workouts WHERE exercise = 'Squat'",
        },
        mcpContext
      );

      expect(result.records.length).toBe(1);
      expect(result.records[0].exercise).toBe('Squat');
    });

    it('should respect limit', async () => {
      const result = await queryTable(
        {
          tableName: 'workouts',
          sql: 'SELECT * FROM workouts',
          limit: 2,
        },
        mcpContext
      );

      expect(result.records.length).toBeLessThanOrEqual(2);
    });

    it('should block DDL statements', async () => {
      await expect(
        queryTable(
          {
            tableName: 'workouts',
            sql: 'DROP TABLE workouts',
          },
          mcpContext
        )
      ).rejects.toThrow();
    });

    it('should block DML statements', async () => {
      await expect(
        queryTable(
          {
            tableName: 'workouts',
            sql: "DELETE FROM workouts WHERE exercise = 'Squat'",
          },
          mcpContext
        )
      ).rejects.toThrow();
    });
  });

  describe('add_record', () => {
    it('should create table and add first record', async () => {
      const result = await addRecord(
        {
          tableName: 'meals',
          data: {
            food: 'Pizza',
            calories: 800,
            date: '2026-02-12',
          },
        },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.recordId).toBeDefined();
    });

    it('should add record to existing table', async () => {
      // Create table first
      await addRecord(
        {
          tableName: 'workouts',
          data: { exercise: 'Bench Press', reps: 10 },
        },
        mcpContext
      );

      // Add another record
      const result = await addRecord(
        {
          tableName: 'workouts',
          data: { exercise: 'Squat', reps: 8 },
        },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.table).toBe('workouts');
    });

    it('should handle async entity extraction without blocking', async () => {
      const result = await addRecord(
        {
          tableName: 'meetings',
          data: {
            title: 'Coffee with Alice',
            date: '2026-02-12',
          },
        },
        mcpContext
      );

      expect(result.success).toBe(true);
      // Entity extraction runs async, so we can't immediately verify entities
      // Just verify the record was created successfully
    });
  });

  describe('search_memory', () => {
    // search_memory calls searchVectors which generates embeddings via OpenAI
    // These tests require OPENAI_API_KEY

    it.skipIf(!hasOpenAIKey)('should search memories by text query', async () => {
      // First save a memory (which also needs OpenAI for embedding generation)
      await saveMemory(
        {
          collection: 'memories',
          text: 'I love pizza and pasta',
          metadata: { source: 'conversation' },
        },
        mcpContext
      );

      const result = await searchMemory(
        {
          query: 'italian food preferences',
          collection: 'memories',
          limit: 3,
        },
        mcpContext
      );

      expect(result.results).toBeInstanceOf(Array);
      expect(result.resultCount).toBeGreaterThanOrEqual(0);
    });

    it.skipIf(!hasOpenAIKey)('should include similarity scores', async () => {
      await saveMemory(
        {
          collection: 'memories',
          text: 'I enjoy running every morning',
        },
        mcpContext
      );

      const result = await searchMemory(
        {
          query: 'exercise habits',
          collection: 'memories',
          limit: 3,
        },
        mcpContext
      );

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty('similarity');
        expect(typeof result.results[0].similarity).toBe('number');
      }
    });

    it.skipIf(!hasOpenAIKey)('should filter by collection', async () => {
      // Add to different collections
      await saveMemory(
        { collection: 'memories', text: 'I love pizza' },
        mcpContext
      );
      await saveMemory(
        { collection: 'journal', text: 'Today was great' },
        mcpContext
      );

      const result = await searchMemory(
        {
          query: 'food',
          collection: 'memories',
          limit: 10,
        },
        mcpContext
      );

      // All results should be from the 'memories' collection
      if (result.results.length > 0) {
        // searchMemory doesn't return collection in results, but it only queries the specified collection
        expect(result.collection).toBe('memories');
      }
    });
  });

  describe('save_memory', () => {
    // save_memory calls addVector which generates embeddings via OpenAI
    it.skipIf(!hasOpenAIKey)('should save new memory', async () => {
      const result = await saveMemory(
        {
          text: 'I am allergic to peanuts',
          collection: 'memories',
          metadata: { source: 'conversation' },
        },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.vectorId).toBeDefined();
      expect(result.collection).toBe('memories');
    });

    it.skipIf(!hasOpenAIKey)('should support custom metadata', async () => {
      const result = await saveMemory(
        {
          text: 'Test memory',
          collection: 'memories',
          metadata: { timestamp: '2026-02-12T00:00:00Z', agent: 'claude' },
        },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.vectorId).toBeDefined();
    });
  });

  describe('query_graph', () => {
    let aliceId: number;
    let bobId: number;

    beforeEach(async () => {
      // Create test entities (using correct column names: type, name)
      const aliceResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name, confidence, mention_count)
        VALUES ('person', 'Alice', 0.8, 5)
        RETURNING id
      `));
      aliceId = (aliceResult as any)[0].id;

      const bobResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name, confidence, mention_count)
        VALUES ('person', 'Bob', 0.7, 3)
        RETURNING id
      `));
      bobId = (bobResult as any)[0].id;

      // Create edge (using correct column names: source_id, target_id, relation)
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight, confidence)
        VALUES (${aliceId}, ${bobId}, 'likes', 1.0, 0.8)
      `));
    });

    it('should perform traverse query', async () => {
      const result = await queryGraph(
        {
          queryType: 'traverse',
          entityId: aliceId,
          maxHops: 2,
        },
        mcpContext
      );

      expect(result.queryType).toBe('traverse');
      expect(result.result).toBeDefined();
      expect(result.result).toBeInstanceOf(Array);
      // Should find Alice and Bob (directly connected)
      expect(result.result.length).toBeGreaterThan(0);
    });

    it('should require entityId for traverse queries', async () => {
      await expect(
        queryGraph(
          {
            queryType: 'traverse',
            // Missing entityId
          },
          mcpContext
        )
      ).rejects.toThrow(/INVALID_ARGS/);
    });

    it('should support pattern queries', async () => {
      const pizzaResult = await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name, confidence, mention_count)
        VALUES ('food', 'Pizza', 0.9, 10)
        RETURNING id
      `));
      const pizzaId = (pizzaResult as any)[0].id;

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.edges
        (source_id, target_id, relation, weight, confidence)
        VALUES (${aliceId}, ${pizzaId}, 'likes', 2.0, 0.9)
      `));

      const result = await queryGraph(
        {
          queryType: 'pattern',
          pattern: {
            entityType: 'food',
            relation: 'likes',
            targetType: '*',
          },
        },
        mcpContext
      );

      expect(result.queryType).toBe('pattern');
      expect(result.result).toBeDefined();
    });

    it('should require pattern for pattern queries', async () => {
      await expect(
        queryGraph(
          {
            queryType: 'pattern',
            // Missing pattern
          },
          mcpContext
        )
      ).rejects.toThrow(/INVALID_ARGS/);
    });

    it('should reject invalid queryType', async () => {
      await expect(
        queryGraph(
          {
            queryType: 'invalid' as any,
          },
          mcpContext
        )
      ).rejects.toThrow(/INVALID_ARGS/);
    });
  });

  describe('review_memories', () => {
    beforeEach(async () => {
      // Create memory_meta entries with 'review' status
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.memory_meta
        (source_type, source_ref, origin, confidence, status)
        VALUES
        ('vector', 'memories:1', 'user_stated', 0.75, 'review'),
        ('vector', 'memories:2', 'user_stated', 0.72, 'review')
      `));
    });

    it('should return memories pending review', async () => {
      const result = await reviewMemories({ action: 'list' }, mcpContext);

      expect(result.contradictions).toBeInstanceOf(Array);
      expect(result.contradictionCount).toBe(2);
    });

    it('should include confidence scores', async () => {
      const result = await reviewMemories({ action: 'list' }, mcpContext);

      if (result.contradictions.length > 0) {
        expect(result.contradictions[0]).toHaveProperty('confidence');
        expect(typeof result.contradictions[0].confidence).toBe('number');
      }
    });

    it('should return empty array when no reviews pending', async () => {
      await db.execute(sql.raw(`
        DELETE FROM ${testUser.schemaName}.memory_meta
        WHERE status = 'review'
      `));

      const result = await reviewMemories({ action: 'list' }, mcpContext);

      expect(result.contradictions).toEqual([]);
      expect(result.contradictionCount).toBe(0);
    });

    it('should resolve a contradiction with confirm', async () => {
      // Get the review items to find metaId
      const reviews = await reviewMemories({ action: 'list' }, mcpContext);
      expect(reviews.contradictions.length).toBeGreaterThan(0);
      const metaId = reviews.contradictions[0].id;

      const result = await reviewMemories(
        { action: 'resolve', metaId, resolution: 'confirm' },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.metaId).toBe(metaId);
      expect(result.resolution).toBe('confirm');
    });

    it('should resolve a contradiction with reject', async () => {
      const reviews = await reviewMemories({ action: 'list' }, mcpContext);
      const metaId = reviews.contradictions[0].id;

      const result = await reviewMemories(
        { action: 'resolve', metaId, resolution: 'reject' },
        mcpContext
      );

      expect(result.success).toBe(true);
      expect(result.resolution).toBe('reject');
    });

    it('should require metaId and resolution for resolve action', async () => {
      await expect(
        reviewMemories({ action: 'resolve' }, mcpContext)
      ).rejects.toThrow(/INVALID_ARGS/);
    });
  });

  describe('Consent Enforcement', () => {
    it('should enforce consent on getUserContext', async () => {
      await revokeAllAgentConsent(testUser.userId, 'test-agent');
      await expect(getUserContext({}, mcpContext)).rejects.toThrow(/CONSENT_DENIED/);
    });

    it('should enforce consent on updateProfile', async () => {
      await revokeAllAgentConsent(testUser.userId, 'test-agent');
      await expect(
        updateProfile({ data: { name: 'Test' } }, mcpContext)
      ).rejects.toThrow(/CONSENT_DENIED/);
    });

    it('should enforce consent on listTables', async () => {
      await revokeAllAgentConsent(testUser.userId, 'test-agent');
      await expect(listTables({}, mcpContext)).rejects.toThrow(/CONSENT_DENIED/);
    });

    it('should enforce consent on queryTable', async () => {
      await revokeAllAgentConsent(testUser.userId, 'test-agent');
      await expect(
        queryTable({ tableName: 'test', sql: 'SELECT * FROM test' }, mcpContext)
      ).rejects.toThrow(/CONSENT_DENIED/);
    });

    it('should enforce consent on addRecord', async () => {
      await revokeAllAgentConsent(testUser.userId, 'test-agent');
      await expect(
        addRecord({ tableName: 'test', data: { field: 'value' } }, mcpContext)
      ).rejects.toThrow(/CONSENT_DENIED/);
    });

    it('should allow tool execution with proper consent', async () => {
      // Consent already granted in beforeEach
      const result = await getUserContext({}, mcpContext);
      expect(result).toHaveProperty('profile');
    });
  });

  describe('Audit Logging', () => {
    it('should log MCP tool invocations', async () => {
      await getUserContext({}, mcpContext);

      // Check audit log
      const result = await db.execute(sql.raw(`
        SELECT * FROM ${testUser.schemaName}.audit_log
        WHERE agent_id = 'test-agent'
        AND action = 'mcp_get_user_context'
      `));

      expect((result as any).length).toBeGreaterThan(0);
    });

    it('should include tool-specific details', async () => {
      await getUserContext({ topic: 'food' }, mcpContext);

      const result = await db.execute(sql.raw(`
        SELECT * FROM ${testUser.schemaName}.audit_log
        WHERE agent_id = 'test-agent'
        AND action = 'mcp_get_user_context'
        ORDER BY created_at DESC
        LIMIT 1
      `));

      const log = (result as any)[0];
      expect(log.details).toBeDefined();
      expect(log.details.topic).toBe('food');
    });

    it('should log updateProfile invocations', async () => {
      await updateProfile(
        { data: { name: 'Test' }, reason: 'test update' },
        mcpContext
      );

      const result = await db.execute(sql.raw(`
        SELECT * FROM ${testUser.schemaName}.audit_log
        WHERE agent_id = 'test-agent'
        AND action = 'mcp_update_profile'
        LIMIT 1
      `));

      expect((result as any).length).toBeGreaterThan(0);
    });

    it('should log addRecord invocations', async () => {
      await addRecord(
        { tableName: 'meals', data: { food: 'Pizza' } },
        mcpContext
      );

      const result = await db.execute(sql.raw(`
        SELECT * FROM ${testUser.schemaName}.audit_log
        WHERE agent_id = 'test-agent'
        AND action = 'mcp_add_record'
        LIMIT 1
      `));

      expect((result as any).length).toBeGreaterThan(0);
    });
  });
});
