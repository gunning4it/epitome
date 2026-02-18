/**
 * Vector Service
 *
 * Embedding generation and semantic search
 *
 * Features:
 * - OpenAI text-embedding-3-small (1536 dims) or Nomic
 * - Vector CRUD operations
 * - Similarity search with HNSW index
 * - Collection-based organization
 * - Integration with MemoryQualityService
 */

import { withUserSchema } from '@/db/client';
import {
  createMemoryMetaInternal,
  recordAccessInternal,
  recordMentionInternal,
  detectContradictionsInternal,
} from './memoryQuality.service';
import { logger } from '@/utils/logger';

/**
 * Vector entry
 */
export interface VectorEntry {
  id: number;
  collection: string;
  text: string;
  embedding?: number[]; // Only returned if explicitly requested
  metadata?: Record<string, unknown>;
  createdAt: Date;
  deletedAt?: Date | null;
  metaId?: number;
}

/**
 * Vector search result
 */
export interface VectorSearchResult {
  id: number;
  collection: string;
  text: string;
  metadata?: Record<string, unknown>;
  similarity: number; // Cosine similarity (0-1)
  confidence: number;
  status: string;
  createdAt: Date;
  metaId?: number;
}

/**
 * Collection metadata
 */
export interface CollectionMetadata {
  collection: string;
  description?: string;
  entryCount: number;
  embeddingDim: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw row from vector search query */
interface VectorSearchRow {
  id: number;
  collection: string;
  text: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
  created_at: string;
  _meta_id: number | null;
  confidence: number | null;
  status: string | null;
}

/** Raw row from vector list query */
interface VectorListRow {
  id: number;
  collection: string;
  text: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  _deleted_at: string | null;
  _meta_id: number | null;
}

/** Raw row from _vector_collections */
interface VectorCollectionRow {
  collection: string;
  description: string | null;
  entry_count: number;
  embedding_dim: number;
  created_at: string;
  updated_at: string;
}

/**
 * Generate embedding using OpenAI
 *
 * @param text - Text to embed
 * @param model - Embedding model to use
 * @returns Embedding vector
 */
async function generateEmbedding(
  text: string,
  model: string = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is not set. Cannot generate embeddings.'
    );
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0].embedding;
  } catch (error) {
    logger.error('Error generating embedding', { error: String(error) });
    throw new Error(
      `Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Check if collection exists
 *
 * @param userId - User ID for schema isolation
 * @param collection - Collection name
 * @returns True if collection exists
 */
export async function collectionExists(
  userId: string,
  collection: string
): Promise<boolean> {
  const result = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe(
      `
      SELECT EXISTS (
        SELECT 1
        FROM _vector_collections
        WHERE collection = $1
      ) as exists
    `,
      [collection]
    );

    return rows[0]?.exists || false;
  });

  return result;
}

/**
 * Create collection
 *
 * @param userId - User ID for schema isolation
 * @param collection - Collection name
 * @param description - Optional description
 * @param embeddingDim - Embedding dimension (default 1536)
 */
export async function createCollection(
  userId: string,
  collection: string,
  description?: string,
  embeddingDim: number = 1536
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    await tx.unsafe(
      `
      INSERT INTO _vector_collections (
        collection,
        description,
        entry_count,
        embedding_dim,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, 0, $3, NOW(), NOW()
      )
    `,
      [collection, description || null, embeddingDim]
    );
  });
}

/**
 * Add vector entry
 *
 * Generates embedding and stores vector in database
 *
 * @param userId - User ID for schema isolation
 * @param collection - Collection name
 * @param text - Text to embed
 * @param metadata - Optional metadata
 * @param changedBy - Who created the entry
 * @param origin - Origin for memory quality
 * @returns Created vector entry ID
 */
export async function addVector(
  userId: string,
  collection: string,
  text: string,
  metadata: Record<string, unknown> = {},
  changedBy: string = 'user',
  origin: string = 'user_typed'
): Promise<number> {
  // Generate embedding
  const embedding = await generateEmbedding(text);

  return await withUserSchema(userId, async (tx) => {
    const existingRows = await tx.unsafe<Array<{ id: number; _meta_id: number | null; metadata: Record<string, unknown> | null }>>(
      `
      SELECT id, _meta_id, metadata
      FROM vectors
      WHERE collection = $1
        AND lower(text) = lower($2)
        AND _deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [collection, text]
    );

    // Check if collection exists (inline to avoid nested withUserSchema)
    const existsRows = await tx.unsafe(
      `SELECT EXISTS (SELECT 1 FROM _vector_collections WHERE collection = $1) as exists`,
      [collection]
    );
    const exists = existsRows[0]?.exists || false;

    if (!exists) {
      // Auto-create collection (inline to avoid nested withUserSchema)
      await tx.unsafe(
        `INSERT INTO _vector_collections (collection, description, entry_count, embedding_dim, created_at, updated_at)
         VALUES ($1, $2, 0, $3, NOW(), NOW())`,
        [collection, null, embedding.length]
      );
    }

    // Create memory metadata (use internal version to avoid nested withUserSchema)
    const metaId = await createMemoryMetaInternal(tx, {
      sourceType: 'vector',
      sourceRef: `${collection}:pending`,
      origin,
      agentSource: changedBy !== 'user' ? changedBy : undefined,
    });

    // Insert vector
    const result = await tx.unsafe(
      `
      INSERT INTO vectors (
        collection,
        text,
        embedding,
        metadata,
        created_at,
        _meta_id
      ) VALUES (
        $1, $2, $3, $4, NOW(), $5
      )
      RETURNING id
    `,
      [
        collection,
        text,
        JSON.stringify(embedding),
        JSON.stringify(metadata),
        metaId,
      ]
    );
    const vectorId = result[0].id as number;

    await tx.unsafe(
      `UPDATE memory_meta SET source_ref = $2 WHERE id = $1`,
      [metaId, `${collection}:${vectorId}`]
    );

    const existing = existingRows[0];
    if (existing?._meta_id) {
      await recordMentionInternal(tx, existing._meta_id);

      if (JSON.stringify(existing.metadata || {}) !== JSON.stringify(metadata || {})) {
        await detectContradictionsInternal(tx, metaId, [
          {
            oldMetaId: existing._meta_id,
            field: `${collection}.metadata`,
            oldValue: existing.metadata || {},
            newValue: metadata || {},
            agent: changedBy,
          },
        ]);
      }
    }

    // Update collection entry count
    await tx.unsafe(
      `
      UPDATE _vector_collections
      SET entry_count = entry_count + 1,
          updated_at = NOW()
      WHERE collection = $1
    `,
      [collection]
    );

    return vectorId;
  });
}

/**
 * Search vectors by similarity
 *
 * Uses cosine similarity with HNSW index for fast search
 *
 * @param userId - User ID for schema isolation
 * @param collection - Collection to search in
 * @param queryText - Query text
 * @param limit - Maximum results to return (default 10)
 * @param minSimilarity - Minimum similarity threshold (default 0.7)
 * @returns Array of search results
 */
export async function searchVectors(
  userId: string,
  collection: string,
  queryText: string,
  limit: number = 10,
  minSimilarity: number = 0.7
): Promise<VectorSearchResult[]> {
  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(queryText);

  return await withUserSchema(userId, async (tx) => {
    // Perform similarity search with memory_meta JOIN for confidence
    const result = await tx.unsafe<VectorSearchRow[]>(
      `
      SELECT
        v.id,
        v.collection,
        v.text,
        v.metadata,
        1 - (v.embedding <=> $2::vector) as similarity,
        v.created_at,
        v._meta_id,
        m.confidence,
        m.status
      FROM vectors v
      LEFT JOIN memory_meta m ON v._meta_id = m.id
      WHERE v.collection = $1
        AND v._deleted_at IS NULL
        AND 1 - (v.embedding <=> $2::vector) >= $3
      ORDER BY v.embedding <=> $2::vector
      LIMIT $4
    `,
      [collection, JSON.stringify(queryEmbedding), minSimilarity, limit]
    );

    // Record access for each result (inline to avoid nested withUserSchema)
    for (const row of result) {
      if (row._meta_id) {
        await recordAccessInternal(tx, row._meta_id);
      }
    }

    return result.map((row) => ({
      id: row.id,
      collection: row.collection,
      text: row.text,
      metadata: row.metadata || {},
      similarity: row.similarity,
      confidence: row.confidence ?? 0.5,
      status: row.status ?? 'active',
      createdAt: new Date(row.created_at),
      metaId: row._meta_id ?? undefined,
    }));
  });
}

/**
 * Get vector entry by ID
 *
 * @param userId - User ID for schema isolation
 * @param vectorId - Vector ID
 * @returns Vector entry or null if not found
 */
export async function getVector(
  userId: string,
  vectorId: number
): Promise<VectorEntry | null> {
  const result = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe(
      `
      SELECT
        id,
        collection,
        text,
        metadata,
        created_at,
        _deleted_at,
        _meta_id
      FROM vectors
      WHERE id = $1
        AND _deleted_at IS NULL
      LIMIT 1
    `,
      [vectorId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];

    // Record access (inline to avoid nested withUserSchema)
    if (row._meta_id) {
      await recordAccessInternal(tx, row._meta_id);
    }

    return {
      id: row.id,
      collection: row.collection,
      text: row.text,
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
      deletedAt: row._deleted_at ? new Date(row._deleted_at) : null,
      metaId: row._meta_id ?? undefined,
    };
  });

  return result;
}

/**
 * Delete vector (soft delete)
 *
 * @param userId - User ID for schema isolation
 * @param vectorId - Vector ID to delete
 */
export async function deleteVector(
  userId: string,
  vectorId: number
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    // Get collection before deletion
    const rows = await tx.unsafe(
      `
      SELECT collection
      FROM vectors
      WHERE id = $1
        AND _deleted_at IS NULL
      LIMIT 1
    `,
      [vectorId]
    );

    if (rows.length === 0) {
      throw new Error(`Vector ${vectorId} not found`);
    }

    const collection = rows[0].collection;

    // Soft delete
    await tx.unsafe(
      `
      UPDATE vectors
      SET _deleted_at = NOW()
      WHERE id = $1
    `,
      [vectorId]
    );

    // Update collection entry count
    await tx.unsafe(
      `
      UPDATE _vector_collections
      SET entry_count = entry_count - 1,
          updated_at = NOW()
      WHERE collection = $1
    `,
      [collection]
    );
  });
}

/**
 * List all vectors in a collection
 *
 * @param userId - User ID for schema isolation
 * @param collection - Collection name
 * @param limit - Maximum entries to return
 * @param offset - Number of entries to skip
 * @returns Array of vector entries
 */
export async function listVectors(
  userId: string,
  collection: string,
  limit: number = 100,
  offset: number = 0
): Promise<VectorEntry[]> {
  return await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe<VectorListRow[]>(
      `
      SELECT
        id,
        collection,
        text,
        metadata,
        created_at,
        _deleted_at,
        _meta_id
      FROM vectors
      WHERE collection = $1
        AND _deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
      [collection, limit, offset]
    );

    for (const row of rows) {
      if (row._meta_id) {
        await recordAccessInternal(tx, row._meta_id);
      }
    }

    return rows.map((row) => ({
      id: row.id,
      collection: row.collection,
      text: row.text,
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
      deletedAt: row._deleted_at ? new Date(row._deleted_at) : null,
      metaId: row._meta_id ?? undefined,
    }));
  });
}

/**
 * List all collections
 *
 * @param userId - User ID for schema isolation
 * @returns Array of collection metadata
 */
export async function listCollections(
  userId: string
): Promise<CollectionMetadata[]> {
  return await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe<VectorCollectionRow[]>(`
      SELECT
        collection,
        description,
        entry_count,
        embedding_dim,
        created_at,
        updated_at
      FROM _vector_collections
      ORDER BY created_at DESC
    `);

    return rows.map((row) => ({
      collection: row.collection,
      description: row.description ?? undefined,
      entryCount: row.entry_count,
      embeddingDim: row.embedding_dim,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  });
}

/** Row from listRecentVectors join */
interface VectorWithMetaRow {
  id: number;
  collection: string;
  text: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  _meta_id: number | null;
  confidence: number | null;
  status: string | null;
}

/**
 * List recent vectors across all or a specific collection
 *
 * @param userId - User ID for schema isolation
 * @param options - Optional filters: collection, limit, offset
 * @returns Vectors with memory_meta info and total count
 */
export async function listRecentVectors(
  userId: string,
  options: { collection?: string; limit?: number; offset?: number } = {}
): Promise<{ vectors: VectorWithMetaRow[]; total: number }> {
  const { collection, limit = 50, offset = 0 } = options;

  return await withUserSchema(userId, async (tx) => {
    const mainFilter = collection ? 'AND v.collection = $3::text' : '';
    const countFilter = collection ? 'AND v.collection = $1::text' : '';
    const mainParams = collection
      ? [limit, offset, collection]
      : [limit, offset];

    const rows = await tx.unsafe<VectorWithMetaRow[]>(
      `SELECT v.id, v.collection, v.text, v.metadata, v.created_at,
              v._meta_id,
              m.confidence, m.status
       FROM vectors v
       LEFT JOIN memory_meta m ON v._meta_id = m.id
       WHERE v._deleted_at IS NULL ${mainFilter}
       ORDER BY v.created_at DESC
       LIMIT $1::int OFFSET $2::int`,
      mainParams
    );

    for (const row of rows) {
      if (row._meta_id) {
        await recordAccessInternal(tx, row._meta_id);
      }
    }

    const countRows = await tx.unsafe<[{ count: string }]>(
      `SELECT COUNT(*) as count FROM vectors v
       WHERE v._deleted_at IS NULL ${countFilter}`,
      collection ? [collection] : []
    );

    return {
      vectors: rows,
      total: Number(countRows[0].count),
    };
  });
}

/**
 * Search vectors across all collections
 *
 * @param userId - User ID for schema isolation
 * @param queryText - Query text
 * @param limit - Maximum results
 * @param minSimilarity - Minimum similarity threshold
 * @returns Search results from all collections
 */
export async function searchAllVectors(
  userId: string,
  queryText: string,
  limit: number = 10,
  minSimilarity: number = 0.7
): Promise<VectorSearchResult[]> {
  const queryEmbedding = await generateEmbedding(queryText);

  return await withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe<VectorSearchRow[]>(
      `SELECT
        v.id, v.collection, v.text, v.metadata,
        1 - (v.embedding <=> $1::vector) as similarity,
        v.created_at, v._meta_id,
        m.confidence, m.status
      FROM vectors v
      LEFT JOIN memory_meta m ON v._meta_id = m.id
      WHERE v._deleted_at IS NULL
        AND 1 - (v.embedding <=> $1::vector) >= $2
      ORDER BY v.embedding <=> $1::vector
      LIMIT $3`,
      [JSON.stringify(queryEmbedding), minSimilarity, limit]
    );

    for (const row of result) {
      if (row._meta_id) {
        await recordAccessInternal(tx, row._meta_id);
      }
    }

    return result.map((row) => ({
      id: row.id,
      collection: row.collection,
      text: row.text,
      metadata: row.metadata || {},
      similarity: row.similarity,
      confidence: row.confidence ?? 0.5,
      status: row.status ?? 'active',
      createdAt: new Date(row.created_at),
      metaId: row._meta_id ?? undefined,
    }));
  });
}

/**
 * Get collection metadata
 *
 * @param userId - User ID for schema isolation
 * @param collection - Collection name
 * @returns Collection metadata or null if not found
 */
export async function getCollectionMetadata(
  userId: string,
  collection: string
): Promise<CollectionMetadata | null> {
  const result = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe(
      `
      SELECT
        collection,
        description,
        entry_count,
        embedding_dim,
        created_at,
        updated_at
      FROM _vector_collections
      WHERE collection = $1
      LIMIT 1
    `,
      [collection]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      collection: row.collection,
      description: row.description ?? undefined,
      entryCount: row.entry_count,
      embeddingDim: row.embedding_dim,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  });

  return result;
}
