/**
 * Vector Service Unit Tests
 *
 * Regression tests for metadata serialization in addVector.
 * The bug: passing a raw Object to tx.unsafe() crashes postgres.js
 * because it can't serialize Objects for the wire protocol.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql as pgSql, closeDatabase } from '@/db/client';

const TEST_USER_ID = '12345678-1234-1234-1234-123456789abc';
const TEST_SCHEMA = 'user_12345678123412341234123456789abc';

// Mock fetch to intercept OpenAI embedding calls
const FAKE_EMBEDDING = Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.01);
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  // Set dummy API key so generateEmbedding doesn't bail early
  process.env.OPENAI_API_KEY = 'test-key-for-vector-service-tests';

  // Mock fetch for OpenAI embedding API
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes('api.openai.com/v1/embeddings')) {
      return new Response(
        JSON.stringify({ data: [{ embedding: FAKE_EMBEDDING }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return originalFetch(url, init as any);
  }) as typeof fetch;

  // Create test schema with required tables
  await pgSql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      id              SERIAL PRIMARY KEY,
      source_type     VARCHAR(20) NOT NULL,
      source_ref      VARCHAR(200) NOT NULL,
      origin          VARCHAR(20) NOT NULL,
      agent_source    VARCHAR(100),
      confidence      REAL NOT NULL DEFAULT 0.5,
      status          VARCHAR(20) NOT NULL DEFAULT 'active',
      access_count    INTEGER NOT NULL DEFAULT 0,
      last_accessed   TIMESTAMPTZ,
      last_reinforced TIMESTAMPTZ,
      contradictions  JSONB NOT NULL DEFAULT '[]',
      promote_history JSONB NOT NULL DEFAULT '[]',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS _vector_collections (
      collection    VARCHAR(100) PRIMARY KEY,
      description   TEXT,
      entry_count   INTEGER NOT NULL DEFAULT 0,
      embedding_dim INTEGER NOT NULL DEFAULT 1536,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pgSql.unsafe(`
    CREATE TABLE IF NOT EXISTS vectors (
      id          SERIAL PRIMARY KEY,
      collection  VARCHAR(100) NOT NULL,
      text        TEXT NOT NULL,
      embedding   vector(1536) NOT NULL,
      metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted_at TIMESTAMPTZ,
      _meta_id    INTEGER REFERENCES memory_meta(id)
    )
  `);
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
  await pgSql.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await closeDatabase();
});

beforeEach(async () => {
  // Clean tables between tests
  await pgSql.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);
  await pgSql.unsafe(`DELETE FROM vectors`);
  await pgSql.unsafe(`DELETE FROM _vector_collections`);
  await pgSql.unsafe(`DELETE FROM memory_meta`);
});

describe('addVector metadata serialization', () => {
  it('should serialize empty metadata without crashing', async () => {
    const { addVector } = await import('@/services/vector.service');

    const id = await addVector(TEST_USER_ID, 'test-collection', 'hello world', {});
    expect(id).toBeTypeOf('number');
    expect(id).toBeGreaterThan(0);
  });

  it('should serialize metadata with nested objects and arrays', async () => {
    const { addVector } = await import('@/services/vector.service');

    const metadata = {
      source: 'test',
      tags: ['memory', 'family', 'walk'],
      location: { name: 'Canyon Crest', lat: 33.9, lng: -117.4 },
      nested: { deep: { value: 42 } },
    };

    const id = await addVector(TEST_USER_ID, 'journal', 'Family walk on a sunny day', metadata);
    expect(id).toBeTypeOf('number');
    expect(id).toBeGreaterThan(0);

    // Verify metadata was stored correctly
    const { getVector } = await import('@/services/vector.service');
    const vector = await getVector(TEST_USER_ID, id);
    expect(vector).not.toBeNull();
    expect(vector!.metadata).toEqual(metadata);
  });

  it('should serialize metadata with special characters', async () => {
    const { addVector } = await import('@/services/vector.service');

    const metadata = {
      note: 'She said "hello" & waved',
      emoji: "Walking to Moo Moo's house",
    };

    const id = await addVector(TEST_USER_ID, 'notes', 'A memory with special chars', metadata);
    expect(id).toBeTypeOf('number');

    const { getVector } = await import('@/services/vector.service');
    const vector = await getVector(TEST_USER_ID, id);
    expect(vector!.metadata).toEqual(metadata);
  });

  it('should auto-create collection when adding vector', async () => {
    const { addVector, collectionExists } = await import('@/services/vector.service');

    const id = await addVector(TEST_USER_ID, 'new-collection', 'first entry', { created: true });
    expect(id).toBeGreaterThan(0);

    const exists = await collectionExists(TEST_USER_ID, 'new-collection');
    expect(exists).toBe(true);
  });
});
