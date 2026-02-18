/**
 * Thread Linking Service Unit Tests
 *
 * Tests temporal proximity, semantic similarity, and entity overlap linking
 * Target: 90%+ coverage
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  findTemporallyClose,
  findEntityOverlaps,
  linkRelatedRecords,
  getRecordThread,
  type RelatedRecord,
} from '@/services/threadLinking';
import { createEntity } from '@/services/graphService';
import { sql as pgSql, closeDatabase } from '@/db/client';

// Test user ID
const TEST_USER_ID = '12345678-1234-1234-1234-123456789012';
const TEST_SCHEMA = 'user_12345678123412341234123456789012';

// =====================================================
// SETUP & TEARDOWN
// =====================================================

beforeAll(async () => {
  // Create test user schema
  await pgSql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

  // Create memory_meta table
  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(20) NOT NULL,
      source_ref VARCHAR(200) NOT NULL,
      origin VARCHAR(20) NOT NULL,
      agent_source VARCHAR(100),
      confidence REAL NOT NULL DEFAULT 0.5,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TIMESTAMPTZ,
      last_reinforced TIMESTAMPTZ,
      contradictions JSONB NOT NULL DEFAULT '[]',
      promote_history JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create entities table
  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS entities (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      name VARCHAR(500) NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.5,
      mention_count INTEGER NOT NULL DEFAULT 1,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted_at TIMESTAMPTZ
    )
  `);

  // Create edges table
  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS edges (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES entities(id),
      target_id INTEGER NOT NULL REFERENCES entities(id),
      relation VARCHAR(100) NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence JSONB NOT NULL DEFAULT '[]',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      properties JSONB NOT NULL DEFAULT '{}',
      _deleted_at TIMESTAMPTZ
    )
  `);

  // Create table registry
  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS _table_registry (
      table_name VARCHAR(100) PRIMARY KEY,
      description TEXT,
      columns JSONB NOT NULL,
      record_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create sample tables for testing
  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS meals (
      id SERIAL PRIMARY KEY,
      food VARCHAR(500),
      calories INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted_at TIMESTAMPTZ,
      _meta_id INTEGER
    )
  `);

  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS workouts (
      id SERIAL PRIMARY KEY,
      exercise VARCHAR(500),
      duration INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted_at TIMESTAMPTZ,
      _meta_id INTEGER
    )
  `);

  // Register tables
  await pgSql.unsafe(`
    INSERT INTO _table_registry (table_name, columns)
    VALUES
      ('meals', '[]'),
      ('workouts', '[]')
    ON CONFLICT (table_name) DO NOTHING
  `);

  // Create pgvector extension
  await pgSql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

  // Create vectors table
  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS vectors (
      id SERIAL PRIMARY KEY,
      collection VARCHAR(100) NOT NULL,
      text TEXT NOT NULL,
      embedding vector(1536) NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted_at TIMESTAMPTZ,
      _meta_id INTEGER
    )
  `);

  // Create vector collections table
  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS _vector_collections (
      collection VARCHAR(100) PRIMARY KEY,
      description TEXT,
      entry_count INTEGER DEFAULT 0,
      embedding_dim INTEGER NOT NULL DEFAULT 1536,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
});

beforeEach(async () => {
  await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
  await pgSql.unsafe(`TRUNCATE entities, edges, memory_meta RESTART IDENTITY CASCADE`);
  await pgSql.unsafe(`TRUNCATE meals, workouts RESTART IDENTITY CASCADE`);
  await pgSql.unsafe(`TRUNCATE vectors CASCADE`);
});

afterAll(async () => {
  await pgSql.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await closeDatabase();
});

// =====================================================
// TEMPORAL PROXIMITY TESTS
// =====================================================

describe('findTemporallyClose', () => {
  it('should find records within 2-hour window', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    const baseTime = new Date('2024-01-15T12:00:00Z');

    // Create records at different times
    const record1 = await pgSql.unsafe<{ id: number }[]>(
      `INSERT INTO meals (food, calories, created_at)
       VALUES ('Breakfast', 400, $1)
       RETURNING id`,
      [baseTime.toISOString()]
    );

    await pgSql.unsafe(
      `INSERT INTO meals (food, calories, created_at)
       VALUES
         ('Snack', 200, $1),
         ('Lunch', 600, $2)`,
      [
        new Date(baseTime.getTime() + 60 * 60 * 1000).toISOString(),
        new Date(baseTime.getTime() + 90 * 60 * 1000).toISOString(),
      ]
    );

    // Outside 2-hour window
    await pgSql.unsafe(
      `INSERT INTO meals (food, calories, created_at)
       VALUES ('Dinner', 700, $1)`,
      [new Date(baseTime.getTime() + 5 * 60 * 60 * 1000).toISOString()]
    );

    const related = await findTemporallyClose(
      TEST_USER_ID,
      record1[0].id,
      'meals',
      2
    );

    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(2); // Snack and Lunch, not Dinner

    // Verify time deltas are within 2 hours (120 minutes)
    related.forEach((r) => {
      expect(r.timeDelta).toBeLessThanOrEqual(120);
    });
  });

  it('should find records across different tables', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    const baseTime = new Date('2024-01-15T12:00:00Z');

    const meal = await pgSql.unsafe<{ id: number }[]>(
      `INSERT INTO meals (food, calories, created_at)
       VALUES ('Lunch', 500, $1)
       RETURNING id`,
      [baseTime.toISOString()]
    );

    // Workout close in time
    await pgSql.unsafe(
      `INSERT INTO workouts (exercise, duration, created_at)
       VALUES ('Running', 30, $1)`,
      [new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString()]
    );

    const related = await findTemporallyClose(
      TEST_USER_ID,
      meal[0].id,
      'meals',
      2
    );

    expect(related.some((r) => r.tableName === 'workouts')).toBe(true);
  });

  it('should return empty array for isolated record', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    const record = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO meals (food, calories, created_at)
      VALUES ('Isolated Meal', 500, NOW())
      RETURNING id
    `);

    const related = await findTemporallyClose(
      TEST_USER_ID,
      record[0].id,
      'meals',
      2
    );

    expect(related).toEqual([]);
  });

  it('should exclude soft-deleted records', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    const baseTime = new Date('2024-01-15T12:00:00Z');

    const record1 = await pgSql.unsafe<{ id: number }[]>(
      `INSERT INTO meals (food, calories, created_at)
       VALUES ('Meal 1', 500, $1)
       RETURNING id`,
      [baseTime.toISOString()]
    );

    // Create and delete a record
    await pgSql.unsafe(
      `INSERT INTO meals (food, calories, created_at, _deleted_at)
       VALUES ('Deleted Meal', 600, $1, NOW())`,
      [new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString()]
    );

    const related = await findTemporallyClose(
      TEST_USER_ID,
      record1[0].id,
      'meals',
      2
    );

    expect(related.every((r) => r.recordId !== 2)).toBe(true);
  });
});

// =====================================================
// ENTITY OVERLAP TESTS
// =====================================================

describe('findEntityOverlaps', () => {
  it('should find records that share 2+ entities', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Create a user entity as edge source
    const user = await createEntity(TEST_USER_ID, {
      name: 'TestUser',
      type: 'person',
      properties: {},
      origin: 'system',
    });

    // Create shared entities
    const pizza = await createEntity(TEST_USER_ID, {
      name: 'Pizza',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    const restaurant = await createEntity(TEST_USER_ID, {
      name: 'Italian Place',
      type: 'place',
      properties: {},
      origin: 'user_stated',
    });

    // Create records
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    const meal1 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO meals (food, calories)
      VALUES ('Lunch', 600)
      RETURNING id
    `);

    const meal2 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO meals (food, calories)
      VALUES ('Dinner', 700)
      RETURNING id
    `);

    // Create edges linking both meals to pizza and restaurant
    await pgSql.unsafe(
      `INSERT INTO edges (source_id, target_id, relation, evidence)
       VALUES
         ($5, $6, 'ate', $1::jsonb),
         ($5, $7, 'visited', $2::jsonb),
         ($5, $6, 'ate', $3::jsonb),
         ($5, $7, 'visited', $4::jsonb)`,
      [
        JSON.stringify([{ table: 'meals', row_id: meal1[0].id }]),
        JSON.stringify([{ table: 'meals', row_id: meal1[0].id }]),
        JSON.stringify([{ table: 'meals', row_id: meal2[0].id }]),
        JSON.stringify([{ table: 'meals', row_id: meal2[0].id }]),
        user.id,
        pizza.id,
        restaurant.id,
      ]
    );

    const overlaps = await findEntityOverlaps(
      TEST_USER_ID,
      meal1[0].id,
      'meals'
    );

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].recordId).toBe(meal2[0].id);
    expect(overlaps[0].sharedEntities).toBe(2);
  });

  it('should return empty array for record with no entities', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    const meal = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO meals (food, calories)
      VALUES ('Lonely Meal', 500)
      RETURNING id
    `);

    const overlaps = await findEntityOverlaps(
      TEST_USER_ID,
      meal[0].id,
      'meals'
    );

    expect(overlaps).toEqual([]);
  });

  it('should require at least 2 shared entities', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Create a user entity as edge source
    const user = await createEntity(TEST_USER_ID, {
      name: 'TestUser',
      type: 'person',
      properties: {},
      origin: 'system',
    });

    const pizza = await createEntity(TEST_USER_ID, {
      name: 'Pizza',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    const meal1 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO meals (food, calories)
      VALUES ('Lunch', 600)
      RETURNING id
    `);

    const meal2 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO meals (food, calories)
      VALUES ('Dinner', 700)
      RETURNING id
    `);

    // Only one shared entity
    await pgSql.unsafe(
      `INSERT INTO edges (source_id, target_id, relation, evidence)
       VALUES
         ($3, $4, 'ate', $1::jsonb),
         ($3, $4, 'ate', $2::jsonb)`,
      [
        JSON.stringify([{ table: 'meals', row_id: meal1[0].id }]),
        JSON.stringify([{ table: 'meals', row_id: meal2[0].id }]),
        user.id,
        pizza.id,
      ]
    );

    const overlaps = await findEntityOverlaps(
      TEST_USER_ID,
      meal1[0].id,
      'meals'
    );

    expect(overlaps).toEqual([]);
  });
});

// =====================================================
// INTEGRATION TESTS
// =====================================================

describe('linkRelatedRecords', () => {
  it('should create thread links for temporally close records', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    const baseTime = new Date('2024-01-15T12:00:00Z');

    const meal1 = await pgSql.unsafe<{ id: number }[]>(
      `INSERT INTO meals (food, calories, created_at)
       VALUES ('Lunch', 600, $1)
       RETURNING id`,
      [baseTime.toISOString()]
    );

    const meal2 = await pgSql.unsafe<{ id: number }[]>(
      `INSERT INTO meals (food, calories, created_at)
       VALUES ('Snack', 200, $1)
       RETURNING id`,
      [new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString()]
    );

    // Link records
    await linkRelatedRecords(TEST_USER_ID, meal1[0].id, 'meals');

    // Verify thread link was created
    const threadLinks = await pgSql.unsafe<{ relation: string; properties: any }[]>(`
      SELECT e.relation, e.properties
      FROM edges e
      JOIN entities source ON e.source_id = source.id
      JOIN entities target ON e.target_id = target.id
      WHERE e.relation = 'thread_next'
        AND e._deleted_at IS NULL
        AND source.type = 'event'
        AND target.type = 'event'
    `);

    expect(threadLinks.length).toBeGreaterThan(0);
    expect(threadLinks.some((l) => l.properties.link_type === 'temporal_proximity')).toBe(true);
  });

  it('should handle records with no related records gracefully', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    const meal = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO meals (food, calories, created_at)
      VALUES ('Isolated', 500, NOW())
      RETURNING id
    `);

    // Should not throw
    await expect(
      linkRelatedRecords(TEST_USER_ID, meal[0].id, 'meals')
    ).resolves.not.toThrow();
  });
});

describe('getRecordThread', () => {
  it('should traverse thread links to find related records', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Create entities representing records
    const event1 = await createEntity(TEST_USER_ID, {
      name: 'meals_1',
      type: 'event',
      properties: { table: 'meals', record_id: 1 },
      origin: 'system',
    });

    const event2 = await createEntity(TEST_USER_ID, {
      name: 'meals_2',
      type: 'event',
      properties: { table: 'meals', record_id: 2 },
      origin: 'system',
    });

    const event3 = await createEntity(TEST_USER_ID, {
      name: 'meals_3',
      type: 'event',
      properties: { table: 'meals', record_id: 3 },
      origin: 'system',
    });

    // Create thread links
    await pgSql.unsafe(`
      INSERT INTO edges (source_id, target_id, relation, properties)
      VALUES
        (${event1.id}, ${event2.id}, 'thread_next', '{"link_type": "temporal_proximity"}'),
        (${event2.id}, ${event3.id}, 'thread_next', '{"link_type": "semantic_similarity"}')
    `);

    // Get thread starting from event1
    const thread = await getRecordThread(TEST_USER_ID, 1, 'meals', 5);

    expect(thread.length).toBeGreaterThanOrEqual(2);
    expect(thread.some((r) => r.recordId === 2 && r.tableName === 'meals')).toBe(true);
    expect(thread.some((r) => r.recordId === 3 && r.tableName === 'meals')).toBe(true);
  });

  it('should return empty array for record with no thread', async () => {
    const thread = await getRecordThread(TEST_USER_ID, 999, 'meals', 5);

    expect(thread).toEqual([]);
  });

  it('should respect max depth limit', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Create a long chain of events
    const events = [];
    for (let i = 1; i <= 10; i++) {
      const event = await createEntity(TEST_USER_ID, {
        name: `meals_${i}`,
        type: 'event',
        properties: { table: 'meals', record_id: i },
        origin: 'system',
      });
      events.push(event);
    }

    // Link them in a chain
    for (let i = 0; i < events.length - 1; i++) {
      await pgSql.unsafe(`
        INSERT INTO edges (source_id, target_id, relation, properties)
        VALUES (${events[i].id}, ${events[i + 1].id}, 'thread_next', '{"link_type": "temporal_proximity"}')
      `);
    }

    // Get thread with depth limit of 3
    const thread = await getRecordThread(TEST_USER_ID, 1, 'meals', 3);

    expect(thread.length).toBeLessThanOrEqual(3);
  });
});
