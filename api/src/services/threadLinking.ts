/**
 * Thread Linking Service
 *
 * Automatically connect related records across time using:
 * - Temporal proximity (entries within 2 hours)
 * - Semantic similarity (embedding cosine > 0.75)
 * - Entity overlap (sharing 2+ extracted entities)
 *
 * Creates edges between related records to build narrative threads.
 *
 * Reference: EPITOME_TECH_SPEC.md §6.4
 * Reference: knowledge-graph SKILL.md
 */

import { withUserSchema } from '@/db/client';
import { logger } from '@/utils/logger';
import { createEdge, type CreateEdgeInput } from './graphService';

// =====================================================
// TYPES
// =====================================================

/**
 * Related record result
 */
export interface RelatedRecord {
  recordId: number;
  tableName: string;
  similarity?: number;
  sharedEntities?: number;
  timeDelta?: number; // Minutes between records
}

/**
 * Thread link type
 */
export type ThreadLinkType = 'temporal_proximity' | 'semantic_similarity' | 'entity_overlap';

// =====================================================
// TEMPORAL PROXIMITY LINKING
// =====================================================

/**
 * Find records created within a time window
 *
 * @param userId - User ID for schema isolation
 * @param recordId - Record ID to find neighbors for
 * @param tableName - Table containing the record
 * @param windowHours - Time window in hours (default: 2)
 * @returns List of temporally close records
 */
export async function findTemporallyClose(
  userId: string,
  recordId: number,
  tableName: string,
  windowHours: number = 2
): Promise<RelatedRecord[]> {
  return withUserSchema(userId, async (tx) => {
    // Get the record's timestamp
    const recordResult = await tx<{ created_at: Date }[]>`
      SELECT created_at
      FROM ${tx(tableName)}
      WHERE id = ${recordId}
        AND _deleted_at IS NULL
    `;

    if (recordResult.length === 0) {
      return [];
    }

    const rawTime = recordResult[0].created_at;
    const recordTime = rawTime instanceof Date ? rawTime : new Date(rawTime as unknown as string);
    const windowStart = new Date(recordTime.getTime() - windowHours * 60 * 60 * 1000);
    const windowEnd = new Date(recordTime.getTime() + windowHours * 60 * 60 * 1000);

    // Get all tables from registry
    const tables = await tx<{ table_name: string }[]>`
      SELECT table_name
      FROM _table_registry
      WHERE table_name NOT IN ('_table_registry', '_vector_collections')
    `;

    const related: RelatedRecord[] = [];

    for (const { table_name } of tables) {
      // Find records in time window
      const records = await tx<{ id: number; created_at: Date }[]>`
        SELECT id, created_at
        FROM ${tx(table_name)}
        WHERE created_at >= ${windowStart.toISOString()}
          AND created_at <= ${windowEnd.toISOString()}
          AND _deleted_at IS NULL
          ${table_name === tableName ? tx`AND id != ${recordId}` : tx``}
        LIMIT 20
      `;

      for (const record of records) {
        const recTime = record.created_at instanceof Date ? record.created_at : new Date(record.created_at as unknown as string);
        const timeDelta = Math.abs(recTime.getTime() - recordTime.getTime()) / (1000 * 60);

        related.push({
          recordId: record.id,
          tableName: table_name,
          timeDelta,
        });
      }
    }

    // Sort by time proximity
    related.sort((a, b) => (a.timeDelta || 0) - (b.timeDelta || 0));

    return related.slice(0, 10); // Return top 10 closest
  });
}

// =====================================================
// SEMANTIC SIMILARITY LINKING
// =====================================================

/**
 * Find semantically similar records using vector embeddings
 *
 * @param userId - User ID for schema isolation
 * @param recordId - Record ID to find similar records for
 * @param minSimilarity - Minimum cosine similarity threshold (default: 0.75)
 * @returns List of semantically similar records
 */
export async function findSemanticallySimilar(
  userId: string,
  recordId: number,
  minSimilarity: number = 0.75
): Promise<RelatedRecord[]> {
  return withUserSchema(userId, async (tx) => {
    // Find vector entries for this record
    const vectorEntries = await tx<{
      id: number;
      collection: string;
      text: string;
      embedding: string;
    }[]>`
      SELECT id, collection, text, embedding::text
      FROM vectors
      WHERE metadata->>'record_id' = ${String(recordId)}
        AND _deleted_at IS NULL
      LIMIT 1
    `;

    if (vectorEntries.length === 0) {
      return [];
    }

    const vectorEntry = vectorEntries[0];

    // Perform direct similarity search using raw SQL
    const similar = await tx<{
      id: number;
      collection: string;
      similarity: number;
      metadata: Record<string, unknown>;
    }[]>`
      SELECT
        id,
        collection,
        1 - (embedding <=> ${vectorEntry.embedding}::vector) as similarity,
        metadata
      FROM vectors
      WHERE collection = ${vectorEntry.collection}
        AND _deleted_at IS NULL
        AND id != ${vectorEntry.id}
        AND 1 - (embedding <=> ${vectorEntry.embedding}::vector) >= ${minSimilarity}
      ORDER BY embedding <=> ${vectorEntry.embedding}::vector
      LIMIT 20
    `;

    const related: RelatedRecord[] = [];

    for (const result of similar) {
      // Extract record info from metadata
      const relatedRecordId = result.metadata?.record_id as number | undefined;
      const relatedTable = result.metadata?.table_name as string | undefined;

      if (relatedRecordId && relatedTable) {
        related.push({
          recordId: relatedRecordId,
          tableName: relatedTable,
          similarity: result.similarity,
        });
      }
    }

    return related;
  });
}

// =====================================================
// ENTITY OVERLAP LINKING
// =====================================================

/**
 * Find records that share 2+ extracted entities
 *
 * @param userId - User ID for schema isolation
 * @param recordId - Record ID to find overlapping records for
 * @param tableName - Table containing the record
 * @returns List of records with entity overlap
 */
export async function findEntityOverlaps(
  userId: string,
  recordId: number,
  tableName: string
): Promise<RelatedRecord[]> {
  return withUserSchema(userId, async (tx) => {
    // Find entities linked to this record via edges evidence
    const linkedEntities = await tx<{ entity_id: number }[]>`
      SELECT DISTINCT e.target_id AS entity_id
      FROM edges e,
      LATERAL jsonb_array_elements(e.evidence) AS evidence_item
      WHERE evidence_item->>'table' = ${tableName}
        AND (evidence_item->>'row_id')::INTEGER = ${recordId}
        AND e._deleted_at IS NULL
    `;

    if (linkedEntities.length === 0) {
      return [];
    }

    const entityIds = linkedEntities.map((e: { entity_id: number }) => e.entity_id);

    // Find other records that share these entities
    const overlapping = await tx<{
      table_name: string;
      record_id: number;
      shared_count: number;
    }[]>`
      SELECT
        evidence_item->>'table' AS table_name,
        (evidence_item->>'row_id')::INTEGER AS record_id,
        COUNT(DISTINCT e.target_id) AS shared_count
      FROM edges e,
      LATERAL jsonb_array_elements(e.evidence) AS evidence_item
      WHERE e.target_id = ANY(${entityIds})
        AND e._deleted_at IS NULL
        AND NOT (
          evidence_item->>'table' = ${tableName}
          AND (evidence_item->>'row_id')::INTEGER = ${recordId}
        )
      GROUP BY evidence_item->>'table', evidence_item->>'row_id'
      HAVING COUNT(DISTINCT e.target_id) >= 2
      ORDER BY shared_count DESC
      LIMIT 10
    `;

    return overlapping.map((o: { record_id: number; table_name: string; shared_count: number }) => ({
      recordId: o.record_id,
      tableName: o.table_name,
      sharedEntities: Number(o.shared_count),
    }));
  });
}

// =====================================================
// LINK CREATION
// =====================================================

/**
 * Create a thread link edge between two records
 *
 * @param userId - User ID for schema isolation
 * @param fromRecordId - Source record ID
 * @param fromTable - Source table name
 * @param toRecordId - Target record ID
 * @param toTable - Target table name
 * @param linkType - Type of thread link
 * @param metadata - Additional metadata for the edge
 */
async function createThreadLink(
  userId: string,
  fromRecordId: number,
  fromTable: string,
  toRecordId: number,
  toTable: string,
  linkType: ThreadLinkType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    // Get or create entities representing these records
    // We'll use a special entity type 'event' to represent record entries
    const fromEntityName = `${fromTable}_${fromRecordId}`;
    const toEntityName = `${toTable}_${toRecordId}`;

    // Check if entities exist, create if needed
    const fromEntity = await withUserSchema(userId, async (tx) => {
      const existing = await tx<{ id: number }[]>`
        SELECT id
        FROM entities
        WHERE type = 'event'
          AND name = ${fromEntityName}
          AND _deleted_at IS NULL
        LIMIT 1
      `;

      if (existing.length > 0) {
        return existing[0].id;
      }

      // Create new entity
      const created = await tx<{ id: number }[]>`
        INSERT INTO entities (type, name, properties, confidence)
        VALUES (
          'event',
          ${fromEntityName},
          ${JSON.stringify({ table: fromTable, record_id: fromRecordId })},
          0.7
        )
        RETURNING id
      `;

      return created[0].id;
    });

    const toEntity = await withUserSchema(userId, async (tx) => {
      const existing = await tx<{ id: number }[]>`
        SELECT id
        FROM entities
        WHERE type = 'event'
          AND name = ${toEntityName}
          AND _deleted_at IS NULL
        LIMIT 1
      `;

      if (existing.length > 0) {
        return existing[0].id;
      }

      // Create new entity
      const created = await tx<{ id: number }[]>`
        INSERT INTO entities (type, name, properties, confidence)
        VALUES (
          'event',
          ${toEntityName},
          ${JSON.stringify({ table: toTable, record_id: toRecordId })},
          0.7
        )
        RETURNING id
      `;

      return created[0].id;
    });

    // Create edge
    const edgeInput: CreateEdgeInput = {
      sourceId: fromEntity,
      targetId: toEntity,
      relation: 'thread_next',
      weight: 1.0,
      confidence: 0.7,
      properties: {
        link_type: linkType,
        ...metadata,
      },
      evidence: [
        { table: fromTable, row_id: fromRecordId },
        { table: toTable, row_id: toRecordId },
      ],
      origin: 'ai_pattern',
      agentSource: 'thread_linking',
    };

    await createEdge(userId, edgeInput);
  } catch (error) {
    logger.error('Error creating thread link', { error: String(error) });
    // Continue even if link creation fails
  }
}

// =====================================================
// MAIN LINKING INTERFACE
// =====================================================

/**
 * Link related records after a new record is created
 *
 * Applies all three linking strategies:
 * 1. Temporal proximity (2-hour window)
 * 2. Semantic similarity (cosine > 0.75)
 * 3. Entity overlap (2+ shared entities)
 *
 * @param userId - User ID for schema isolation
 * @param recordId - ID of the newly created record
 * @param tableName - Table containing the record
 */
export async function linkRelatedRecords(
  userId: string,
  recordId: number,
  tableName: string
): Promise<void> {
  try {
    // Strategy 1: Temporal proximity
    const temporallyClose = await findTemporallyClose(userId, recordId, tableName, 2);

    for (const related of temporallyClose.slice(0, 3)) {
      // Link top 3
      await createThreadLink(
        userId,
        recordId,
        tableName,
        related.recordId,
        related.tableName,
        'temporal_proximity',
        {
          time_delta_minutes: related.timeDelta,
        }
      );
    }

    // Strategy 2: Semantic similarity
    const semanticallySimilar = await findSemanticallySimilar(userId, recordId, 0.75);

    for (const related of semanticallySimilar.slice(0, 3)) {
      // Link top 3
      await createThreadLink(
        userId,
        recordId,
        tableName,
        related.recordId,
        related.tableName,
        'semantic_similarity',
        {
          similarity: related.similarity,
        }
      );
    }

    // Strategy 3: Entity overlap
    const entityOverlaps = await findEntityOverlaps(userId, recordId, tableName);

    for (const related of entityOverlaps.slice(0, 3)) {
      // Link top 3
      await createThreadLink(
        userId,
        recordId,
        tableName,
        related.recordId,
        related.tableName,
        'entity_overlap',
        {
          shared_entities: related.sharedEntities,
        }
      );
    }

    logger.info('Linked record', {
      table: tableName,
      recordId,
      temporal: temporallyClose.length,
      semantic: semanticallySimilar.length,
      entityOverlap: entityOverlaps.length,
    });
  } catch (error) {
    logger.error('Error linking related records', { error: String(error) });
    // Don't throw - linking is non-critical
  }
}

/**
 * Find all records in a thread starting from a given record
 *
 * @param userId - User ID for schema isolation
 * @param recordId - Starting record ID
 * @param tableName - Table containing the starting record
 * @param maxDepth - Maximum depth to traverse (default: 5)
 * @returns List of related records in thread order
 */
export async function getRecordThread(
  userId: string,
  recordId: number,
  tableName: string,
  maxDepth: number = 5
): Promise<RelatedRecord[]> {
  return withUserSchema(userId, async (tx) => {
    const entityName = `${tableName}_${recordId}`;

    // Find the entity representing this record
    const entity = await tx<{ id: number }[]>`
      SELECT id
      FROM entities
      WHERE type = 'event'
        AND name = ${entityName}
        AND _deleted_at IS NULL
      LIMIT 1
    `;

    if (entity.length === 0) {
      return [];
    }

    const entityId = entity[0].id;

    // Traverse thread using recursive CTE
    const thread = await tx<{
      entity_id: number;
      entity_name: string;
      depth: number;
      relation: string;
    }[]>`
      WITH RECURSIVE thread AS (
        -- Start node
        SELECT
          e.id AS entity_id,
          e.name AS entity_name,
          0 AS depth,
          ''::VARCHAR AS relation
        FROM entities e
        WHERE e.id = ${entityId}
          AND e._deleted_at IS NULL

        UNION ALL

        -- Traverse edges
        SELECT
          e2.id AS entity_id,
          e2.name AS entity_name,
          t.depth + 1 AS depth,
          ed.relation
        FROM thread t
        JOIN edges ed ON (ed.source_id = t.entity_id OR ed.target_id = t.entity_id)
        JOIN entities e2 ON (
          CASE
            WHEN ed.source_id = t.entity_id THEN e2.id = ed.target_id
            ELSE e2.id = ed.source_id
          END
        )
        WHERE t.depth < ${maxDepth}
          AND ed.relation = 'thread_next'
          AND ed._deleted_at IS NULL
          AND e2._deleted_at IS NULL
          AND e2.type = 'event'
      )
      SELECT DISTINCT ON (entity_id) *
      FROM thread
      ORDER BY entity_id, depth
    `;

    // Parse entity names to extract table and record ID
    return thread
      .filter((t: { entity_name: string }) => t.entity_name !== entityName) // Exclude starting record
      .map((t: { entity_name: string }) => {
        const [table, id] = t.entity_name.split('_');
        return {
          recordId: parseInt(id, 10),
          tableName: table,
        };
      });
  });
}
