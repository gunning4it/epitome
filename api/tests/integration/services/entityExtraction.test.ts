/**
 * Entity Extraction Service Unit Tests
 *
 * Tests rule-based extraction, LLM extraction (mocked), and batch processing
 * Target: 90%+ coverage
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  extractEntitiesRuleBased,
  extractEntitiesLLM,
  extractEntitiesFromRecord,
  createInterEntityEdgesLLM,
  parseFoodDescription,
  getTemporalContext,
  buildContextAwarePrompt,
  buildUserPrompt,
  type ExtractedEntity,
  type ExtractionContext,
} from '@/services/entityExtraction';
import { sql as pgSql, closeDatabase } from '@/db/client';

// Test user ID
const TEST_USER_ID = '12345678-1234-1234-1234-123456789012';
const TEST_SCHEMA = 'user_12345678123412341234123456789012';

/** Helper: Build a mock OpenAI Responses API response */
function mockResponsesAPI(text: string) {
  return {
    ok: true,
    json: async () => ({
      output: [
        { type: 'message', status: 'completed', content: [{ type: 'output_text', text }] },
      ],
    }),
  };
}

// =====================================================
// SETUP & TEARDOWN
// =====================================================

beforeAll(async () => {
  // Create test user schema
  await pgSql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);

  // Set search path
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
});

beforeEach(async () => {
  // Clean up test data before each test
  await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
  await pgSql.unsafe(`TRUNCATE entities, edges, memory_meta CASCADE`);
  // Clean up profile table if it exists (created by context-aware tests)
  await pgSql.unsafe(`DELETE FROM profile`).catch(() => {});
});

afterAll(async () => {
  // Clean up test schema
  await pgSql.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await closeDatabase();
});

// =====================================================
// RULE-BASED EXTRACTION TESTS
// =====================================================

describe('extractEntitiesRuleBased', () => {
  it('should extract food entity from meals record', () => {
    const record = {
      id: 1,
      food: 'Pasta Carbonara',
      calories: 650,
      meal_type: 'dinner',
      created_at: new Date().toISOString(),
    };

    const entities = extractEntitiesRuleBased('meals', record);

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      name: 'Pasta Carbonara',
      type: 'food',
      properties: {
        calories: 650,
        meal_type: 'dinner',
      },
      edge: {
        relation: 'ate',
        weight: 1.0,
      },
    });
  });

  it('should extract food and place entities from meals with restaurant', () => {
    const record = {
      id: 1,
      food: 'Margherita Pizza',
      calories: 800,
      meal_type: 'dinner',
      restaurant: 'Bestia',
      created_at: new Date().toISOString(),
    };

    const entities = extractEntitiesRuleBased('meals', record);

    expect(entities).toHaveLength(2);

    // Food entity
    expect(entities[0]).toMatchObject({
      name: 'Margherita Pizza',
      type: 'food',
    });

    // Place entity
    expect(entities[1]).toMatchObject({
      name: 'Bestia',
      type: 'place',
      properties: {
        category: 'restaurant',
      },
      edge: {
        relation: 'visited',
      },
    });
  });

  it('should extract activity entity from workouts record', () => {
    const record = {
      id: 1,
      exercise: 'Running',
      duration: 45,
      intensity: 'moderate',
      calories_burned: 400,
      created_at: new Date().toISOString(),
    };

    const entities = extractEntitiesRuleBased('workouts', record);

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      name: 'Running',
      type: 'activity',
      properties: {
        duration: 45,
        intensity: 'moderate',
        calories_burned: 400,
      },
      edge: {
        relation: 'performed',
      },
    });
  });

  it('should extract activity and place from workouts with location', () => {
    const record = {
      id: 1,
      exercise: 'Weightlifting',
      duration: 60,
      location: 'Gold\'s Gym',
      created_at: new Date().toISOString(),
    };

    const entities = extractEntitiesRuleBased('workouts', record);

    expect(entities).toHaveLength(2);
    expect(entities[0].type).toBe('activity');
    expect(entities[1]).toMatchObject({
      name: 'Gold\'s Gym',
      type: 'place',
      properties: {
        category: 'gym',
      },
    });
  });

  it('should extract medication entity from medications record', () => {
    const record = {
      id: 1,
      name: 'Metformin',
      dose: '500mg',
      frequency: 'twice daily',
      purpose: 'diabetes management',
      created_at: new Date().toISOString(),
    };

    const entities = extractEntitiesRuleBased('medications', record);

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      name: 'Metformin',
      type: 'medication',
      properties: {
        dose: '500mg',
        frequency: 'twice daily',
        purpose: 'diabetes management',
      },
      edge: {
        relation: 'takes',
      },
    });
  });

  it('should extract person entities from profile family array', () => {
    const record = {
      id: 1,
      family: [
        {
          name: 'Sarah Chen',
          relation: 'wife',
          age: 34,
        },
        {
          name: 'Max Chen',
          relation: 'son',
          age: 8,
        },
      ],
    };

    const entities = extractEntitiesRuleBased('profile', record);

    expect(entities).toHaveLength(2);

    expect(entities[0]).toMatchObject({
      name: 'Sarah Chen',
      type: 'person',
      properties: {
        relation: 'wife',
        age: 34,
      },
      edge: {
        relation: 'married_to',
      },
    });

    expect(entities[1]).toMatchObject({
      name: 'Max Chen',
      type: 'person',
      properties: {
        relation: 'son',
        age: 8,
      },
      edge: {
        relation: 'family_member',
      },
    });
  });

  it('should extract person entities from profile family object arrays', () => {
    const record = {
      id: 1,
      family: {
        children: [
          {
            name: 'Ashley Gunning',
            age: '5 months',
            birthday: '2026-08-31',
          },
        ],
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);
    const ashley = entities.find(
      (entity) => entity.type === 'person' && entity.name === 'Ashley Gunning',
    );

    expect(ashley).toBeDefined();
    expect(ashley).toMatchObject({
      name: 'Ashley Gunning',
      type: 'person',
      properties: {
        relation: 'child',
        age: '5 months',
        birthday: '2026-08-31',
      },
      edge: {
        relation: 'family_member',
      },
    });
  });

  it('should extract preferences from profile', () => {
    const record = {
      id: 1,
      preferences: {
        'spicy food': true,
        'early mornings': false,
        'dark mode': true,
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    expect(entities).toHaveLength(3);

    expect(entities[0]).toMatchObject({
      name: 'spicy food',
      type: 'preference',
      edge: {
        relation: 'likes',
      },
    });

    expect(entities[1]).toMatchObject({
      name: 'early mornings',
      type: 'preference',
      edge: {
        relation: 'dislikes',
      },
    });
  });

  it('should return empty array for unknown table', () => {
    const record = {
      id: 1,
      some_field: 'value',
    };

    const entities = extractEntitiesRuleBased('unknown_table', record);

    expect(entities).toEqual([]);
  });

  it('should handle missing fields gracefully', () => {
    const record = {
      id: 1,
      // No food field
      calories: 500,
    };

    const entities = extractEntitiesRuleBased('meals', record);

    expect(entities).toEqual([]);
  });
});

// =====================================================
// FOOD DESCRIPTION PARSING TESTS
// =====================================================

describe('parseFoodDescription', () => {
  it('should parse "X from Y - Z" pattern', () => {
    const result = parseFoodDescription(
      'Breakfast burrito from Crest Cafe - scrambled eggs, crispy bacon, sausage, potatoes'
    );
    expect(result.foodName).toBe('Breakfast burrito');
    expect(result.restaurant).toBe('Crest Cafe');
    expect(result.ingredients).toBe('scrambled eggs, crispy bacon, sausage, potatoes');
  });

  it('should parse "X from Y" pattern without ingredients', () => {
    const result = parseFoodDescription('Pizza from Dominos');
    expect(result.foodName).toBe('Pizza');
    expect(result.restaurant).toBe('Dominos');
    expect(result.ingredients).toBeUndefined();
  });

  it('should parse "X - Y" pattern (food - ingredients)', () => {
    const result = parseFoodDescription('Pasta Carbonara - cream, bacon, parmesan');
    expect(result.foodName).toBe('Pasta Carbonara');
    expect(result.restaurant).toBeUndefined();
    expect(result.ingredients).toBe('cream, bacon, parmesan');
  });

  it('should return plain food name when no separators', () => {
    const result = parseFoodDescription('Sushi');
    expect(result.foodName).toBe('Sushi');
    expect(result.restaurant).toBeUndefined();
    expect(result.ingredients).toBeUndefined();
  });

  it('should handle empty string', () => {
    const result = parseFoodDescription('');
    expect(result.foodName).toBe('');
  });

  it('should truncate food names longer than 80 chars', () => {
    const longName = 'A'.repeat(100);
    const result = parseFoodDescription(longName);
    expect(result.foodName.length).toBeLessThanOrEqual(80);
  });

  it('should handle em dash separators', () => {
    const result = parseFoodDescription('Tacos — carne asada, guac, salsa');
    expect(result.foodName).toBe('Tacos');
    expect(result.ingredients).toBe('carne asada, guac, salsa');
  });

  it('should handle en dash separators', () => {
    const result = parseFoodDescription('Burger – lettuce, tomato, cheese');
    expect(result.foodName).toBe('Burger');
    expect(result.ingredients).toBe('lettuce, tomato, cheese');
  });
});

describe('meals rule with parseFoodDescription', () => {
  it('should extract clean food name from verbose description', () => {
    const record = {
      id: 1,
      food: 'Breakfast burrito from Crest Cafe - scrambled eggs, crispy bacon, sausage',
      calories: 750,
      meal_type: 'breakfast',
    };

    const entities = extractEntitiesRuleBased('meals', record);

    // Should have food + parsed restaurant (no explicit restaurant column)
    expect(entities).toHaveLength(2);
    expect(entities[0].name).toBe('Breakfast burrito');
    expect(entities[0].type).toBe('food');
    expect(entities[0].properties?.ingredients).toBe(
      'scrambled eggs, crispy bacon, sausage'
    );
    expect(entities[1].name).toBe('Crest Cafe');
    expect(entities[1].type).toBe('place');
  });

  it('should not duplicate restaurant when explicit restaurant column exists', () => {
    const record = {
      id: 1,
      food: 'Breakfast burrito from Crest Cafe - eggs, bacon',
      restaurant: 'Crest Cafe',
      calories: 750,
    };

    const entities = extractEntitiesRuleBased('meals', record);

    // Food entity + 1 place entity (from explicit restaurant column, not double)
    const placeEntities = entities.filter((e) => e.type === 'place');
    expect(placeEntities).toHaveLength(1);
    expect(placeEntities[0].name).toBe('Crest Cafe');
  });

  it('should handle plain food name without description', () => {
    const record = {
      id: 1,
      food: 'Margherita Pizza',
      calories: 800,
    };

    const entities = extractEntitiesRuleBased('meals', record);

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('Margherita Pizza');
    expect(entities[0].type).toBe('food');
  });
});

// =====================================================
// LLM EXTRACTION TESTS (MOCKED)
// =====================================================

describe('extractEntitiesLLM', () => {
  const savedFetch = global.fetch;

  afterEach(() => {
    global.fetch = savedFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it('should extract entities using LLM when API key is set', async () => {
    // Mock fetch for OpenAI Responses API
    global.fetch = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      entities: [
        {
          name: 'React',
          type: 'topic',
          properties: { category: 'technology' },
          edge: { relation: 'interested_in', weight: 1.0 },
        },
      ],
    })));

    // Set mock API key
    process.env.OPENAI_API_KEY = 'test-key';

    const record = {
      id: 1,
      title: 'Learning React',
      content: 'Started learning React today',
    };

    const entities = await extractEntitiesLLM('notes', record);

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      name: 'React',
      type: 'topic',
    });

  });

  it('should return empty array when API key is not set', async () => {
    delete process.env.OPENAI_API_KEY;

    const record = {
      id: 1,
      content: 'Some content',
    };

    const entities = await extractEntitiesLLM('notes', record);

    expect(entities).toEqual([]);
  });

  it('should handle LLM API errors gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'API Error',
    });

    process.env.OPENAI_API_KEY = 'test-key';

    const record = {
      id: 1,
      content: 'Some content',
    };

    const entities = await extractEntitiesLLM('notes', record);

    expect(entities).toEqual([]);
  });

  it('should handle JSON parsing errors gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponsesAPI('Invalid JSON {{{'));

    process.env.OPENAI_API_KEY = 'test-key';

    const record = {
      id: 1,
      content: 'Some content',
    };

    const entities = await extractEntitiesLLM('notes', record);

    expect(entities).toEqual([]);
  });

  it('should extract JSON from markdown code blocks', async () => {
    // With structured output, the Responses API returns clean JSON
    // But test that parsing still works with wrapper object
    global.fetch = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      entities: [{ name: 'TypeScript', type: 'topic', properties: {}, edge: null }],
    })));

    process.env.OPENAI_API_KEY = 'test-key';

    const record = {
      id: 1,
      content: 'Learning TypeScript',
    };

    const entities = await extractEntitiesLLM('notes', record);

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('TypeScript');
  });
});

// =====================================================
// INTEGRATION TESTS
// =====================================================

describe('extractEntitiesFromRecord (integration)', () => {
  it('should extract and create entities in graph', async () => {
    const record = {
      id: 1,
      food: 'Sushi',
      calories: 450,
      meal_type: 'lunch',
      created_at: new Date().toISOString(),
    };

    const result = await extractEntitiesFromRecord(
      TEST_USER_ID,
      'meals',
      record,
      'rule_based'
    );

    expect(result.method).toBe('rule_based');
    expect(result.entities).toHaveLength(1);

    // Verify entity was created in database
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    const entities = await pgSql.unsafe<{ name: string; type: string }[]>(`
      SELECT name, type FROM entities WHERE _deleted_at IS NULL
    `);

    expect(entities.some((e) => e.name === 'Sushi' && e.type === 'food')).toBe(true);
  });

  it('should handle duplicate entities via deduplication', async () => {
    const record1 = {
      id: 1,
      food: 'Pizza',
      calories: 700,
      meal_type: 'dinner',
      created_at: new Date().toISOString(),
    };

    const record2 = {
      id: 2,
      food: 'Pizza', // Same food
      calories: 650,
      meal_type: 'lunch',
      created_at: new Date().toISOString(),
    };

    // Extract from both records
    await extractEntitiesFromRecord(TEST_USER_ID, 'meals', record1, 'rule_based');
    await extractEntitiesFromRecord(TEST_USER_ID, 'meals', record2, 'rule_based');

    // Verify only one Pizza entity exists
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    const entities = await pgSql.unsafe<{ name: string; mention_count: number }[]>(`
      SELECT name, mention_count FROM entities WHERE name = 'Pizza' AND _deleted_at IS NULL
    `);

    expect(entities).toHaveLength(1);
    expect(entities[0].mention_count).toBe(2); // Incremented for duplicate
  });

  it('should create user entity and edges', async () => {
    const record = {
      id: 1,
      exercise: 'Yoga',
      duration: 30,
      created_at: new Date().toISOString(),
    };

    await extractEntitiesFromRecord(TEST_USER_ID, 'workouts', record, 'rule_based');

    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Verify user entity was created
    const userEntity = await pgSql.unsafe<{ name: string; type: string }[]>(`
      SELECT name, type FROM entities WHERE name = 'user' AND _deleted_at IS NULL
    `);

    expect(userEntity).toHaveLength(1);
    expect(userEntity[0].type).toBe('person');

    // Verify edge was created
    const edges = await pgSql.unsafe<{ relation: string }[]>(`
      SELECT e.relation
      FROM edges e
      JOIN entities source ON e.source_id = source.id
      JOIN entities target ON e.target_id = target.id
      WHERE source.name = 'user'
        AND target.name = 'Yoga'
        AND e._deleted_at IS NULL
    `);

    expect(edges).toHaveLength(1);
    expect(edges[0].relation).toBe('performed');
  });
});

// =====================================================
// INTER-ENTITY EDGE CREATION TESTS
// =====================================================

describe('createInterEntityEdgesLLM', () => {
  const savedFetch = global.fetch;

  afterEach(() => {
    global.fetch = savedFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it('should return empty result when fewer than 2 entities', async () => {
    const result = await createInterEntityEdgesLLM(TEST_USER_ID, [
      { id: 1, name: 'Pizza', type: 'food' },
    ]);

    expect(result.newEntities).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('should return empty result when API key is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await createInterEntityEdgesLLM(TEST_USER_ID, [
      { id: 1, name: 'Pizza', type: 'food' },
      { id: 2, name: 'Pasta', type: 'food' },
    ]);

    expect(result.newEntities).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('should create new category entities and edges from LLM response', async () => {
    // First, create the entities in the database so edge creation can find them
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    const burrito1 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO entities (type, name, properties) VALUES ('food', 'San Diego-style burrito', '{}') RETURNING id
    `);
    const burrito2 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO entities (type, name, properties) VALUES ('food', 'breakfast burritos', '{}') RETURNING id
    `);

    // Mock fetch to return LLM Responses API format with new category and edges
    global.fetch = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      new_entities: [
        { name: 'Mexican food', type: 'food' },
      ],
      edges: [
        { source_name: 'San Diego-style burrito', target_name: 'Mexican food', relation: 'category', weight: 1.0 },
        { source_name: 'breakfast burritos', target_name: 'Mexican food', relation: 'category', weight: 1.0 },
        { source_name: 'San Diego-style burrito', target_name: 'breakfast burritos', relation: 'similar_to', weight: 0.8 },
      ],
    })));

    process.env.OPENAI_API_KEY = 'test-key';

    const result = await createInterEntityEdgesLLM(TEST_USER_ID, [
      { id: burrito1[0].id, name: 'San Diego-style burrito', type: 'food' },
      { id: burrito2[0].id, name: 'breakfast burritos', type: 'food' },
    ]);

    // Should have created the "Mexican food" category entity
    expect(result.newEntities).toHaveLength(1);
    expect(result.newEntities[0].name).toBe('Mexican food');

    // Should have created 3 edges
    expect(result.edges).toHaveLength(3);

    // Verify edges exist in database
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    const edges = await pgSql.unsafe<{ relation: string; source_name: string; target_name: string }[]>(`
      SELECT e.relation, s.name as source_name, t.name as target_name
      FROM edges e
      JOIN entities s ON e.source_id = s.id
      JOIN entities t ON e.target_id = t.id
      WHERE e._deleted_at IS NULL
        AND e.properties->>'agent_source' IS NULL
      ORDER BY e.relation
    `);

    const categoryEdges = edges.filter((e) => e.relation === 'category');
    const similarEdges = edges.filter((e) => e.relation === 'similar_to');

    expect(categoryEdges).toHaveLength(2);
    expect(similarEdges).toHaveLength(1);
    expect(similarEdges[0].source_name).toBe('San Diego-style burrito');
    expect(similarEdges[0].target_name).toBe('breakfast burritos');

    // Verify "Mexican food" entity exists in database
    const mexicanFood = await pgSql.unsafe<{ name: string; properties: Record<string, unknown> }[]>(`
      SELECT name, properties FROM entities WHERE name = 'Mexican food' AND _deleted_at IS NULL
    `);
    expect(mexicanFood).toHaveLength(1);
    expect(mexicanFood[0].properties).toMatchObject({ is_category: true });
  });

  it('should handle LLM API errors gracefully', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    await pgSql.unsafe(`INSERT INTO entities (type, name) VALUES ('food', 'Tacos')`);
    await pgSql.unsafe(`INSERT INTO entities (type, name) VALUES ('food', 'Burritos')`);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'Internal Server Error',
    });

    process.env.OPENAI_API_KEY = 'test-key';

    const result = await createInterEntityEdgesLLM(TEST_USER_ID, [
      { id: 1, name: 'Tacos', type: 'food' },
      { id: 2, name: 'Burritos', type: 'food' },
    ]);

    // Should return empty result, not throw
    expect(result.newEntities).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('should handle malformed LLM JSON response gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponsesAPI('Not valid JSON at all {{{'));

    process.env.OPENAI_API_KEY = 'test-key';

    const result = await createInterEntityEdgesLLM(TEST_USER_ID, [
      { id: 1, name: 'Tacos', type: 'food' },
      { id: 2, name: 'Burritos', type: 'food' },
    ]);

    expect(result.newEntities).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('should skip edges referencing unknown entity names', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    await pgSql.unsafe(`INSERT INTO entities (type, name) VALUES ('food', 'Tacos')`);
    await pgSql.unsafe(`INSERT INTO entities (type, name) VALUES ('food', 'Burritos')`);

    global.fetch = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      new_entities: [],
      edges: [
        // "Sushi" doesn't exist in the entity list — should be skipped
        { source_name: 'Tacos', target_name: 'Sushi', relation: 'similar_to', weight: 0.8 },
      ],
    })));

    process.env.OPENAI_API_KEY = 'test-key';

    const result = await createInterEntityEdgesLLM(TEST_USER_ID, [
      { id: 1, name: 'Tacos', type: 'food' },
      { id: 2, name: 'Burritos', type: 'food' },
    ]);

    // Edge should be skipped since "Sushi" is not in the entity list
    expect(result.edges).toHaveLength(0);
  });

  it('should handle LLM response wrapped in markdown code blocks', async () => {
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    const e1 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO entities (type, name) VALUES ('preference', 'Mediterranean diet') RETURNING id
    `);
    const e2 = await pgSql.unsafe<{ id: number }[]>(`
      INSERT INTO entities (type, name) VALUES ('preference', 'eating healthier') RETURNING id
    `);

    // With Responses API + strict JSON schema, code blocks won't happen, but test clean JSON
    global.fetch = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      new_entities: [],
      edges: [{ source_name: 'eating healthier', target_name: 'Mediterranean diet', relation: 'related_to', weight: 0.6 }],
    })));

    process.env.OPENAI_API_KEY = 'test-key';

    const result = await createInterEntityEdgesLLM(TEST_USER_ID, [
      { id: e1[0].id, name: 'Mediterranean diet', type: 'preference' },
      { id: e2[0].id, name: 'eating healthier', type: 'preference' },
    ]);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].relation).toBe('related_to');
  });
});

describe('extractEntitiesFromRecord inter-entity hook', () => {
  const savedFetch = global.fetch;

  afterEach(() => {
    global.fetch = savedFetch;
    delete process.env.OPENAI_API_KEY;
  });
  it('should fire inter-entity edge creation for profile with 2+ food entities', async () => {
    // Mock the OpenAI Responses API for inter-entity edges call
    const fetchMock = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      new_entities: [],
      edges: [],
    })));
    global.fetch = fetchMock;
    process.env.OPENAI_API_KEY = 'test-key';

    const record = {
      id: 1,
      preferences: {
        food: {
          favorites: ['tacos', 'burritos', 'enchiladas'],
        },
      },
    };

    await extractEntitiesFromRecord(TEST_USER_ID, 'profile', record, 'rule_based');

    // Wait briefly for the fire-and-forget to execute
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The inter-entity edge LLM call should have been made
    expect(fetchMock).toHaveBeenCalled();

    // Verify the API call was to the OpenAI Responses API
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.openai.com/v1/responses');
  });

  it('should NOT fire inter-entity edges for single entity extraction', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    process.env.OPENAI_API_KEY = 'test-key';

    const record = {
      id: 1,
      food: 'Pizza',
      calories: 700,
      meal_type: 'dinner',
      created_at: new Date().toISOString(),
    };

    await extractEntitiesFromRecord(TEST_USER_ID, 'meals', record, 'rule_based');

    // Wait briefly for any potential fire-and-forget
    await new Promise((resolve) => setTimeout(resolve, 200));

    // fetch should NOT be called since only 1 entity was created
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// =====================================================
// FAMILY MEMBER PREFERENCE EXTRACTION TESTS
// =====================================================

describe('family member preference extraction (rule-based)', () => {
  it('should extract food preferences from family member (object format)', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Sarah',
          birthday: '1992-03-15',
          preferences: {
            food: {
              favorites: ['sushi', 'ramen'],
            },
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Person entity + 2 food entities
    expect(entities).toHaveLength(3);

    // Person entity (edge from owner)
    expect(entities[0]).toMatchObject({
      name: 'Sarah',
      type: 'person',
      properties: { relation: 'wife' },
      edge: { relation: 'married_to' },
    });
    expect(entities[0].edge?.sourceRef).toBeUndefined();

    // Food entities with sourceRef → Sarah
    expect(entities[1]).toMatchObject({
      name: 'sushi',
      type: 'food',
      edge: {
        relation: 'likes',
        sourceRef: { name: 'Sarah', type: 'person' },
      },
    });

    expect(entities[2]).toMatchObject({
      name: 'ramen',
      type: 'food',
      edge: {
        relation: 'likes',
        sourceRef: { name: 'Sarah', type: 'person' },
      },
    });
  });

  it('should extract food preferences from family member (array format)', () => {
    const record = {
      id: 1,
      family: [
        {
          name: 'Sarah',
          relation: 'wife',
          preferences: {
            food: {
              favorites: ['sushi', 'pad thai'],
            },
          },
        },
      ],
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Person + 2 food entities
    expect(entities).toHaveLength(3);

    expect(entities[0]).toMatchObject({
      name: 'Sarah',
      type: 'person',
      edge: { relation: 'married_to' },
    });

    expect(entities[1]).toMatchObject({
      name: 'sushi',
      type: 'food',
      edge: {
        relation: 'likes',
        sourceRef: { name: 'Sarah', type: 'person' },
      },
    });

    expect(entities[2]).toMatchObject({
      name: 'pad thai',
      type: 'food',
      edge: {
        relation: 'likes',
        sourceRef: { name: 'Sarah', type: 'person' },
      },
    });
  });

  it('should extract allergies and interests from family member', () => {
    const record = {
      id: 1,
      family: {
        daughter: {
          name: 'Emma',
          allergies: ['peanuts', 'shellfish'],
          interests: ['soccer', 'painting'],
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Person + 2 interests + 2 allergies = 5
    expect(entities).toHaveLength(5);

    expect(entities[0]).toMatchObject({ name: 'Emma', type: 'person' });

    // Interests (extracted before allergies in helper order)
    expect(entities[1]).toMatchObject({
      name: 'soccer',
      type: 'topic',
      properties: { category: 'interest' },
      edge: {
        relation: 'interested_in',
        sourceRef: { name: 'Emma', type: 'person' },
      },
    });
    expect(entities[2]).toMatchObject({
      name: 'painting',
      type: 'topic',
      edge: { relation: 'interested_in', sourceRef: { name: 'Emma', type: 'person' } },
    });

    // Allergies
    expect(entities[3]).toMatchObject({
      name: 'peanuts',
      type: 'topic',
      properties: { category: 'allergy' },
      edge: {
        relation: 'allergic_to',
        sourceRef: { name: 'Emma', type: 'person' },
      },
    });
    expect(entities[4]).toMatchObject({
      name: 'shellfish',
      type: 'topic',
      edge: { relation: 'allergic_to', sourceRef: { name: 'Emma', type: 'person' } },
    });
  });

  it('should extract dislikes from family member', () => {
    const record = {
      id: 1,
      family: {
        son: {
          name: 'Max',
          dislikes: ['broccoli', 'homework'],
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Person + 2 dislikes = 3
    expect(entities).toHaveLength(3);
    expect(entities[1]).toMatchObject({
      name: 'broccoli',
      type: 'preference',
      properties: { category: 'dislike' },
      edge: {
        relation: 'dislikes',
        sourceRef: { name: 'Max', type: 'person' },
      },
    });
  });

  it('should extract flat preferences from family member', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Sarah',
          preferences: {
            'spicy food': true,
            'early mornings': false,
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Person + 2 flat preferences = 3
    expect(entities).toHaveLength(3);
    expect(entities[1]).toMatchObject({
      name: 'spicy food',
      type: 'preference',
      edge: {
        relation: 'likes',
        sourceRef: { name: 'Sarah', type: 'person' },
      },
    });
    expect(entities[2]).toMatchObject({
      name: 'early mornings',
      type: 'preference',
      edge: {
        relation: 'dislikes',
        sourceRef: { name: 'Sarah', type: 'person' },
      },
    });
  });

  it('should still extract meals with owner edges (backward compat)', () => {
    const record = {
      id: 1,
      food: 'Sushi',
      calories: 450,
      meal_type: 'lunch',
    };

    const entities = extractEntitiesRuleBased('meals', record);

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      name: 'Sushi',
      type: 'food',
      edge: { relation: 'ate' },
    });
    // No sourceRef → edge from owner
    expect(entities[0].edge?.sourceRef).toBeUndefined();
  });

  it('should handle family member with no attributes gracefully', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Sarah',
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Just the person entity
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      name: 'Sarah',
      type: 'person',
      edge: { relation: 'married_to' },
    });
  });

  it('should extract nested family members (e.g., wife.mother)', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna Gunning',
          birthday: '1989-06-22',
          mother: {
            name: 'Lauren',
            nickname: 'Moo Moo',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Brianna (person) + Lauren (mother_in_law edge) + Lauren (mother edge from Brianna) = 3
    expect(entities).toHaveLength(3);

    // Brianna as person with owner edge
    expect(entities[0]).toMatchObject({
      name: 'Brianna Gunning',
      type: 'person',
      edge: { relation: 'married_to' },
    });

    // Lauren with owner → family_member edge (for discoverability)
    expect(entities[1]).toMatchObject({
      name: 'Lauren',
      type: 'person',
      properties: { relation: 'mother', nickname: 'Moo Moo' },
      edge: { relation: 'family_member', weight: 1.0 },
    });
    expect(entities[1].edge?.sourceRef).toBeUndefined();

    // Lauren with Brianna → family_member edge (sourceRef)
    expect(entities[2]).toMatchObject({
      name: 'Lauren',
      type: 'person',
      edge: {
        relation: 'family_member',
        sourceRef: { name: 'Brianna Gunning', type: 'person' },
      },
    });
  });

  it('should extract nested member preferences recursively', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna',
          mother: {
            name: 'Lauren',
            interests: ['gardening'],
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Brianna + Lauren (mother_in_law) + Lauren (mother sourceRef) + gardening interest = 4
    expect(entities).toHaveLength(4);

    // Gardening interest sourced from Lauren
    expect(entities[3]).toMatchObject({
      name: 'gardening',
      type: 'topic',
      properties: { category: 'interest' },
      edge: {
        relation: 'interested_in',
        sourceRef: { name: 'Lauren', type: 'person' },
      },
    });
  });

  it('should extract food_dislikes from family member', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna',
          food_dislikes: ['burritos'],
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Person + 1 dislike = 2
    expect(entities).toHaveLength(2);
    expect(entities[1]).toMatchObject({
      name: 'burritos',
      type: 'preference',
      properties: { category: 'dislike' },
      edge: {
        relation: 'dislikes',
        sourceRef: { name: 'Brianna', type: 'person' },
      },
    });
  });

  it('should include nickname in person entity properties', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna',
          mother: {
            name: 'Lauren',
            nickname: 'Moo Moo',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    const laurenEntities = entities.filter(e => e.name === 'Lauren');
    expect(laurenEntities.length).toBeGreaterThanOrEqual(1);
    expect(laurenEntities[0].properties?.nickname).toBe('Moo Moo');
  });

  it('should handle real-world profile structure from production', () => {
    // Actual profile structure from the user's Epitome instance
    const record = {
      id: 1,
      name: 'Josh Gunning',
      family: {
        wife: {
          name: 'Brianna Gunning',
          birthday: '1989-06-22',
          interests: ['traveling'],
          food_dislikes: ['burritos'],
          mother: {
            name: 'Lauren',
            nickname: 'Moo Moo',
          },
        },
        daughter: {
          name: 'Georgia Gunning',
          birthday: '2025-09-19',
        },
      },
      preferences: {
        food: {
          favorites: ['breakfast burritos', 'San Diego-style burritos'],
          regional_style: 'Southern California / San Diego',
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Verify key entities exist
    const names = entities.map(e => e.name);

    expect(names).toContain('Brianna Gunning');
    expect(names).toContain('Georgia Gunning');
    expect(names).toContain('Lauren');

    // Brianna's interest in traveling
    const traveling = entities.find(e => e.name === 'traveling');
    expect(traveling?.edge?.sourceRef?.name).toBe('Brianna Gunning');

    // Brianna's food dislike
    const burritos = entities.find(e => e.name === 'burritos' && e.type === 'preference');
    expect(burritos?.edge?.relation).toBe('dislikes');
    expect(burritos?.edge?.sourceRef?.name).toBe('Brianna Gunning');

    // Lauren extracted with nickname
    const laurenEntries = entities.filter(e => e.name === 'Lauren');
    expect(laurenEntries.length).toBeGreaterThanOrEqual(2); // mother_in_law + mother sourceRef
    expect(laurenEntries.some(e => e.properties?.nickname === 'Moo Moo')).toBe(true);

    // Lauren connected to Brianna via sourceRef
    const laurenFromBrianna = laurenEntries.find(e => e.edge?.sourceRef?.name === 'Brianna Gunning');
    expect(laurenFromBrianna).toBeDefined();
    expect(laurenFromBrianna?.edge?.relation).toBe('family_member');

    // Owner food preferences still work
    const breakfastBurritos = entities.find(e => e.name === 'breakfast burritos' && e.type === 'food');
    expect(breakfastBurritos?.edge?.sourceRef).toBeUndefined(); // from owner
  });
});

describe('extractEntitiesFromRecord sourceRef resolution (integration)', () => {
  it('should create edges FROM family member entity, not owner', async () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Sarah',
          preferences: {
            food: {
              favorites: ['sushi'],
            },
          },
        },
      },
    };

    await extractEntitiesFromRecord(TEST_USER_ID, 'profile', record, 'rule_based');

    // Verify in database
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Sarah should exist as a person entity
    const sarah = await pgSql.unsafe<{ id: number; name: string }[]>(`
      SELECT id, name FROM entities WHERE name = 'Sarah' AND type = 'person' AND _deleted_at IS NULL
    `);
    expect(sarah).toHaveLength(1);

    // Sushi should exist as a food entity
    const sushi = await pgSql.unsafe<{ id: number; name: string }[]>(`
      SELECT id, name FROM entities WHERE name = 'sushi' AND type = 'food' AND _deleted_at IS NULL
    `);
    expect(sushi).toHaveLength(1);

    // Edge from Sarah → sushi with relation 'likes'
    const edges = await pgSql.unsafe<{ source_id: number; target_id: number; relation: string }[]>(`
      SELECT source_id, target_id, relation FROM edges
      WHERE target_id = ${sushi[0].id} AND relation = 'likes'
    `);
    expect(edges).toHaveLength(1);
    expect(edges[0].source_id).toBe(sarah[0].id);

    // Edge from owner → Sarah with relation 'married_to'
    const wifeEdges = await pgSql.unsafe<{ source_id: number; target_id: number; relation: string }[]>(`
      SELECT source_id, target_id, relation FROM edges
      WHERE target_id = ${sarah[0].id} AND relation = 'married_to'
    `);
    expect(wifeEdges).toHaveLength(1);
    // The source should be the owner entity, NOT Sarah
    expect(wifeEdges[0].source_id).not.toBe(sarah[0].id);
  });
});

// =====================================================
// CONTEXT-AWARE EXTRACTION TESTS
// =====================================================

describe('getTemporalContext', () => {
  it('should compute correct dates for a mid-month date', () => {
    const now = new Date(2026, 1, 15); // Feb 15, 2026
    const ctx = getTemporalContext(now);

    expect(ctx.currentDate).toBe('2026-02-15');
    expect(ctx.dayOfWeek).toBe('Sunday');
    expect(ctx.yesterday).toBe('2026-02-14');
    expect(ctx.nextMonth).toBe('2026-03');
  });

  it('should handle month boundary (Jan 1 → yesterday is Dec 31)', () => {
    const now = new Date(2026, 0, 1); // Jan 1, 2026
    const ctx = getTemporalContext(now);

    expect(ctx.currentDate).toBe('2026-01-01');
    expect(ctx.yesterday).toBe('2025-12-31');
    expect(ctx.nextMonth).toBe('2026-02');
  });

  it('should handle year boundary for nextMonth (Dec → Jan next year)', () => {
    const now = new Date(2025, 11, 15); // Dec 15, 2025
    const ctx = getTemporalContext(now);

    expect(ctx.currentDate).toBe('2025-12-15');
    expect(ctx.nextMonth).toBe('2026-01');
  });

  it('should handle Feb to Mar transition', () => {
    const now = new Date(2026, 1, 28); // Feb 28, 2026
    const ctx = getTemporalContext(now);

    expect(ctx.currentDate).toBe('2026-02-28');
    expect(ctx.nextMonth).toBe('2026-03');
  });
});

describe('buildUserPrompt', () => {
  it('should use prose mode for records with long text field', () => {
    const prompt = buildUserPrompt('journal', {
      id: 1,
      text: 'Met Sarah at the coffee shop, she is moving to Portland next month',
      mood: 'happy',
    });

    expect(prompt).toContain('Source: journal');
    expect(prompt).toContain('Text: "Met Sarah');
    expect(prompt).toContain('Metadata:');
    expect(prompt).toContain('"mood":"happy"');
    // Should NOT contain raw JSON dump of the full record
    expect(prompt).not.toContain('"id":1');
  });

  it('should use structured mode for records without long text', () => {
    const prompt = buildUserPrompt('meals', {
      id: 1,
      food: 'Sushi',
      calories: 450,
    });

    expect(prompt).toContain('Table: meals');
    expect(prompt).toContain('Data:');
    expect(prompt).toContain('"food": "Sushi"');
  });

  it('should use structured mode when text is too short', () => {
    const prompt = buildUserPrompt('notes', {
      id: 1,
      text: 'Short',
    });

    expect(prompt).toContain('Table: notes');
    expect(prompt).toContain('Data:');
  });

  it('should detect content field as free text', () => {
    const prompt = buildUserPrompt('entries', {
      id: 1,
      content: 'Had a wonderful dinner with the family at the Italian place downtown',
    });

    expect(prompt).toContain('Source: entries');
    expect(prompt).toContain('Text: "Had a wonderful');
  });
});

describe('buildContextAwarePrompt', () => {
  it('should include date and temporal references', () => {
    const context: ExtractionContext = {
      currentDate: '2026-02-15',
      dayOfWeek: 'Sunday',
      yesterday: '2026-02-14',
      nextMonth: '2026-03',
      profileSummary: null,
      existingEntities: [],
    };

    const prompt = buildContextAwarePrompt(context);

    expect(prompt).toContain('2026-02-15 (Sunday)');
    expect(prompt).toContain('"yesterday" = 2026-02-14');
    expect(prompt).toContain('"next month" = 2026-03');
  });

  it('should include profile summary when present', () => {
    const context: ExtractionContext = {
      currentDate: '2026-02-15',
      dayOfWeek: 'Sunday',
      yesterday: '2026-02-14',
      nextMonth: '2026-03',
      profileSummary: 'Name: Bruce Wayne; wife: Sarah Chen',
      existingEntities: [],
    };

    const prompt = buildContextAwarePrompt(context);

    expect(prompt).toContain('## User Profile');
    expect(prompt).toContain('Name: Bruce Wayne; wife: Sarah Chen');
  });

  it('should omit profile section when profileSummary is null', () => {
    const context: ExtractionContext = {
      currentDate: '2026-02-15',
      dayOfWeek: 'Sunday',
      yesterday: '2026-02-14',
      nextMonth: '2026-03',
      profileSummary: null,
      existingEntities: [],
    };

    const prompt = buildContextAwarePrompt(context);

    expect(prompt).not.toContain('## User Profile');
  });

  it('should include existing entities with relations', () => {
    const context: ExtractionContext = {
      currentDate: '2026-02-15',
      dayOfWeek: 'Sunday',
      yesterday: '2026-02-14',
      nextMonth: '2026-03',
      profileSummary: null,
      existingEntities: [
        { name: 'Sarah Chen', type: 'person', relation: 'wife' },
        { name: 'Sushi', type: 'food' },
      ],
    };

    const prompt = buildContextAwarePrompt(context);

    expect(prompt).toContain('## Known Entities');
    expect(prompt).toContain('"Sarah Chen" (person), relation: wife');
    expect(prompt).toContain('"Sushi" (food)');
  });

  it('should omit entities section when empty', () => {
    const context: ExtractionContext = {
      currentDate: '2026-02-15',
      dayOfWeek: 'Sunday',
      yesterday: '2026-02-14',
      nextMonth: '2026-03',
      profileSummary: null,
      existingEntities: [],
    };

    const prompt = buildContextAwarePrompt(context);

    expect(prompt).not.toContain('## Known Entities');
  });

  it('should include disambiguation and temporal rules', () => {
    const context: ExtractionContext = {
      currentDate: '2026-02-15',
      dayOfWeek: 'Sunday',
      yesterday: '2026-02-14',
      nextMonth: '2026-03',
      profileSummary: null,
      existingEntities: [],
    };

    const prompt = buildContextAwarePrompt(context);

    expect(prompt).toContain('TEMPORAL');
    expect(prompt).toContain('DISAMBIGUATION');
    expect(prompt).toContain('ENTITY-TO-ENTITY');
    expect(prompt).toContain('SELECTIVITY');
  });
});

describe('extractEntitiesLLM context-aware', () => {
  const savedFetch = global.fetch;

  afterEach(() => {
    global.fetch = savedFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it('should use context-aware prompt when userId is provided', async () => {
    // Set up: create profile and entities in DB for context
    await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
    await pgSql.unsafe(`
      CREATE TABLE IF NOT EXISTS profile (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        changed_by VARCHAR(100),
        changed_fields JSONB,
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        _meta_id INTEGER
      )
    `);
    await pgSql.unsafe(`
      INSERT INTO profile (data, version, changed_at)
      VALUES ('{"name": "Bruce Wayne", "family": [{"name": "Sarah Chen", "relation": "wife"}]}', 1, NOW())
    `);
    await pgSql.unsafe(`
      INSERT INTO entities (type, name, mention_count) VALUES ('person', 'Sarah Chen', 10)
    `);

    // Mock fetch to capture the prompt and return entities
    const fetchMock = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      entities: [
        {
          name: 'Sarah Chen',
          type: 'person',
          properties: {},
          edge: { relation: 'met', weight: 1.0, sourceRef: null },
        },
        {
          name: 'Portland',
          type: 'place',
          properties: { resolved_date: '2026-03' },
          edge: {
            relation: 'moving_to',
            weight: 1.0,
            sourceRef: { name: 'Sarah Chen', type: 'person' },
          },
        },
      ],
    })));
    global.fetch = fetchMock;
    process.env.OPENAI_API_KEY = 'test-key';

    const entities = await extractEntitiesLLM(
      'journal',
      { id: 1, text: 'Met Sarah at the coffee shop, she is moving to Portland next month' },
      TEST_USER_ID
    );

    // Verify the LLM was called with a context-aware system prompt
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const systemMsg = callBody.input[0].content;

    // Context-aware prompt should contain temporal refs and known entities
    expect(systemMsg).toContain('Temporal reference guide');
    expect(systemMsg).toContain('Sarah Chen');
    expect(systemMsg).toContain('Bruce Wayne');

    // User prompt should be prose mode
    const userMsg = callBody.input[1].content;
    expect(userMsg).toContain('Source: journal');
    expect(userMsg).toContain('Text: "Met Sarah');

    // Should return the entities from the mock
    expect(entities).toHaveLength(2);
    expect(entities[0].name).toBe('Sarah Chen');
    expect(entities[1].name).toBe('Portland');
    expect(entities[1].edge?.sourceRef?.name).toBe('Sarah Chen');
  });

  it('should use generic prompt when userId is not provided (backward compat)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      entities: [
        { name: 'React', type: 'topic', properties: {}, edge: null },
      ],
    })));
    global.fetch = fetchMock;
    process.env.OPENAI_API_KEY = 'test-key';

    const entities = await extractEntitiesLLM('notes', { id: 1, content: 'Learning React' });

    expect(entities).toHaveLength(1);

    // Generic prompt should NOT contain context-aware sections
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const systemMsg = callBody.input[0].content;
    expect(systemMsg).not.toContain('Temporal reference guide');
    expect(systemMsg).not.toContain('## Known Entities');
    expect(systemMsg).toContain('entity extraction');
  });
});

describe('extractEntitiesFromRecord batch path with userId', () => {
  const savedFetch = global.fetch;

  afterEach(() => {
    global.fetch = savedFetch;
    delete process.env.OPENAI_API_KEY;
  });
  it('should pass userId to LLM when batch mode falls through rule-based', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponsesAPI(JSON.stringify({
      entities: [
        {
          name: 'coffee shop',
          type: 'place',
          properties: {},
          edge: { relation: 'visited', weight: 1.0, sourceRef: null },
        },
      ],
    })));
    global.fetch = fetchMock;
    process.env.OPENAI_API_KEY = 'test-key';

    // "journal" has no rule-based extractor, so batch mode will fall through to LLM
    const result = await extractEntitiesFromRecord(
      TEST_USER_ID,
      'journal',
      { id: 1, text: 'Went to the coffee shop this morning and had a great latte' },
      'batch'
    );

    expect(result.method).toBe('llm');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('coffee shop');

    // Verify LLM was called (meaning rule-based returned empty and fell through)
    expect(fetchMock).toHaveBeenCalled();

    // Verify the prompt was context-aware (has temporal guide)
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const systemMsg = callBody.input[0].content;
    expect(systemMsg).toContain('Temporal reference guide');
  });
});

// =====================================================
// SOCIAL CONNECTIONS EXTRACTION TESTS
// =====================================================

describe('social connections extraction (rule-based)', () => {
  it('should extract friend group members as person entities', () => {
    const record = {
      id: 1,
      social: {
        friends: {
          Rogerson: {
            members: ['Mark Rogerson', 'Kimberly Rogerson', 'Cici Rogerson'],
            relation: "Brianna's friends",
            location: 'Newport Beach',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    expect(entities).toHaveLength(3);
    for (const entity of entities) {
      expect(entity.type).toBe('person');
      expect(entity.properties?.group).toBe('Rogerson');
      expect(entity.properties?.location).toBe('Newport Beach');
      expect(entity.edge?.relation).toBe('friend');
    }

    expect(entities[0].name).toBe('Mark Rogerson');
    expect(entities[1].name).toBe('Kimberly Rogerson');
    expect(entities[2].name).toBe('Cici Rogerson');
  });

  it('should resolve sourceRef from relation field to family member', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna Gunning',
          birthday: '1989-06-22',
        },
      },
      social: {
        friends: {
          Rogerson: {
            members: ['Mark Rogerson'],
            relation: "Brianna's friends",
            location: 'Newport Beach',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Family member + friend
    const mark = entities.find(e => e.name === 'Mark Rogerson');
    expect(mark).toBeDefined();
    expect(mark?.edge?.sourceRef).toEqual({ name: 'Brianna Gunning', type: 'person' });
  });

  it('should omit sourceRef when relation does not match a family member', () => {
    const record = {
      id: 1,
      social: {
        friends: {
          WorkFriends: {
            members: ['Alice Smith'],
            relation: 'college friends',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('Alice Smith');
    expect(entities[0].edge?.sourceRef).toBeUndefined();
  });

  it('should handle friend group without location', () => {
    const record = {
      id: 1,
      social: {
        friends: {
          BookClub: {
            members: ['Jane Doe'],
            relation: 'book club',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    expect(entities).toHaveLength(1);
    expect(entities[0].properties?.location).toBeUndefined();
    expect(entities[0].properties?.group).toBe('BookClub');
  });

  it('should handle empty members array', () => {
    const record = {
      id: 1,
      social: {
        friends: {
          EmptyGroup: {
            members: [],
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);
    expect(entities).toHaveLength(0);
  });

  it('should handle social with no friends key', () => {
    const record = {
      id: 1,
      social: {
        colleagues: {},
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);
    expect(entities).toHaveLength(0);
  });
});

// =====================================================
// IN-LAW RELATIONSHIP LABEL TESTS
// =====================================================

describe('in-law relationship labels (rule-based)', () => {
  it('should label wife.mother as mother_in_law', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna',
          mother: {
            name: 'Lauren',
            nickname: 'Moo Moo',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Find the owner → Lauren edge (not the Brianna → Lauren sourceRef one)
    const laurenOwnerEdge = entities.find(
      e => e.name === 'Lauren' && !e.edge?.sourceRef
    );
    expect(laurenOwnerEdge).toBeDefined();
    expect(laurenOwnerEdge?.edge?.relation).toBe('family_member');
  });

  it('should label wife.father as family_member', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna',
          father: {
            name: 'Robert',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    const robertOwnerEdge = entities.find(
      e => e.name === 'Robert' && !e.edge?.sourceRef
    );
    expect(robertOwnerEdge).toBeDefined();
    expect(robertOwnerEdge?.edge?.relation).toBe('family_member');
  });

  it('should label husband.sister as family_member', () => {
    const record = {
      id: 1,
      family: {
        husband: {
          name: 'Mike',
          sister: {
            name: 'Emily',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    const emilyOwnerEdge = entities.find(
      e => e.name === 'Emily' && !e.edge?.sourceRef
    );
    expect(emilyOwnerEdge).toBeDefined();
    expect(emilyOwnerEdge?.edge?.relation).toBe('family_member');
  });

  it('should label husband.brother as family_member', () => {
    const record = {
      id: 1,
      family: {
        husband: {
          name: 'Mike',
          brother: {
            name: 'Dave',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    const daveOwnerEdge = entities.find(
      e => e.name === 'Dave' && !e.edge?.sourceRef
    );
    expect(daveOwnerEdge).toBeDefined();
    expect(daveOwnerEdge?.edge?.relation).toBe('family_member');
  });

  it('should keep family_member for non-spouse nested members', () => {
    const record = {
      id: 1,
      family: {
        daughter: {
          name: 'Georgia',
          friend: {
            name: 'Lily',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    const lilyOwnerEdge = entities.find(
      e => e.name === 'Lily' && !e.edge?.sourceRef
    );
    expect(lilyOwnerEdge).toBeDefined();
    expect(lilyOwnerEdge?.edge?.relation).toBe('family_member');
  });

  it('should keep family_member for spouse nested unknown relation', () => {
    const record = {
      id: 1,
      family: {
        wife: {
          name: 'Brianna',
          cousin: {
            name: 'Jake',
          },
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    const jakeOwnerEdge = entities.find(
      e => e.name === 'Jake' && !e.edge?.sourceRef
    );
    expect(jakeOwnerEdge).toBeDefined();
    // "cousin" is not in IN_LAW_MAP, so should fall back
    expect(jakeOwnerEdge?.edge?.relation).toBe('family_member');
  });
});

// =====================================================
// RELATIONSHIP MILESTONES EXTRACTION TESTS
// =====================================================

describe('relationship milestones extraction (rule-based)', () => {
  it('should extract event + place entities from milestone array format', () => {
    const record = {
      id: 1,
      relationship_milestones: [
        {
          event: 'honeymoon',
          duration: '1 month',
          locations: ['Paris', 'Cannes', 'Nice', 'Monaco', 'Mallorca', 'Rome', 'Lucerne', 'Amsterdam', 'London'],
        },
      ],
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // 1 event + 9 places = 10 entities
    expect(entities).toHaveLength(10);

    // Check event entity
    const honeymoon = entities.find(e => e.type === 'event' && e.name === 'honeymoon');
    expect(honeymoon).toBeDefined();
    expect(honeymoon?.edge?.relation).toBe('experiences');
    expect(honeymoon?.edge?.weight).toBe(1.0);
    expect(honeymoon?.properties).toMatchObject({ duration: '1 month' });

    // Check place entities
    const places = entities.filter(e => e.type === 'place');
    expect(places).toHaveLength(9);
    expect(places.map(p => p.name).sort()).toEqual(
      ['Amsterdam', 'Cannes', 'London', 'Lucerne', 'Mallorca', 'Monaco', 'Nice', 'Paris', 'Rome']
    );

    // Each place should have located_at edge with sourceRef pointing to the event
    for (const place of places) {
      expect(place.edge?.relation).toBe('located_at');
      expect(place.edge?.weight).toBe(1.0);
      expect(place.edge?.sourceRef).toMatchObject({ name: 'honeymoon', type: 'event' });
      expect(place.properties).toMatchObject({ context: 'honeymoon' });
    }
  });

  it('should extract milestones from object format', () => {
    const record = {
      id: 1,
      relationship_milestones: {
        honeymoon: {
          locations: ['Bali', 'Tokyo'],
          duration: '2 weeks',
        },
        wedding: {
          locations: ['Napa Valley'],
        },
      },
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // honeymoon event + 2 places + wedding event + 1 place = 5
    expect(entities).toHaveLength(5);

    const honeymoon = entities.find(e => e.type === 'event' && e.name === 'honeymoon');
    expect(honeymoon).toBeDefined();
    expect(honeymoon?.properties).toMatchObject({ duration: '2 weeks' });

    const wedding = entities.find(e => e.type === 'event' && e.name === 'wedding');
    expect(wedding).toBeDefined();
    expect(wedding?.edge?.relation).toBe('experiences');

    const napa = entities.find(e => e.name === 'Napa Valley');
    expect(napa).toBeDefined();
    expect(napa?.type).toBe('place');
    expect(napa?.edge?.sourceRef).toMatchObject({ name: 'wedding', type: 'event' });
  });

  it('should handle milestone without locations', () => {
    const record = {
      id: 1,
      relationship_milestones: [
        { event: 'proposal', locations: [] },
      ],
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // Just the event, no places
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('proposal');
    expect(entities[0].type).toBe('event');
    expect(entities[0].edge?.relation).toBe('experiences');
  });

  it('should skip milestones with missing event name', () => {
    const record = {
      id: 1,
      relationship_milestones: [
        { locations: ['Paris'] },
        { event: '', locations: ['London'] },
      ],
    };

    const entities = extractEntitiesRuleBased('profile', record);
    // No event entities should be created from milestone handler
    const events = entities.filter(e => e.type === 'event');
    expect(events).toHaveLength(0);
    // No located_at edges from milestone handler (generic may create place entities differently)
    const locatedAt = entities.filter(e => e.edge?.relation === 'located_at');
    expect(locatedAt).toHaveLength(0);
  });

  it('should combine milestones with other profile data', () => {
    const record = {
      id: 1,
      interests: ['photography'],
      relationship_milestones: [
        { event: 'honeymoon', locations: ['Paris'] },
      ],
    };

    const entities = extractEntitiesRuleBased('profile', record);

    // 1 interest + 1 event + 1 place = 3
    expect(entities).toHaveLength(3);
    expect(entities.find(e => e.name === 'photography')).toBeDefined();
    expect(entities.find(e => e.name === 'honeymoon')).toBeDefined();
    expect(entities.find(e => e.name === 'Paris')).toBeDefined();
  });
});
