/**
 * Deduplication Service Unit Tests
 *
 * Tests 4-stage deduplication pipeline: exact, fuzzy, alias, context
 * Target: 90%+ coverage
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  findDuplicateEntity,
  calculateSimilarity,
  mergeEntities,
  checkAndDeduplicateBeforeCreate,
  normalizeForComparison,
  type EntityCandidate,
} from '@/services/deduplication';
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

  // Create unique index
  await pgSql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_type_name
    ON entities(type, lower(name))
    WHERE _deleted_at IS NULL
  `);

  // Create pg_trgm extension
  await pgSql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  // Create trigram index
  await pgSql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_entities_name_trgm
    ON entities USING gin (name gin_trgm_ops)
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
});

beforeEach(async () => {
  await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
  await pgSql.unsafe(`TRUNCATE entities, edges, memory_meta CASCADE`);
});

afterAll(async () => {
  await pgSql.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await closeDatabase();
});

// =====================================================
// NORMALIZED MATCHING TESTS
// =====================================================

describe('normalizeForComparison', () => {
  it('should lowercase and strip trailing s', () => {
    expect(normalizeForComparison('Burritos')).toBe('burrito');
  });

  it('should strip trailing es for sibilants', () => {
    expect(normalizeForComparison('dishes')).toBe('dish');
    expect(normalizeForComparison('boxes')).toBe('box');
    expect(normalizeForComparison('churches')).toBe('church');
  });

  it('should convert ies to y', () => {
    expect(normalizeForComparison('berries')).toBe('berry');
    expect(normalizeForComparison('Calories')).toBe('calory');
  });

  it('should not strip ss (e.g., grass)', () => {
    expect(normalizeForComparison('grass')).toBe('grass');
  });

  it('should handle already singular words', () => {
    expect(normalizeForComparison('burrito')).toBe('burrito');
    expect(normalizeForComparison('Pizza')).toBe('pizza');
  });

  it('should trim whitespace', () => {
    expect(normalizeForComparison('  Tacos  ')).toBe('taco');
  });
});

describe('findDuplicateEntity - normalized matching (Stage 1.5)', () => {
  it('should match singular vs plural: "breakfast burrito" vs "breakfast burritos"', async () => {
    // Create entity with plural name
    const entity = await createEntity(TEST_USER_ID, {
      name: 'breakfast burritos',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    // Search for singular form
    const candidate: EntityCandidate = {
      type: 'food',
      name: 'breakfast burrito',
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).not.toBeNull();
    expect(duplicate?.entityId).toBe(entity.id);
  });

  it('should match plural vs singular: "tacos" vs "taco"', async () => {
    const entity = await createEntity(TEST_USER_ID, {
      name: 'taco',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    const candidate: EntityCandidate = {
      type: 'food',
      name: 'Tacos',
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).not.toBeNull();
    expect(duplicate?.entityId).toBe(entity.id);
  });

  it('should not match when normalized forms differ', async () => {
    await createEntity(TEST_USER_ID, {
      name: 'pizza',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    const candidate: EntityCandidate = {
      type: 'food',
      name: 'pasta',
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    // Should not match (exact, normalized, fuzzy, alias all fail)
    expect(duplicate).toBeNull();
  });
});

// =====================================================
// SIMILARITY CALCULATION TESTS
// =====================================================

describe('calculateSimilarity', () => {
  it('should return 1.0 for identical strings', async () => {
    const similarity = await calculateSimilarity(TEST_USER_ID, 'Pizza', 'Pizza');
    expect(similarity).toBe(1.0);
  });

  it('should return high similarity for close matches', async () => {
    const similarity = await calculateSimilarity(TEST_USER_ID, 'Pizza', 'pizza');
    expect(similarity).toBeGreaterThan(0.9);
  });

  it('should return medium similarity for typos', async () => {
    const similarity = await calculateSimilarity(TEST_USER_ID, 'Pizza', 'Piza');
    expect(similarity).toBeGreaterThan(0.5);
  });

  it('should return low similarity for different strings', async () => {
    const similarity = await calculateSimilarity(TEST_USER_ID, 'Pizza', 'Burger');
    expect(similarity).toBeLessThan(0.3);
  });
});

// =====================================================
// DUPLICATE DETECTION TESTS
// =====================================================

describe('findDuplicateEntity', () => {
  it('should find exact match (Stage 1)', async () => {
    // Create an entity
    const entity = await createEntity(TEST_USER_ID, {
      name: 'Pizza',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    // Search for exact match
    const candidate: EntityCandidate = {
      type: 'food',
      name: 'pizza', // Different case
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).not.toBeNull();
    expect(duplicate?.matchType).toBe('exact');
    expect(duplicate?.entityId).toBe(entity.id);
  });

  it('should find fuzzy match (Stage 2)', async () => {
    // Create an entity
    const entity = await createEntity(TEST_USER_ID, {
      name: 'Margherita Pizza',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    // Search for fuzzy match
    const candidate: EntityCandidate = {
      type: 'food',
      name: 'Margherita Piza', // Typo
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).not.toBeNull();
    expect(duplicate?.matchType).toBe('fuzzy');
    expect(duplicate?.entityId).toBe(entity.id);
    expect(duplicate?.similarity).toBeGreaterThan(0.6);
  });

  it('should find alias match (Stage 3)', async () => {
    // Create an entity with aliases
    const entity = await createEntity(TEST_USER_ID, {
      name: 'Sarah Chen',
      type: 'person',
      properties: {
        aliases: ['Sarah', 'Sarah C.'],
      },
      origin: 'user_stated',
    });

    // Search for alias
    const candidate: EntityCandidate = {
      type: 'person',
      name: 'Sarah',
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).not.toBeNull();
    expect(duplicate?.matchType).toBe('alias');
    expect(duplicate?.entityId).toBe(entity.id);
  });

  it('should return null for no match', async () => {
    const candidate: EntityCandidate = {
      type: 'food',
      name: 'Completely Unique Food Name 12345',
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).toBeNull();
  });

  it('should not match across different entity types', async () => {
    // Create an entity
    await createEntity(TEST_USER_ID, {
      name: 'Paris',
      type: 'place',
      properties: {},
      origin: 'user_stated',
    });

    // Search for same name but different type
    const candidate: EntityCandidate = {
      type: 'person', // Different type
      name: 'Paris',
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).toBeNull();
  });

  it('should ignore soft-deleted entities', async () => {
    // Create and delete an entity
    const entity = await createEntity(TEST_USER_ID, {
      name: 'Deleted Food',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    await pgSql.unsafe(`
      UPDATE entities
      SET _deleted_at = NOW()
      WHERE id = ${entity.id}
    `);

    // Search for deleted entity
    const candidate: EntityCandidate = {
      type: 'food',
      name: 'Deleted Food',
    };

    const duplicate = await findDuplicateEntity(TEST_USER_ID, candidate);

    expect(duplicate).toBeNull();
  });
});

// =====================================================
// ENTITY MERGING TESTS
// =====================================================

describe('mergeEntities', () => {
  it('should merge two entities and transfer edges', async () => {
    // Create user entity
    const user = await createEntity(TEST_USER_ID, {
      name: 'user',
      type: 'person',
      properties: {},
      origin: 'system',
    });

    // Create two food entities with different names so they get different IDs
    const pizza1 = await createEntity(TEST_USER_ID, {
      name: 'Pizza Margherita',
      type: 'food',
      properties: { calories: 700 },
      origin: 'user_stated',
    });

    const pizza2 = await createEntity(TEST_USER_ID, {
      name: 'Pizza Pepperoni',
      type: 'food',
      properties: { toppings: ['pepperoni'] },
      origin: 'user_stated',
    });

    // Create edges to both entities
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    await pgSql.unsafe(`
      INSERT INTO edges (source_id, target_id, relation, weight, confidence, evidence)
      VALUES (${user.id}, ${pizza1.id}, 'ate', 1.0, 0.9, '[]')
    `);

    await pgSql.unsafe(`
      INSERT INTO edges (source_id, target_id, relation, weight, confidence, evidence)
      VALUES (${user.id}, ${pizza2.id!}, 'ate', 1.0, 0.9, '[]')
    `);

    // Merge pizza2 into pizza1
    await mergeEntities(TEST_USER_ID, pizza2.id!, pizza1.id!);

    // Verify pizza2 is deleted
    const deletedEntity = await pgSql.unsafe<{ _deleted_at: Date | null }[]>(`
      SELECT _deleted_at FROM entities WHERE id = ${pizza2.id}
    `);

    expect(deletedEntity[0]._deleted_at).not.toBeNull();

    // Verify pizza1 has increased mention_count
    const targetEntity = await pgSql.unsafe<{ mention_count: number; properties: any }[]>(`
      SELECT mention_count, properties FROM entities WHERE id = ${pizza1.id}
    `);

    expect(targetEntity[0].mention_count).toBe(2);

    // Verify properties were merged
    expect(targetEntity[0].properties.calories).toBe(700);
    expect(targetEntity[0].properties.toppings).toEqual(['pepperoni']);

    // Verify aliases were added
    expect(targetEntity[0].properties.aliases).toContain('Pizza Pepperoni');

    // Verify edge was transferred
    const activeEdges = await pgSql.unsafe<{ target_id: number }[]>(`
      SELECT target_id FROM edges
      WHERE source_id = ${user.id}
        AND relation = 'ate'
        AND _deleted_at IS NULL
    `);

    expect(activeEdges).toHaveLength(1);
    expect(activeEdges[0].target_id).toBe(pizza1.id);
  });

  it('should throw error when merging entity with itself', async () => {
    const entity = await createEntity(TEST_USER_ID, {
      name: 'Test Entity',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    await expect(
      mergeEntities(TEST_USER_ID, entity.id!, entity.id!)
    ).rejects.toThrow('Cannot merge an entity with itself');
  });

  it('should handle duplicate edges by incrementing weight', async () => {
    // Create entities
    const user = await createEntity(TEST_USER_ID, {
      name: 'user',
      type: 'person',
      properties: {},
      origin: 'system',
    });

    const food1 = await createEntity(TEST_USER_ID, {
      name: 'Cheeseburger',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    const food2 = await createEntity(TEST_USER_ID, {
      name: 'Veggie Burger',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    const restaurant = await createEntity(TEST_USER_ID, {
      name: 'Five Guys',
      type: 'place',
      properties: {},
      origin: 'user_stated',
    });

    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Create edges from both foods to restaurant
    await pgSql.unsafe(`
      INSERT INTO edges (source_id, target_id, relation, weight, confidence, evidence)
      VALUES (${food1.id}, ${restaurant.id}, 'located_at', 1.0, 0.9, '[]')
    `);

    await pgSql.unsafe(`
      INSERT INTO edges (source_id, target_id, relation, weight, confidence, evidence)
      VALUES (${food2.id}, ${restaurant.id}, 'located_at', 1.5, 0.85, '[]')
    `);

    // Merge food2 into food1
    await mergeEntities(TEST_USER_ID, food2.id!, food1.id!);

    // Verify edge weight was incremented
    const edges = await pgSql.unsafe<{ weight: number; confidence: number }[]>(`
      SELECT weight, confidence
      FROM edges
      WHERE source_id = ${food1.id}
        AND target_id = ${restaurant.id}
        AND relation = 'located_at'
        AND _deleted_at IS NULL
    `);

    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(2.5); // 1.0 + 1.5
    expect(edges[0].confidence).toBe(0.9); // GREATEST(0.9, 0.85)
  });
});

// =====================================================
// INTEGRATION TESTS
// =====================================================

describe('checkAndDeduplicateBeforeCreate', () => {
  it('should return existing entity ID for exact match', async () => {
    const existing = await createEntity(TEST_USER_ID, {
      name: 'Sushi',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    const candidate: EntityCandidate = {
      type: 'food',
      name: 'sushi',
    };

    const duplicateId = await checkAndDeduplicateBeforeCreate(TEST_USER_ID, candidate);

    expect(duplicateId).toBe(existing.id);
  });

  it('should return existing entity ID for fuzzy match', async () => {
    const existing = await createEntity(TEST_USER_ID, {
      name: 'Chocolate Cake',
      type: 'food',
      properties: {},
      origin: 'user_stated',
    });

    const candidate: EntityCandidate = {
      type: 'food',
      name: 'Chocolate Cke', // Typo
    };

    const duplicateId = await checkAndDeduplicateBeforeCreate(TEST_USER_ID, candidate);

    expect(duplicateId).toBe(existing.id);
  });

  it('should return null for unique entity', async () => {
    const candidate: EntityCandidate = {
      type: 'food',
      name: 'Completely Unique Food XYZ',
    };

    const duplicateId = await checkAndDeduplicateBeforeCreate(TEST_USER_ID, candidate);

    expect(duplicateId).toBeNull();
  });
});
