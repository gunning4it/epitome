/**
 * Test Database Helpers
 *
 * Utilities for managing test database lifecycle:
 * - Create/drop user schemas
 * - Test data factories
 * - Schema isolation verification
 */

import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface TestUser {
  userId: string;
  schemaName: string;
  email: string;
  apiKey: string;
}

/**
 * Create a fresh test user with isolated schema
 */
export async function createTestUser(embeddingDim: number = 1536): Promise<TestUser> {
  const userId = randomUUID();
  const schemaName = `user_${userId.replace(/-/g, '')}`;
  const email = `test_${userId}@example.com`;
  const apiKey = `test_key_${randomUUID()}`;

  // Ensure api_keys.tier column exists (may be missing in older test databases)
  await db.execute(sql.raw(`
    ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'free'
  `));

  // Create user in public.users table
  await db.execute(sql`
    INSERT INTO public.users (id, email, schema_name, created_at)
    VALUES (${userId}, ${email}, ${schemaName}, NOW())
  `);

  // Create API key in public.api_keys table
  const keyHash = apiKey; // In tests, we store plain key for simplicity
  await db.execute(sql`
    INSERT INTO public.api_keys (user_id, key_hash, prefix, scopes, created_at)
    VALUES (${userId}, ${keyHash}, ${'test_'}, '["read", "write"]'::jsonb, NOW())
  `);

  // Create user schema
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`));

  // Create profile table (matching init.sql schema)
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.profile (
      id SERIAL PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      changed_by VARCHAR(100),
      changed_fields JSONB,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _meta_id INTEGER
    );
    CREATE UNIQUE INDEX idx_profile_version_${schemaName.replace('user_', '')} ON ${schemaName}.profile(version);
    CREATE INDEX idx_profile_latest_${schemaName.replace('user_', '')} ON ${schemaName}.profile(version DESC)
  `));

  // Insert default profile
  await db.execute(sql.raw(`
    INSERT INTO ${schemaName}.profile (data, version)
    VALUES ('{}'::jsonb, 1)
  `));

  // Create tables table
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.tables (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      table_name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      icon TEXT,
      description TEXT,
      inferred_schema JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  // Create vectors table with pgvector (matching init.sql schema)
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.vectors (
      id SERIAL PRIMARY KEY,
      collection VARCHAR(100) NOT NULL,
      text TEXT NOT NULL,
      embedding vector(${embeddingDim}) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted_at TIMESTAMPTZ,
      _meta_id INTEGER
    );
    CREATE INDEX idx_vectors_collection_${schemaName.replace('user_', '')} ON ${schemaName}.vectors(collection)
      WHERE _deleted_at IS NULL
  `));

  // Create entities table (matching init.sql schema)
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.entities (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      name VARCHAR(500) NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
      mention_count INTEGER NOT NULL DEFAULT 1 CHECK (mention_count > 0),
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted_at TIMESTAMPTZ
    );
    CREATE INDEX idx_entities_type_${schemaName.replace('user_', '')} ON ${schemaName}.entities(type) WHERE _deleted_at IS NULL;
    CREATE UNIQUE INDEX idx_entities_type_name_unique_${schemaName.replace('user_', '')} ON ${schemaName}.entities(type, lower(name)) WHERE _deleted_at IS NULL;
    CREATE INDEX idx_entities_confidence_${schemaName.replace('user_', '')} ON ${schemaName}.entities(confidence DESC) WHERE _deleted_at IS NULL
  `));

  // Create edges table (matching init.sql schema)
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.edges (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES ${schemaName}.entities(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES ${schemaName}.entities(id) ON DELETE CASCADE,
      relation VARCHAR(100) NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 10),
      confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
      evidence JSONB NOT NULL DEFAULT '[]',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      properties JSONB NOT NULL DEFAULT '{}',
      _deleted_at TIMESTAMPTZ
    );
    CREATE INDEX idx_edges_source_${schemaName.replace('user_', '')} ON ${schemaName}.edges(source_id);
    CREATE INDEX idx_edges_target_${schemaName.replace('user_', '')} ON ${schemaName}.edges(target_id);
    CREATE INDEX idx_edges_relation_${schemaName.replace('user_', '')} ON ${schemaName}.edges(relation);
    CREATE INDEX idx_edges_traverse_${schemaName.replace('user_', '')} ON ${schemaName}.edges(source_id, relation, target_id);
    CREATE UNIQUE INDEX idx_edges_unique_rel_${schemaName.replace('user_', '')} ON ${schemaName}.edges(source_id, target_id, relation)
  `));

  // Create memory_meta table (matching service expectations)
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.memory_meta (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('table','table_row','vector','profile','entity','edge')),
      source_ref VARCHAR(200) NOT NULL,
      origin VARCHAR(20) NOT NULL CHECK (origin IN ('user_stated','user_typed','ai_stated','ai_inferred','ai_pattern','imported','system')),
      agent_source VARCHAR(100),
      confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('unvetted','active','trusted','review','decayed','rejected')),
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TIMESTAMPTZ,
      last_reinforced TIMESTAMPTZ,
      contradictions JSONB NOT NULL DEFAULT '[]',
      promote_history JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_memory_meta_source_ref_${schemaName.replace('user_', '')} ON ${schemaName}.memory_meta(source_ref);
    CREATE INDEX idx_memory_meta_status_${schemaName.replace('user_', '')} ON ${schemaName}.memory_meta(status) WHERE status != 'rejected'
  `));

  // Create _table_registry (used by table service for auto-create/auto-extend)
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}._table_registry (
      table_name VARCHAR(63) PRIMARY KEY,
      description TEXT,
      columns JSONB NOT NULL DEFAULT '[]',
      record_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  // Create _vector_collections (used by vector service)
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}._vector_collections (
      collection VARCHAR(100) PRIMARY KEY,
      description TEXT,
      embedding_dim INTEGER NOT NULL DEFAULT ${embeddingDim},
      entry_count INTEGER NOT NULL DEFAULT 0,
      record_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  // Create audit_log table
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  // Create consent_rules table for agent permissions
  await db.execute(sql.raw(`
    CREATE TABLE ${schemaName}.consent_rules (
      id SERIAL PRIMARY KEY,
      agent_id VARCHAR(100) NOT NULL,
      resource VARCHAR(200) NOT NULL,
      permission VARCHAR(10) NOT NULL CHECK (permission IN ('read', 'write', 'none')),
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      UNIQUE (agent_id, resource)
    );

    CREATE INDEX idx_consent_active ON ${schemaName}.consent_rules(agent_id, resource)
      WHERE revoked_at IS NULL;
  `));

  return { userId, schemaName, email, apiKey };
}

/**
 * Cleanup test user and drop schema
 */
export async function cleanupTestUser(userId: string): Promise<void> {
  const schemaName = `user_${userId.replace(/-/g, '')}`;

  // Drop schema cascade
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`));

  // Delete API keys (cascade will handle sessions, etc.)
  await db.execute(sql`DELETE FROM public.api_keys WHERE user_id = ${userId}`);

  // Delete user from public.users
  await db.execute(sql`DELETE FROM public.users WHERE id = ${userId}`);
}

/**
 * Verify schema isolation - ensure queries can't cross user boundaries
 */
export async function verifySchemaIsolation(
  user1: TestUser,
  user2: TestUser
): Promise<boolean> {
  // Set search_path to user1's schema
  await db.execute(sql.raw(`SET search_path TO ${user1.schemaName}`));

  // Insert data into user1's profile
  await db.execute(sql.raw(`
    UPDATE ${user1.schemaName}.profile
    SET profile_data = '{"name": "User 1"}'::jsonb
  `));

  // Set search_path to user2's schema
  await db.execute(sql.raw(`SET search_path TO ${user2.schemaName}`));

  // Try to read from user2's profile
  const result = await db.execute(sql.raw(`
    SELECT profile_data FROM profile LIMIT 1
  `));

  // user2's profile should NOT have user1's data
  const data = (result.rows[0] as any)?.profile_data;
  return JSON.stringify(data) !== JSON.stringify({ name: 'User 1' });
}

/**
 * Test data factories
 */
export const factories = {
  profile: {
    basic: () => ({
      name: 'Test User',
      timezone: 'America/New_York',
      preferences: { dietary: ['vegetarian'], allergies: ['peanuts'] },
    }),
    withFamily: () => ({
      name: 'Test User',
      timezone: 'America/New_York',
      family: [{ name: 'Alex', relation: 'partner' }],
    }),
  },

  memory: {
    userStated: (statement: string) => ({
      fact_statement: statement,
      confidence: 0.8,
      state: 'ACTIVE',
      source_type: 'USER_STATED',
      last_mentioned_at: new Date(),
    }),
    aiInferred: (statement: string) => ({
      fact_statement: statement,
      confidence: 0.4,
      state: 'PENDING_VERIFICATION',
      source_type: 'AI_INFERRED',
    }),
    contradiction: (statement: string, conf: number) => ({
      fact_statement: statement,
      confidence: conf,
      state: 'REVIEW',
      source_type: 'USER_STATED',
    }),
  },

  entity: {
    person: (name: string) => ({
      entity_type: 'Person',
      canonical_name: name,
      aliases: [],
      mention_count: 1,
      metadata: {},
    }),
    location: (name: string) => ({
      entity_type: 'Location',
      canonical_name: name,
      aliases: [],
      mention_count: 1,
      metadata: {},
    }),
  },

  edge: {
    relationship: (fromId: string, toId: string, type: string) => ({
      from_entity_id: fromId,
      to_entity_id: toId,
      edge_type: type,
      weight: 1.0,
      metadata: {},
    }),
  },

  vector: {
    embedding: (collection: string, content: string, dim: number = 1536) => ({
      collection,
      content,
      embedding: Array(dim).fill(0).map(() => Math.random()),
      metadata: {},
    }),
  },
};
