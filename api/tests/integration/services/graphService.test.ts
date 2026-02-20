/**
 * GraphService Unit Tests
 *
 * Tests basic CRUD operations for entities and edges.
 * Target: 90%+ coverage
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  getEntityByName,
  createEdge,
  getEdge,
  updateEdge,
  deleteEdge,
  listEdges,
  getNeighbors,
  traverse,
  getPathBetween,
  queryPattern,
  getGraphStats,
  getEntityCentrality,
  getClusteringCoefficient,
  EntityType,
  EdgeRelation,
} from '@/services/graphService';
import { sql as pgSql, closeDatabase } from '@/db/client';

// Test user ID
const TEST_USER_ID = '12345678-1234-1234-1234-123456789012';
const TEST_SCHEMA = 'user_12345678123412341234123456789012';

// =====================================================
// SETUP & TEARDOWN
// =====================================================

beforeAll(async () => {
  // Create test user schema
  await pgSql`CREATE SCHEMA IF NOT EXISTS ${pgSql(TEST_SCHEMA)}`.execute();

  // Create tables in test schema
  await pgSql`SET search_path TO ${pgSql(TEST_SCHEMA)}, public`.execute();

  // Create memory_meta table
  await pgSql`
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
  `.execute();

  // Create entities table
  await pgSql`
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
  `.execute();

  // Create unique index for entity deduplication
  await pgSql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_type_name
    ON entities(type, lower(name))
    WHERE _deleted_at IS NULL
  `.execute();

  // Create pg_trgm extension for fuzzy search
  await pgSql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute();

  // Create trigram index on entity name
  await pgSql`
    CREATE INDEX IF NOT EXISTS idx_entities_name_trgm
    ON entities USING gin (name gin_trgm_ops)
  `.execute();

  // Create edges table
  await pgSql`
    CREATE TABLE IF NOT EXISTS edges (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      relation VARCHAR(100) NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence JSONB NOT NULL DEFAULT '[]',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      properties JSONB NOT NULL DEFAULT '{}',
      _deleted_at TIMESTAMPTZ
    )
  `.execute();

  // Create unique index for edge deduplication
  await pgSql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique_rel
    ON edges(source_id, target_id, relation)
  `.execute();

  // Create edge_quarantine table (for ontology-rejected edges)
  await pgSql`
    CREATE TABLE IF NOT EXISTS edge_quarantine (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(50) NOT NULL,
      target_type VARCHAR(50) NOT NULL,
      relation VARCHAR(100) NOT NULL,
      source_name VARCHAR(500),
      target_name VARCHAR(500),
      reason TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute();

  await pgSql`RESET search_path`.execute();
});

afterAll(async () => {
  // Drop test schema
  await pgSql`DROP SCHEMA IF EXISTS ${pgSql(TEST_SCHEMA)} CASCADE`.execute();
  await closeDatabase();
});

beforeEach(async () => {
  // Clean up test data before each test
  await pgSql`SET search_path TO ${pgSql(TEST_SCHEMA)}, public`.execute();
  await pgSql`TRUNCATE entities, edges, memory_meta RESTART IDENTITY CASCADE`.execute();
  await pgSql`RESET search_path`.execute();
});

// =====================================================
// ENTITY TESTS
// =====================================================

describe('Entity Operations', () => {
  describe('createEntity', () => {
    it('should create an entity with valid data', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
        properties: { relation: 'friend' },
        origin: 'user_stated',
      });

      expect(entity.id).toBeDefined();
      expect(entity.type).toBe('person');
      expect(entity.name).toBe('Alice');
      expect(entity.properties).toEqual({ relation: 'friend' });
      expect(entity.confidence).toBe(0.85); // user_stated origin (MemoryQualityService)
      expect(entity.meta).toBeDefined();
      expect(entity.meta?.status).toBe('trusted');
    });

    it('should create entity with default confidence', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'place',
        name: 'Bestia',
      });

      expect(entity.confidence).toBe(0.40); // default for ai_inferred (MemoryQualityService)
      expect(entity.meta?.confidence).toBe(0.40);
    });

    it('should return existing entity for duplicate (idempotent creation)', async () => {
      const existingEntity = await createEntity(TEST_USER_ID, {
        type: 'food',
        name: 'Pizza',
      });

      const duplicate = await createEntity(TEST_USER_ID, {
        type: 'food',
        name: 'pizza', // case-insensitive duplicate
      });

      expect(duplicate.id).toBe(existingEntity.id); // Should return the same entity
    });

    it('should allow same name for different types', async () => {
      const entity1 = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Jordan',
      });

      const entity2 = await createEntity(TEST_USER_ID, {
        type: 'place',
        name: 'Jordan', // Same name, different type
      });

      expect(entity1.id).not.toBe(entity2.id);
      expect(entity1.type).toBe('person');
      expect(entity2.type).toBe('place');
    });
  });

  describe('getEntity', () => {
    it('should retrieve entity by ID', async () => {
      const created = await createEntity(TEST_USER_ID, {
        type: 'topic',
        name: 'AI',
      });

      const fetched = await getEntity(TEST_USER_ID, created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.name).toBe('AI');
    });

    it('should return null for non-existent entity', async () => {
      const fetched = await getEntity(TEST_USER_ID, 99999);
      expect(fetched).toBeNull();
    });

    it('should not return soft-deleted entities by default', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });

      await deleteEntity(TEST_USER_ID, entity.id);

      const fetched = await getEntity(TEST_USER_ID, entity.id);
      expect(fetched).toBeNull();
    });

    it('should return soft-deleted entities when includeDeleted=true', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Charlie',
      });

      await deleteEntity(TEST_USER_ID, entity.id);

      const fetched = await getEntity(TEST_USER_ID, entity.id, true);
      expect(fetched).toBeDefined();
      expect(fetched?.deletedAt).toBeDefined();
    });
  });

  describe('updateEntity', () => {
    it('should update entity name', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Dave',
      });

      const updated = await updateEntity(TEST_USER_ID, entity.id, {
        name: 'David',
      });

      expect(updated.name).toBe('David');
    });

    it('should merge properties', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'place',
        name: 'Restaurant',
        properties: { cuisine: 'Italian', rating: 4 },
      });

      const updated = await updateEntity(TEST_USER_ID, entity.id, {
        properties: { rating: 5, priceRange: '$$$' },
      });

      expect(updated.properties).toEqual({
        cuisine: 'Italian',
        rating: 5,
        priceRange: '$$$',
      });
    });

    it('should update confidence', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'preference',
        name: 'Spicy food',
        confidence: 0.5,
      });

      const updated = await updateEntity(TEST_USER_ID, entity.id, {
        confidence: 0.9,
      });

      expect(updated.confidence).toBe(0.9);
    });

    it('should throw error for non-existent entity', async () => {
      await expect(
        updateEntity(TEST_USER_ID, 99999, { name: 'Test' })
      ).rejects.toThrow('NOT_FOUND');
    });

    it('should throw error for deleted entity', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Eve',
      });

      await deleteEntity(TEST_USER_ID, entity.id);

      await expect(
        updateEntity(TEST_USER_ID, entity.id, { name: 'Eva' })
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('deleteEntity', () => {
    it('should soft delete entity', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Frank',
      });

      await deleteEntity(TEST_USER_ID, entity.id);

      const fetched = await getEntity(TEST_USER_ID, entity.id);
      expect(fetched).toBeNull();

      // Should be retrievable with includeDeleted
      const deleted = await getEntity(TEST_USER_ID, entity.id, true);
      expect(deleted?.deletedAt).toBeDefined();
    });

    it('should update memory_meta to rejected', async () => {
      const entity = await createEntity(TEST_USER_ID, {
        type: 'activity',
        name: 'Running',
      });

      expect(entity.meta?.status).toBe('unvetted');

      await deleteEntity(TEST_USER_ID, entity.id);

      // Check memory_meta status
      await pgSql`SET search_path TO ${pgSql(TEST_SCHEMA)}, public`.execute();
      const [meta] = await pgSql`
        SELECT status FROM memory_meta WHERE id = ${entity.meta!.id}
      `.execute();
      await pgSql`RESET search_path`.execute();

      expect(meta.status).toBe('rejected');
    });

    it('should throw error for non-existent entity', async () => {
      await expect(deleteEntity(TEST_USER_ID, 99999)).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('listEntities', () => {
    it('should list all entities', async () => {
      await createEntity(TEST_USER_ID, { type: 'person', name: 'Alice' });
      await createEntity(TEST_USER_ID, { type: 'person', name: 'Bob' });
      await createEntity(TEST_USER_ID, { type: 'place', name: 'Cafe' });

      const entities = await listEntities(TEST_USER_ID);

      expect(entities.length).toBe(3);
    });

    it('should filter by type', async () => {
      await createEntity(TEST_USER_ID, { type: 'person', name: 'Alice' });
      await createEntity(TEST_USER_ID, { type: 'person', name: 'Bob' });
      await createEntity(TEST_USER_ID, { type: 'place', name: 'Cafe' });

      const people = await listEntities(TEST_USER_ID, { type: 'person' });

      expect(people.length).toBe(2);
      expect(people.every((e) => e.type === 'person')).toBe(true);
    });

    it('should filter by confidence range', async () => {
      await createEntity(TEST_USER_ID, {
        type: 'topic',
        name: 'Low',
        confidence: 0.3,
      });
      await createEntity(TEST_USER_ID, {
        type: 'topic',
        name: 'High',
        confidence: 0.9,
      });

      const highConfidence = await listEntities(TEST_USER_ID, {
        confidenceMin: 0.7,
      });

      expect(highConfidence.length).toBe(1);
      expect(highConfidence[0].name).toBe('High');
    });

    it('should paginate results', async () => {
      for (let i = 0; i < 10; i++) {
        await createEntity(TEST_USER_ID, {
          type: 'topic',
          name: `Topic ${i}`,
        });
      }

      const page1 = await listEntities(TEST_USER_ID, { limit: 5, offset: 0 });
      const page2 = await listEntities(TEST_USER_ID, { limit: 5, offset: 5 });

      expect(page1.length).toBe(5);
      expect(page2.length).toBe(5);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should order by confidence DESC, name ASC', async () => {
      await createEntity(TEST_USER_ID, {
        type: 'topic',
        name: 'Zebra',
        confidence: 0.5,
      });
      await createEntity(TEST_USER_ID, {
        type: 'topic',
        name: 'Apple',
        confidence: 0.9,
      });
      await createEntity(TEST_USER_ID, {
        type: 'topic',
        name: 'Banana',
        confidence: 0.9,
      });

      const entities = await listEntities(TEST_USER_ID);

      expect(entities[0].name).toBe('Apple'); // Higher confidence, alphabetically first
      expect(entities[1].name).toBe('Banana'); // Higher confidence, alphabetically second
      expect(entities[2].name).toBe('Zebra'); // Lower confidence
    });
  });

  describe('getEntityByName', () => {
    it('should find exact matches', async () => {
      await createEntity(TEST_USER_ID, { type: 'person', name: 'Alice' });

      const results = await getEntityByName(TEST_USER_ID, 'Alice');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Alice');
      expect(results[0].similarity).toBeGreaterThan(0.9);
    });

    it('should find fuzzy matches', async () => {
      await createEntity(TEST_USER_ID, { type: 'place', name: 'Bestia' });

      const results = await getEntityByName(TEST_USER_ID, 'Bestea'); // Typo

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Bestia');
    });

    it('should filter by type', async () => {
      await createEntity(TEST_USER_ID, { type: 'person', name: 'Jordan' });
      await createEntity(TEST_USER_ID, { type: 'place', name: 'Jordan' });

      const people = await getEntityByName(TEST_USER_ID, 'Jordan', 'person');

      expect(people.length).toBe(1);
      expect(people[0].type).toBe('person');
    });

    it('should order by similarity', async () => {
      await createEntity(TEST_USER_ID, { type: 'food', name: 'Pizza' });
      await createEntity(TEST_USER_ID, { type: 'food', name: 'Pita' });

      const results = await getEntityByName(TEST_USER_ID, 'Pizza');

      expect(results[0].name).toBe('Pizza'); // Exact match first
      expect(results[0].similarity).toBeGreaterThan(results[1]?.similarity ?? 0);
    });

    it('should respect similarity threshold', async () => {
      await createEntity(TEST_USER_ID, { type: 'topic', name: 'AI' });

      const results = await getEntityByName(TEST_USER_ID, 'Artificial Intelligence', undefined, 0.8);

      // Should not match due to high threshold
      expect(results.length).toBe(0);
    });
  });
});

// =====================================================
// EDGE TESTS
// =====================================================

describe('Edge Operations', () => {
  let aliceId: number;
  let bobId: number;
  let restaurantId: number;

  beforeEach(async () => {
    // Create test entities
    const alice = await createEntity(TEST_USER_ID, {
      type: 'person',
      name: 'Alice',
    });
    const bob = await createEntity(TEST_USER_ID, {
      type: 'person',
      name: 'Bob',
    });
    const restaurant = await createEntity(TEST_USER_ID, {
      type: 'place',
      name: 'Restaurant',
    });

    aliceId = alice.id;
    bobId = bob.id;
    restaurantId = restaurant.id;
  });

  describe('createEdge', () => {
    it('should create edge between entities', async () => {
      const edge = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'married_to',
        weight: 1.0,
        origin: 'user_stated',
      });

      expect(edge.id).toBeDefined();
      expect(edge.sourceId).toBe(aliceId);
      expect(edge.targetId).toBe(bobId);
      expect(edge.relation).toBe('married_to');
      expect(edge.weight).toBe(1.0);
      expect(edge.meta).toBeDefined();
    });

    it('should deduplicate edges by incrementing weight', async () => {
      const edge1 = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: restaurantId,
        relation: 'visited',
        weight: 1.0,
        evidence: [{ type: 'table', table: 'meals', row_id: 1 }],
      });

      const edge2 = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: restaurantId,
        relation: 'visited', // Same relation
        weight: 0.5,
        evidence: [{ type: 'table', table: 'meals', row_id: 2 }],
      });

      // Should be the same edge
      expect(edge2.id).toBe(edge1.id);
      expect(edge2.weight).toBe(1.5); // 1.0 + 0.5
      expect(edge2.evidence).toHaveLength(2); // Evidence appended
    });

    it('should throw error for non-existent source entity', async () => {
      await expect(
        createEdge(TEST_USER_ID, {
          sourceId: 99999,
          targetId: bobId,
          relation: 'likes',
        })
      ).rejects.toThrow('NOT_FOUND');
    });

    it('should throw error for non-existent target entity', async () => {
      await expect(
        createEdge(TEST_USER_ID, {
          sourceId: aliceId,
          targetId: 99999,
          relation: 'likes',
        })
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('getEdge', () => {
    it('should retrieve edge by ID', async () => {
      const created = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'likes',
      });

      const fetched = await getEdge(TEST_USER_ID, created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
    });

    it('should return null for non-existent edge', async () => {
      const fetched = await getEdge(TEST_USER_ID, 99999);
      expect(fetched).toBeNull();
    });
  });

  describe('updateEdge', () => {
    it('should update edge relation', async () => {
      const edge = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'likes',
      });

      const updated = await updateEdge(TEST_USER_ID, edge.id, {
        relation: 'married_to',
      });

      expect(updated.relation).toBe('married_to');
    });

    it('should update edge weight', async () => {
      const edge = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: restaurantId,
        relation: 'visited',
        weight: 1.0,
      });

      const updated = await updateEdge(TEST_USER_ID, edge.id, {
        weight: 3.0,
      });

      expect(updated.weight).toBe(3.0);
    });

    it('should append evidence', async () => {
      const edge = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'likes',
        evidence: [{ type: 'vector', vector_id: 1 }],
      });

      const updated = await updateEdge(TEST_USER_ID, edge.id, {
        evidence: [{ type: 'vector', vector_id: 2 }],
      });

      expect(updated.evidence).toHaveLength(2);
    });

    it('should throw error for non-existent edge', async () => {
      await expect(
        updateEdge(TEST_USER_ID, 99999, { weight: 2.0 })
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('deleteEdge', () => {
    it('should delete edge', async () => {
      const edge = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'likes',
      });

      await deleteEdge(TEST_USER_ID, edge.id);

      const fetched = await getEdge(TEST_USER_ID, edge.id);
      expect(fetched).toBeNull();
    });

    it('should update memory_meta to rejected', async () => {
      const edge = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'likes',
      });

      await deleteEdge(TEST_USER_ID, edge.id);

      // Check memory_meta status
      await pgSql`SET search_path TO ${pgSql(TEST_SCHEMA)}, public`.execute();
      const [meta] = await pgSql`
        SELECT status FROM memory_meta WHERE id = ${edge.meta!.id}
      `.execute();
      await pgSql`RESET search_path`.execute();

      expect(meta.status).toBe('rejected');
    });

    it('should throw error for non-existent edge', async () => {
      await expect(deleteEdge(TEST_USER_ID, 99999)).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('listEdges', () => {
    let aliceBobEdgeId: number;
    let aliceRestaurantEdgeId: number;
    let bobRestaurantEdgeId: number;

    beforeEach(async () => {
      const aliceBob = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'married_to',
        weight: 2.0,
      });
      const aliceRestaurant = await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: restaurantId,
        relation: 'visited',
        weight: 1.0,
      });
      const bobRestaurant = await createEdge(TEST_USER_ID, {
        sourceId: bobId,
        targetId: restaurantId,
        relation: 'visited',
        weight: 0.5,
      });

      aliceBobEdgeId = aliceBob.id;
      aliceRestaurantEdgeId = aliceRestaurant.id;
      bobRestaurantEdgeId = bobRestaurant.id;
    });

    it('should list all edges', async () => {
      const edges = await listEdges(TEST_USER_ID);
      expect(edges.length).toBe(3);
    });

    it('should filter by source entity', async () => {
      const edges = await listEdges(TEST_USER_ID, { sourceId: aliceId });
      expect(edges.length).toBe(2);
      expect(edges.every((e) => e.sourceId === aliceId)).toBe(true);
    });

    it('should filter by target entity', async () => {
      const edges = await listEdges(TEST_USER_ID, { targetId: restaurantId });
      expect(edges.length).toBe(2);
      expect(edges.every((e) => e.targetId === restaurantId)).toBe(true);
    });

    it('should filter by relation', async () => {
      const edges = await listEdges(TEST_USER_ID, { relation: 'visited' });
      expect(edges.length).toBe(2);
      expect(edges.every((e) => e.relation === 'visited')).toBe(true);
    });

    it('should order by weight DESC', async () => {
      const edges = await listEdges(TEST_USER_ID);
      expect(edges[0].weight).toBeGreaterThanOrEqual(edges[1].weight);
      expect(edges[1].weight).toBeGreaterThanOrEqual(edges[2].weight);
    });

    it('should exclude soft-deleted edges by default', async () => {
      await pgSql`SET search_path TO ${pgSql(TEST_SCHEMA)}, public`.execute();
      await pgSql`
        UPDATE edges
        SET _deleted_at = NOW()
        WHERE id = ${aliceRestaurantEdgeId}
      `.execute();
      await pgSql`RESET search_path`.execute();

      const edges = await listEdges(TEST_USER_ID);
      expect(edges).toHaveLength(2);
      expect(edges.some((edge) => edge.id === aliceRestaurantEdgeId)).toBe(false);
    });

    it('should include soft-deleted edges when includeDeleted is true', async () => {
      await pgSql`SET search_path TO ${pgSql(TEST_SCHEMA)}, public`.execute();
      await pgSql`
        UPDATE edges
        SET _deleted_at = NOW()
        WHERE id = ${aliceRestaurantEdgeId}
      `.execute();
      await pgSql`RESET search_path`.execute();

      const edges = await listEdges(TEST_USER_ID, { includeDeleted: true });
      expect(edges).toHaveLength(3);
      expect(edges.some((edge) => edge.id === aliceRestaurantEdgeId)).toBe(true);
    });

    it('should scope edges to a set of entities', async () => {
      const edges = await listEdges(TEST_USER_ID, {
        entityIds: [aliceId, bobId],
      });

      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe(aliceBobEdgeId);
    });

    it('should scope edges to sourceIds and targetIds', async () => {
      const edges = await listEdges(TEST_USER_ID, {
        sourceIds: [aliceId],
        targetIds: [restaurantId],
      });

      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe(aliceRestaurantEdgeId);
      expect(edges[0].id).not.toBe(bobRestaurantEdgeId);
    });
  });
});

// =====================================================
// GRAPH QUERY TESTS
// =====================================================

describe('Graph Queries', () => {
  let aliceId: number;
  let bobId: number;
  let restaurantId: number;
  let italianFoodId: number;

  beforeEach(async () => {
    // Create test graph
    const alice = await createEntity(TEST_USER_ID, {
      type: 'person',
      name: 'Alice',
    });
    const bob = await createEntity(TEST_USER_ID, {
      type: 'person',
      name: 'Bob',
    });
    const restaurant = await createEntity(TEST_USER_ID, {
      type: 'place',
      name: 'Bestia',
    });
    const italianFood = await createEntity(TEST_USER_ID, {
      type: 'food',
      name: 'Italian Food',
    });

    aliceId = alice.id;
    bobId = bob.id;
    restaurantId = restaurant.id;
    italianFoodId = italianFood.id;

    // Create edges
    await createEdge(TEST_USER_ID, {
      sourceId: aliceId,
      targetId: bobId,
      relation: 'married_to',
      weight: 2.0,
    });
    await createEdge(TEST_USER_ID, {
      sourceId: aliceId,
      targetId: restaurantId,
      relation: 'visited',
      weight: 1.5,
    });
    await createEdge(TEST_USER_ID, {
      sourceId: aliceId,
      targetId: italianFoodId,
      relation: 'likes',
      weight: 1.0,
    });
    await createEdge(TEST_USER_ID, {
      sourceId: restaurantId,
      targetId: italianFoodId,
      relation: 'category',
      weight: 1.0,
    });
  });

  describe('getNeighbors', () => {
    it('should get all neighbors (both directions)', async () => {
      const neighbors = await getNeighbors(TEST_USER_ID, aliceId);

      expect(neighbors.length).toBe(3);
      const names = neighbors.map((n) => n.name).sort();
      expect(names).toEqual(['Bestia', 'Bob', 'Italian Food']);
    });

    it('should get outbound neighbors only', async () => {
      const neighbors = await getNeighbors(TEST_USER_ID, aliceId, {
        direction: 'outbound',
      });

      expect(neighbors.length).toBe(3);
    });

    it('should get inbound neighbors only', async () => {
      const neighbors = await getNeighbors(TEST_USER_ID, restaurantId, {
        direction: 'inbound',
      });

      expect(neighbors.length).toBe(1);
      expect(neighbors[0].name).toBe('Alice');
    });

    it('should filter by relation', async () => {
      const neighbors = await getNeighbors(TEST_USER_ID, aliceId, {
        relationFilter: 'likes',
      });

      expect(neighbors.length).toBe(1);
      expect(neighbors[0].name).toBe('Italian Food');
    });

    it('should filter by confidence', async () => {
      // Create low confidence edge
      const lowConfEntity = await createEntity(TEST_USER_ID, {
        type: 'topic',
        name: 'LowConf',
      });
      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: lowConfEntity.id,
        relation: 'related_to',
        confidence: 0.2,
      });

      const neighbors = await getNeighbors(TEST_USER_ID, aliceId, {
        confidenceMin: 0.5,
      });

      // Should not include low confidence neighbor
      const names = neighbors.map((n) => n.name);
      expect(names).not.toContain('LowConf');
    });

    it('should order by edge weight DESC', async () => {
      const neighbors = await getNeighbors(TEST_USER_ID, aliceId);

      expect(neighbors[0].edge.weight).toBeGreaterThanOrEqual(
        neighbors[1].edge.weight
      );
    });

    it('should throw error for non-existent entity', async () => {
      await expect(
        getNeighbors(TEST_USER_ID, 99999)
      ).rejects.toThrow('NOT_FOUND');
    });
  });
});

// =====================================================
// ADVANCED GRAPH QUERY TESTS (Phase 3.2)
// =====================================================

describe('Advanced Graph Queries', () => {
  describe('getPathBetween', () => {
    let aliceId: number;
    let bobId: number;
    let charlieId: number;
    let daveId: number;
    let italianId: number;

    beforeEach(async () => {
      // Create a chain: Alice -> Italian Food -> Bob -> Charlie -> Dave
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });
      aliceId = alice.id;

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });
      bobId = bob.id;

      const charlie = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Charlie',
      });
      charlieId = charlie.id;

      const dave = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Dave',
      });
      daveId = dave.id;

      const italian = await createEntity(TEST_USER_ID, {
        type: 'food',
        name: 'Italian Food',
      });
      italianId = italian.id;

      // Create edges forming a path
      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: italianId,
        relation: 'likes',
        weight: 2.0,
      });

      await createEdge(TEST_USER_ID, {
        sourceId: italianId,
        targetId: bobId,
        relation: 'related_to',
        weight: 1.5,
      });

      await createEdge(TEST_USER_ID, {
        sourceId: bobId,
        targetId: charlieId,
        relation: 'friend',
        weight: 3.0,
      });

      await createEdge(TEST_USER_ID, {
        sourceId: charlieId,
        targetId: daveId,
        relation: 'knows',
        weight: 1.0,
      });
    });

    it('should find path between directly connected entities (1 hop)', async () => {
      const path = await getPathBetween(TEST_USER_ID, aliceId, italianId, 3);

      expect(path).toBeDefined();
      expect(path!.length).toBe(1);
      expect(path!.nodes).toHaveLength(2);
      expect(path!.nodes[0].id).toBe(aliceId);
      expect(path!.nodes[1].id).toBe(italianId);
      expect(path!.edges).toHaveLength(1);
      expect(path!.totalWeight).toBe(2.0);
    });

    it('should find path between entities 2 hops away', async () => {
      const path = await getPathBetween(TEST_USER_ID, aliceId, bobId, 3);

      expect(path).toBeDefined();
      expect(path!.length).toBe(2);
      expect(path!.nodes).toHaveLength(3);
      expect(path!.nodes[0].id).toBe(aliceId);
      expect(path!.nodes[1].id).toBe(italianId);
      expect(path!.nodes[2].id).toBe(bobId);
      expect(path!.edges).toHaveLength(2);
      expect(path!.totalWeight).toBe(3.5); // 2.0 + 1.5
    });

    it('should find path between entities 3 hops away', async () => {
      const path = await getPathBetween(TEST_USER_ID, aliceId, charlieId, 3);

      expect(path).toBeDefined();
      expect(path!.length).toBe(3);
      expect(path!.nodes).toHaveLength(4);
      expect(path!.totalWeight).toBe(6.5); // 2.0 + 1.5 + 3.0
    });

    it('should return null when no path exists within max depth', async () => {
      const path = await getPathBetween(TEST_USER_ID, aliceId, charlieId, 2);

      expect(path).toBeNull(); // Path exists but is 3 hops, max is 2
    });

    it('should return null when entities are not connected', async () => {
      const isolated = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Isolated',
      });

      const path = await getPathBetween(TEST_USER_ID, aliceId, isolated.id, 3);

      expect(path).toBeNull();
    });

    it('should respect confidence filtering (min 0.3)', async () => {
      // Create low-confidence edge
      const lowConf = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'LowConf',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: daveId,
        targetId: lowConf.id,
        relation: 'knows',
        confidence: 0.2, // Below threshold
      });

      const path = await getPathBetween(TEST_USER_ID, aliceId, lowConf.id, 5);

      expect(path).toBeNull(); // Path blocked by low-confidence edge
    });

    it('should throw error for non-existent source entity', async () => {
      await expect(
        getPathBetween(TEST_USER_ID, 99999, bobId, 3)
      ).rejects.toThrow('NOT_FOUND');
    });

    it('should throw error for non-existent target entity', async () => {
      await expect(
        getPathBetween(TEST_USER_ID, aliceId, 99999, 3)
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('traverse', () => {
    let aliceId: number;
    let bobId: number;
    let italianId: number;
    let pizzaId: number;
    let bestiaId: number;

    beforeEach(async () => {
      // Create multi-hop graph:
      // Alice -likes-> Italian Food -category-> Pizza
      // Alice -visited-> Bestia (place)
      // Bob -likes-> Italian Food
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });
      aliceId = alice.id;

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });
      bobId = bob.id;

      const italian = await createEntity(TEST_USER_ID, {
        type: 'food',
        name: 'Italian Food',
      });
      italianId = italian.id;

      const pizza = await createEntity(TEST_USER_ID, {
        type: 'food',
        name: 'Pizza',
      });
      pizzaId = pizza.id;

      const bestia = await createEntity(TEST_USER_ID, {
        type: 'place',
        name: 'Bestia',
      });
      bestiaId = bestia.id;

      // Create edges
      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: italianId,
        relation: 'likes',
        weight: 2.0,
      });

      await createEdge(TEST_USER_ID, {
        sourceId: italianId,
        targetId: pizzaId,
        relation: 'category',
        weight: 1.0,
      });

      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bestiaId,
        relation: 'visited',
        weight: 1.5,
      });

      await createEdge(TEST_USER_ID, {
        sourceId: bobId,
        targetId: italianId,
        relation: 'likes',
        weight: 1.0,
      });
    });

    it('should traverse graph from starting entity (depth 1)', async () => {
      const nodes = await traverse(TEST_USER_ID, aliceId, { maxDepth: 1 });

      expect(nodes.length).toBeGreaterThanOrEqual(2); // Alice + at least 2 neighbors
      const ids = nodes.map((n) => n.id);
      expect(ids).toContain(aliceId); // Starting node
      expect(ids).toContain(italianId); // 1-hop neighbor
      expect(ids).toContain(bestiaId); // 1-hop neighbor

      // Check depth values
      const aliceNode = nodes.find((n) => n.id === aliceId);
      expect(aliceNode!.depth).toBe(0);

      const italianNode = nodes.find((n) => n.id === italianId);
      expect(italianNode!.depth).toBe(1);
    });

    it('should traverse graph with depth 2', async () => {
      const nodes = await traverse(TEST_USER_ID, aliceId, { maxDepth: 2 });

      const ids = nodes.map((n) => n.id);
      expect(ids).toContain(aliceId); // Depth 0
      expect(ids).toContain(italianId); // Depth 1
      expect(ids).toContain(pizzaId); // Depth 2 (Alice -> Italian -> Pizza)
      expect(ids).toContain(bobId); // Depth 2 (Alice -> Italian -> Bob, reverse edge)

      const pizzaNode = nodes.find((n) => n.id === pizzaId);
      expect(pizzaNode!.depth).toBe(2);
    });

    it('should filter by relation type', async () => {
      const nodes = await traverse(TEST_USER_ID, aliceId, {
        maxDepth: 2,
        relationFilter: 'likes',
      });

      const ids = nodes.map((n) => n.id);
      expect(ids).toContain(italianId); // Alice -likes-> Italian
      expect(ids).not.toContain(bestiaId); // Alice -visited-> Bestia (filtered out)
    });

    it('should filter by multiple relation types', async () => {
      const nodes = await traverse(TEST_USER_ID, aliceId, {
        maxDepth: 2,
        relationFilter: ['likes', 'category'],
      });

      const ids = nodes.map((n) => n.id);
      expect(ids).toContain(italianId); // likes
      expect(ids).toContain(pizzaId); // category
      expect(ids).not.toContain(bestiaId); // visited (filtered out)
    });

    it('should filter by entity type', async () => {
      const nodes = await traverse(TEST_USER_ID, aliceId, {
        maxDepth: 2,
        entityTypeFilter: 'food',
      });

      const foodNodes = nodes.filter((n) => n.id !== aliceId); // Exclude start
      expect(foodNodes.every((n) => n.type === 'food')).toBe(true);
      expect(foodNodes.map((n) => n.id)).toContain(italianId);
      expect(foodNodes.map((n) => n.id)).toContain(pizzaId);
    });

    it('should filter by multiple entity types', async () => {
      const nodes = await traverse(TEST_USER_ID, aliceId, {
        maxDepth: 2,
        entityTypeFilter: ['food', 'place'],
      });

      const filteredNodes = nodes.filter((n) => n.id !== aliceId);
      expect(
        filteredNodes.every((n) => n.type === 'food' || n.type === 'place')
      ).toBe(true);
    });

    it('should respect confidence minimum', async () => {
      const lowConf = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'LowConf',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: lowConf.id,
        relation: 'knows',
        confidence: 0.2,
      });

      const nodes = await traverse(TEST_USER_ID, aliceId, {
        maxDepth: 1,
        confidenceMin: 0.3,
      });

      const ids = nodes.map((n) => n.id);
      expect(ids).not.toContain(lowConf.id); // Below confidence threshold
    });

    it('should prevent cycles in traversal', async () => {
      // Create a cycle: Alice -> Bob -> Charlie -> Alice
      const charlie = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Charlie',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bobId,
        relation: 'knows',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: bobId,
        targetId: charlie.id,
        relation: 'knows',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: charlie.id,
        targetId: aliceId,
        relation: 'knows',
      });

      const nodes = await traverse(TEST_USER_ID, aliceId, { maxDepth: 4 });

      // Should visit each node only once despite cycle
      const uniqueIds = new Set(nodes.map((n) => n.id));
      expect(uniqueIds.size).toBe(nodes.length);
    });

    it('should respect limit parameter', async () => {
      const nodes = await traverse(TEST_USER_ID, aliceId, {
        maxDepth: 3,
        limit: 3,
      });

      expect(nodes.length).toBeLessThanOrEqual(3);
    });
  });

  describe('queryPattern', () => {
    let aliceId: number;
    let bobId: number;
    let italianId: number;
    let bestiaId: number;

    beforeEach(async () => {
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });
      aliceId = alice.id;

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });
      bobId = bob.id;

      const italian = await createEntity(TEST_USER_ID, {
        type: 'food',
        name: 'Italian',
      });
      italianId = italian.id;

      const bestia = await createEntity(TEST_USER_ID, {
        type: 'place',
        name: 'Bestia',
      });
      bestiaId = bestia.id;

      // Both Alice and Bob ate Italian
      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: italianId,
        relation: 'ate',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: bobId,
        targetId: italianId,
        relation: 'ate',
      });

      // Alice likes Italian
      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: italianId,
        relation: 'likes',
      });

      // Alice visits Bestia
      await createEdge(TEST_USER_ID, {
        sourceId: aliceId,
        targetId: bestiaId,
        relation: 'visited',
      });
    });

    it('should parse "who do I eat X with?" pattern', async () => {
      const result = await queryPattern(TEST_USER_ID, {
        pattern: 'who do I eat Italian with?',
      });

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities[0].type).toBe('person');
      expect(result.explanation).toContain('eat');
    });

    it('should parse "what [type] do I like?" pattern', async () => {
      const result = await queryPattern(TEST_USER_ID, {
        pattern: 'what food do I like?',
      });

      const ids = result.entities.map((e) => e.id);
      expect(ids).toContain(italianId);
      expect(result.explanation).toContain('food');
      expect(result.explanation).toContain('like');
    });

    it('should parse "where do I [verb]?" pattern', async () => {
      const result = await queryPattern(TEST_USER_ID, {
        pattern: 'where do I run?',
      });

      expect(result.entities.some((e) => e.type === 'place')).toBe(true);
      expect(result.explanation).toContain('place');
    });

    it('should return empty result when no matching entity found', async () => {
      const result = await queryPattern(TEST_USER_ID, {
        pattern: 'who do I eat Sushi with?', // No sushi entity
      });

      expect(result.entities).toHaveLength(0);
      expect(result.explanation).toContain('No entity found');
    });

    it('should throw error for unrecognized pattern', async () => {
      await expect(
        queryPattern(TEST_USER_ID, { pattern: 'random gibberish' })
      ).rejects.toThrow('PATTERN_NOT_RECOGNIZED');
    });

    it('should respect limit parameter', async () => {
      const result = await queryPattern(TEST_USER_ID, {
        pattern: 'what food do I like?',
        limit: 1,
      });

      expect(result.entities.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getGraphStats', () => {
    it('should compute graph statistics', async () => {
      // Create entities and edges
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });

      const italian = await createEntity(TEST_USER_ID, {
        type: 'food',
        name: 'Italian',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: italian.id,
        relation: 'likes',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: bob.id,
        targetId: italian.id,
        relation: 'likes',
      });

      const stats = await getGraphStats(TEST_USER_ID);

      expect(stats.totalEntities).toBe(3);
      expect(stats.totalEdges).toBe(2);
      expect(stats.entitiesByType['person']).toBe(2);
      expect(stats.entitiesByType['food']).toBe(1);
      expect(stats.topRelations.some((r) => r.relation === 'likes')).toBe(true);
      expect(stats.avgConfidence).toBeGreaterThan(0);
      expect(stats.avgDegree).toBeGreaterThan(0);
    });

    it('should return zeros for empty graph', async () => {
      const stats = await getGraphStats(TEST_USER_ID);

      expect(stats.totalEntities).toBe(0);
      expect(stats.totalEdges).toBe(0);
      expect(stats.entitiesByType).toEqual({});
      expect(stats.topRelations).toEqual([]);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.avgDegree).toBe(0);
    });
  });

  describe('getEntityCentrality', () => {
    it('should compute degree centrality', async () => {
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });

      const charlie = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Charlie',
      });

      // Alice is connected to both Bob and Charlie
      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: bob.id,
        relation: 'knows',
        weight: 1.0,
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: charlie.id,
        relation: 'knows',
        weight: 2.0,
      });

      const centrality = await getEntityCentrality(TEST_USER_ID, alice.id);

      expect(centrality.entityId).toBe(alice.id);
      expect(centrality.degreeCentrality).toBe(2); // 2 connections
      expect(centrality.weightedDegree).toBe(3.0); // 1.0 + 2.0
      expect(centrality.betweenness).toBeGreaterThanOrEqual(0);
    });

    it('should compute betweenness centrality', async () => {
      // Create path: Alice -> Bob -> Charlie
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });

      const charlie = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Charlie',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: bob.id,
        relation: 'knows',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: bob.id,
        targetId: charlie.id,
        relation: 'knows',
      });

      const centrality = await getEntityCentrality(TEST_USER_ID, bob.id);

      // Bob is between Alice and Charlie
      expect(centrality.betweenness).toBeGreaterThan(0);
    });

    it('should return zero centrality for isolated entity', async () => {
      const isolated = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Isolated',
      });

      const centrality = await getEntityCentrality(TEST_USER_ID, isolated.id);

      expect(centrality.degreeCentrality).toBe(0);
      expect(centrality.weightedDegree).toBe(0);
      expect(centrality.betweenness).toBe(0);
    });

    it('should throw error for non-existent entity', async () => {
      await expect(
        getEntityCentrality(TEST_USER_ID, 99999)
      ).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('getClusteringCoefficient', () => {
    it('should compute clustering coefficient for tightly connected neighbors', async () => {
      // Create fully connected triangle: Alice -> Bob, Alice -> Charlie, Bob -> Charlie
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });

      const charlie = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Charlie',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: bob.id,
        relation: 'knows',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: charlie.id,
        relation: 'knows',
      });

      // Bob and Charlie are also connected
      await createEdge(TEST_USER_ID, {
        sourceId: bob.id,
        targetId: charlie.id,
        relation: 'knows',
      });

      const clustering = await getClusteringCoefficient(TEST_USER_ID, alice.id);

      expect(clustering.entityId).toBe(alice.id);
      expect(clustering.neighborCount).toBe(2); // Bob and Charlie
      expect(clustering.neighborEdgeCount).toBe(1); // Bob <-> Charlie
      expect(clustering.coefficient).toBe(1.0); // Fully connected (1 / 1)
    });

    it('should return 0 for entity with disconnected neighbors', async () => {
      // Alice -> Bob, Alice -> Charlie, but Bob and Charlie not connected
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });

      const charlie = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Charlie',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: bob.id,
        relation: 'knows',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: charlie.id,
        relation: 'knows',
      });

      const clustering = await getClusteringCoefficient(TEST_USER_ID, alice.id);

      expect(clustering.coefficient).toBe(0); // No edges between neighbors
    });

    it('should return 0 for entity with fewer than 2 neighbors', async () => {
      const alice = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Alice',
      });

      const bob = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Bob',
      });

      await createEdge(TEST_USER_ID, {
        sourceId: alice.id,
        targetId: bob.id,
        relation: 'knows',
      });

      const clustering = await getClusteringCoefficient(TEST_USER_ID, alice.id);

      expect(clustering.coefficient).toBe(0);
      expect(clustering.neighborCount).toBe(1);
    });

    it('should return 0 for isolated entity', async () => {
      const isolated = await createEntity(TEST_USER_ID, {
        type: 'person',
        name: 'Isolated',
      });

      const clustering = await getClusteringCoefficient(TEST_USER_ID, isolated.id);

      expect(clustering.coefficient).toBe(0);
      expect(clustering.neighborCount).toBe(0);
    });

    it('should throw error for non-existent entity', async () => {
      await expect(
        getClusteringCoefficient(TEST_USER_ID, 99999)
      ).rejects.toThrow('NOT_FOUND');
    });
  });
});
