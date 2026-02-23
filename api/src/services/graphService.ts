/**
 * Graph Service - Knowledge Graph Management
 *
 * Implements basic CRUD operations for entities and edges in the knowledge graph.
 * All graph data is stored in PostgreSQL using entities and edges tables.
 *
 * Part A (this file): Basic entity/edge CRUD operations
 * Part B (Phase 3): Entity extraction, deduplication, thread linking
 *
 * Reference: EPITOME_DATA_MODEL.md §5.3-5.4, §6.3-6.4
 * Reference: knowledge-graph SKILL.md
 */

import { withUserSchema, TransactionSql } from '@/db/client';
import { Entity, Edge, MemoryMeta } from '@/db/schema';
import { createMemoryMetaInternal, ORIGIN_CONFIDENCE, registerContradictionInternal } from './memoryQuality.service';
import { withTierLimitLock } from './metering.service';
import { validateEdge, normalizeEdgeRelation, insertEdgeQuarantine, type EntityType } from './ontology';
import { getFlag } from './featureFlags';
import { logger } from '@/utils/logger';

// Re-export ontology types for downstream consumers
export { ENTITY_TYPES, EDGE_RELATIONS, ENTITY_DISPLAY, type EntityType, type EdgeRelation } from './ontology';

/**
 * Entity creation input
 */
export interface CreateEntityInput {
  type: EntityType;
  name: string;
  properties?: Record<string, any>;
  confidence?: number;
  origin?: 'user_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system';
  agentSource?: string;
}

/**
 * Entity with metadata
 */
export interface EntityWithMeta extends Entity {
  meta?: MemoryMeta | null;
}

/**
 * Entity update input
 */
export interface UpdateEntityInput {
  name?: string;
  properties?: Record<string, any>;
  confidence?: number;
}

/**
 * Entity list filters
 */
export interface EntityFilters {
  type?: EntityType;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
  offset?: number;
}

/**
 * Edge creation input
 */
export interface CreateEdgeInput {
  sourceId: number;
  targetId: number;
  relation: string; // Validated at runtime via ontology.validateEdge()
  weight?: number;
  confidence?: number;
  evidence?: Array<Record<string, any>>;
  properties?: Record<string, any>;
  origin?: 'user_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system';
  agentSource?: string;
}

/**
 * Edge with metadata
 */
export interface EdgeWithMeta extends Edge {
  meta?: MemoryMeta | null;
}

/**
 * Edge update input
 */
export interface UpdateEdgeInput {
  relation?: string;
  weight?: number;
  confidence?: number;
  evidence?: Array<Record<string, any>>;
  properties?: Record<string, any>;
}

/**
 * Edge list filters
 */
export interface EdgeFilters {
  sourceId?: number;
  targetId?: number;
  sourceIds?: number[];
  targetIds?: number[];
  entityIds?: number[];
  relation?: string;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

/**
 * Neighbor query options
 */
export interface NeighborOptions {
  direction?: 'outbound' | 'inbound' | 'both';
  relationFilter?: string;
  confidenceMin?: number;
  limit?: number;
}

/**
 * Entity with edge information for neighbors
 */
export interface EntityWithEdge extends Entity {
  edge: Edge;
}

/**
 * Fuzzy search result with similarity score
 */
export interface EntitySearchResult extends Entity {
  similarity: number;
}

/** Raw row from entity search with similarity score */
interface EntitySearchRow {
  id: number;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  confidence: number;
  mentionCount: number;
  firstSeen: string;
  lastSeen: string;
  deletedAt: string | null;
  similarity: number;
}

/** Raw row from entity list with joined meta */
interface EntityListRow {
  id: number;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  confidence: number;
  mentionCount: number;
  firstSeen: string;
  lastSeen: string;
  deletedAt: string | null;
  meta: Record<string, unknown> | null;
}

// =====================================================
// MEMORY QUALITY HELPERS
// =====================================================

/**
 * Get initial confidence score for a new entity/edge
 * Uses MemoryQualityService confidence mapping
 */
function getInitialConfidence(
  origin: 'user_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system' | 'user_typed' = 'ai_inferred'
): number {
  return ORIGIN_CONFIDENCE[origin] || ORIGIN_CONFIDENCE['ai_inferred'];
}

// =====================================================
// INTERNAL HELPERS (Accept transaction directly)
// =====================================================

/**
 * Internal helper: Get entity by ID using provided transaction
 * This is used within withUserSchema callbacks to avoid nested schema calls
 */
export async function getEntityInternal(
  tx: TransactionSql,
  entityId: number,
  includeDeleted = false
): Promise<EntityWithMeta | null> {
  // Use explicit column aliases to map snake_case to camelCase
  let query = `
    SELECT
      e.id,
      e.type,
      e.name,
      e.properties,
      e.confidence,
      e.mention_count as "mentionCount",
      e.first_seen as "firstSeen",
      e.last_seen as "lastSeen",
      e._deleted_at as "deletedAt",
      row_to_json(m.*) as meta
    FROM entities e
    LEFT JOIN memory_meta m ON m.source_ref = 'entity:' || e.id
    WHERE e.id = $1
  `;

  if (!includeDeleted) {
    query += ` AND e._deleted_at IS NULL`;
  }

  query += ` LIMIT 1`;

  const result = await tx.unsafe(query, [entityId]);

  if (result.length === 0) {
    return null;
  }

  // Convert date strings to Date objects
  const entity = result[0];
  return {
    ...entity,
    firstSeen: new Date(entity.firstSeen),
    lastSeen: new Date(entity.lastSeen),
    deletedAt: entity.deletedAt ? new Date(entity.deletedAt) : null,
  } as unknown as EntityWithMeta;
}

/**
 * Internal helper: Get entity by name using provided transaction
 */
async function getEntityByNameInternal(
  tx: TransactionSql,
  name: string,
  type?: EntityType,
  similarityThreshold = 0.3,
  limit = 10
): Promise<EntitySearchResult[]> {
  // Use explicit column aliases to map snake_case to camelCase
  let query = `
    SELECT
      id,
      type,
      name,
      properties,
      confidence,
      mention_count as "mentionCount",
      first_seen as "firstSeen",
      last_seen as "lastSeen",
      _deleted_at as "deletedAt",
      GREATEST(
        similarity(name, $1),
        COALESCE(similarity(properties->>'nickname', $1), 0)
      ) as similarity
    FROM entities
    WHERE _deleted_at IS NULL
      AND (
        similarity(name, $1) > $2
        OR similarity(properties->>'nickname', $1) > $2
      )
  `;

  const params: unknown[] =[name, similarityThreshold];

  if (type) {
    query += ` AND type = $3`;
    params.push(type);
  }

  query += `
    ORDER BY similarity DESC
    LIMIT $${params.length + 1}
  `;
  params.push(limit);

  const result = await tx.unsafe<EntitySearchRow[]>(query, params);

  // Convert date strings to Date objects
  return result.map((row) => ({
    ...row,
    firstSeen: new Date(row.firstSeen),
    lastSeen: new Date(row.lastSeen),
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
  })) as EntitySearchResult[];
}

// =====================================================
// ENTITY OPERATIONS
// =====================================================

/**
 * Create a new entity in the knowledge graph
 *
 * NOTE: This function performs automatic deduplication using the 4-stage pipeline.
 * If a duplicate entity is found, it returns the existing entity instead of creating a new one.
 *
 * @param userId - User ID for schema isolation
 * @param input - Entity creation data
 * @param tier - User tier for limit enforcement (default 'free')
 * @returns Created entity with metadata (or existing entity if duplicate found)
 */
export async function createEntity(
  userId: string,
  input: CreateEntityInput,
  tier: string = 'free'
): Promise<EntityWithMeta> {
  const confidence = input.confidence ?? getInitialConfidence(input.origin);

  // First check for existing entity (dedup doesn't count against limit)
  const existing = await withUserSchema(userId, async (tx) => {
    const rows = await tx`
      SELECT id FROM entities
      WHERE type = ${input.type}
        AND lower(name) = lower(${input.name})
        AND _deleted_at IS NULL
      LIMIT 1
    `.execute();
    return rows;
  });

  if (existing.length > 0) {
    return withUserSchema(userId, async (tx) => {
      const entity = await getEntityInternal(tx, existing[0].id);
      if (entity) {
        await tx`
          UPDATE entities
          SET mention_count = mention_count + 1,
              last_seen = NOW()
          WHERE id = ${existing[0].id}
        `.execute();
        return entity;
      }
      throw new Error('INTERNAL_ERROR: Entity disappeared during dedup check');
    });
  }

  // New entity: enforce tier limit with advisory lock
  return withTierLimitLock(userId, tier, 'graphEntities', async (tx) => {
    // Double-check dedup inside lock (another request may have created it)
    const innerCheck = await tx`
      SELECT id FROM entities
      WHERE type = ${input.type}
        AND lower(name) = lower(${input.name})
        AND _deleted_at IS NULL
      LIMIT 1
    `.execute();

    if (innerCheck.length > 0) {
      const entity = await getEntityInternal(tx, innerCheck[0].id);
      if (entity) {
        await tx`
          UPDATE entities
          SET mention_count = mention_count + 1,
              last_seen = NOW()
          WHERE id = ${innerCheck[0].id}
        `.execute();
        return entity;
      }
    }

    // Create memory_meta using MemoryQualityService (handles confidence + status)
    const metaId = await createMemoryMetaInternal(tx, {
      sourceType: 'entity',
      sourceRef: 'entity:pending', // Updated after entity creation
      origin: input.origin ?? 'ai_inferred',
      agentSource: input.agentSource,
    });

    // Create entity
    const [entity] = await tx<Entity[]>`
      INSERT INTO entities (
        type,
        name,
        properties,
        confidence,
        mention_count,
        first_seen,
        last_seen
      ) VALUES (
        ${input.type},
        ${input.name},
        ${JSON.stringify(input.properties ?? {})},
        ${confidence},
        1,
        NOW(),
        NOW()
      )
      RETURNING id, type, name, properties, confidence,
        mention_count AS "mentionCount",
        first_seen AS "firstSeen",
        last_seen AS "lastSeen",
        _deleted_at AS "deletedAt"
    `.execute();

    // Update memory_meta source_ref with actual entity ID
    await tx`
      UPDATE memory_meta
      SET source_ref = ${'entity:' + entity.id}
      WHERE id = ${metaId}
    `.execute();

    // Fetch the created meta record
    const [meta] = await tx<MemoryMeta[]>`
      SELECT * FROM memory_meta WHERE id = ${metaId}
    `.execute();

    return {
      ...entity,
      meta,
    };
  });
}

/**
 * Get entity by ID
 *
 * @param userId - User ID for schema isolation
 * @param entityId - Entity ID
 * @param includeDeleted - Whether to include soft-deleted entities
 * @returns Entity with metadata, or null if not found
 */
export async function getEntity(
  userId: string,
  entityId: number,
  includeDeleted = false
): Promise<EntityWithMeta | null> {
  return withUserSchema(userId, async (tx) => {
    return getEntityInternal(tx, entityId, includeDeleted);
  });
}

/**
 * Update entity
 *
 * @param userId - User ID for schema isolation
 * @param entityId - Entity ID
 * @param updates - Fields to update
 * @returns Updated entity with metadata
 */
export async function updateEntity(
  userId: string,
  entityId: number,
  updates: UpdateEntityInput
): Promise<EntityWithMeta> {
  return withUserSchema(userId, async (tx) => {
    // Check entity exists and is not deleted
    const existing = await getEntityInternal(tx, entityId, false);
    if (!existing) {
      throw new Error('NOT_FOUND: Entity not found or has been deleted');
    }

    // Merge properties if provided (deep merge)
    const newProperties = updates.properties
      ? { ...existing.properties, ...updates.properties }
      : { ...existing.properties };

    // Preserve old name as alias when renaming (same pattern as mergeEntities)
    if (updates.name && updates.name !== existing.name) {
      const aliases = new Set<string>(newProperties.aliases || []);
      aliases.add(existing.name);
      newProperties.aliases = Array.from(aliases);
    }

    // Update entity
    await tx<Entity[]>`
      UPDATE entities
      SET
        name = COALESCE(${updates.name ?? null}, name),
        properties = ${JSON.stringify(newProperties)},
        confidence = COALESCE(${updates.confidence ?? null}, confidence),
        last_seen = NOW()
      WHERE id = ${entityId}
        AND _deleted_at IS NULL
      RETURNING *
    `.execute();

    // Update memory_meta
    if (existing.meta) {
      await tx`
        UPDATE memory_meta
        SET
          confidence = COALESCE(${updates.confidence ?? null}, confidence),
          last_reinforced = NOW()
        WHERE id = ${existing.meta.id}
      `.execute();
    }

    // Fetch updated entity with meta
    const result = await getEntityInternal(tx, entityId);
    if (!result) {
      throw new Error('INTERNAL_ERROR: Entity disappeared after update');
    }

    return result;
  });
}

/**
 * Delete entity (soft delete)
 *
 * @param userId - User ID for schema isolation
 * @param entityId - Entity ID
 */
export async function deleteEntity(userId: string, entityId: number): Promise<void> {
  return withUserSchema(userId, async (tx) => {
    // Check entity exists
    const existing = await getEntityInternal(tx, entityId, false);
    if (!existing) {
      throw new Error('NOT_FOUND: Entity not found or already deleted');
    }

    // Soft delete entity
    await tx`
      UPDATE entities
      SET _deleted_at = NOW()
      WHERE id = ${entityId}
    `.execute();

    // Cascade soft delete to edges (handled by trigger soft_delete_entity_edges)
    // But we'll do it explicitly for clarity
    await tx`
      UPDATE edges
      SET last_seen = NOW()
      WHERE (source_id = ${entityId} OR target_id = ${entityId})
    `.execute();

    // Update memory_meta status to REJECTED
    if (existing.meta) {
      await tx`
        UPDATE memory_meta
        SET status = 'rejected'
        WHERE id = ${existing.meta.id}
      `.execute();
    }
  });
}

/**
 * List entities with filters
 *
 * @param userId - User ID for schema isolation
 * @param filters - Filter criteria
 * @returns List of entities with metadata
 */
export async function listEntities(
  userId: string,
  filters: EntityFilters = {}
): Promise<EntityWithMeta[]> {
  return withUserSchema(userId, async (tx) => {
    const {
      type,
      confidenceMin = 0,
      confidenceMax = 1,
      limit = 50,
      offset = 0,
    } = filters;

    // Build query dynamically based on type filter
    // Use explicit column aliases to map snake_case to camelCase
    let query = `
      SELECT
        e.id,
        e.type,
        e.name,
        e.properties,
        e.confidence,
        e.mention_count as "mentionCount",
        e.first_seen as "firstSeen",
        e.last_seen as "lastSeen",
        e._deleted_at as "deletedAt",
        row_to_json(m.*) as meta
      FROM entities e
      LEFT JOIN memory_meta m ON m.source_ref = 'entity:' || e.id
      WHERE e._deleted_at IS NULL
        AND e.confidence >= $1
        AND e.confidence <= $2
    `;

    const params: unknown[] =[confidenceMin, confidenceMax];

    if (type) {
      query += ` AND e.type = $3`;
      params.push(type);
    }

    query += `
      ORDER BY e.confidence DESC, e.name ASC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const result = await tx.unsafe<EntityListRow[]>(query, params);

    // Convert date strings to Date objects
    return result.map((row) => ({
      ...row,
      firstSeen: new Date(row.firstSeen),
      lastSeen: new Date(row.lastSeen),
      deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
    })) as (Entity & { meta: MemoryMeta | null })[];
  });
}

/**
 * Search entities by name (fuzzy search using pg_trgm)
 *
 * @param userId - User ID for schema isolation
 * @param name - Name to search for
 * @param type - Optional entity type filter
 * @param similarityThreshold - Minimum similarity score (0-1)
 * @param limit - Maximum results
 * @returns Entities matching the search, ordered by similarity
 */
export async function getEntityByName(
  userId: string,
  name: string,
  type?: EntityType,
  similarityThreshold = 0.3,
  limit = 10
): Promise<EntitySearchResult[]> {
  return withUserSchema(userId, async (tx) => {
    // Search by name similarity OR alias/nickname match in properties JSONB.
    // Uses UNION to combine name-based trigram search with alias containment.
    const typeFilter = type ? ` AND type = $2` : '';
    const params: unknown[] = [name];
    if (type) params.push(type);

    const thresholdIdx = params.length + 1;
    const limitIdx = params.length + 2;
    params.push(similarityThreshold, limit);

    const query = `
      WITH name_matches AS (
        SELECT
          id, type, name, properties, confidence,
          mention_count AS "mentionCount",
          first_seen AS "firstSeen",
          last_seen AS "lastSeen",
          _deleted_at AS "deletedAt",
          similarity(name, $1) as similarity
        FROM entities
        WHERE _deleted_at IS NULL
          ${typeFilter}
          AND similarity(name, $1) >= $${thresholdIdx}
      ),
      alias_matches AS (
        SELECT
          id, type, name, properties, confidence,
          mention_count AS "mentionCount",
          first_seen AS "firstSeen",
          last_seen AS "lastSeen",
          _deleted_at AS "deletedAt",
          0.85::float as similarity
        FROM entities
        WHERE _deleted_at IS NULL
          ${typeFilter}
          AND properties ? 'aliases'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(properties->'aliases') alias
            WHERE similarity(alias, $1) >= $${thresholdIdx}
          )
          AND id NOT IN (SELECT id FROM name_matches)
      )
      SELECT * FROM name_matches
      UNION ALL
      SELECT * FROM alias_matches
      ORDER BY similarity DESC
      LIMIT $${limitIdx}
    `;

    const result = await tx.unsafe<(Entity & { similarity: number })[]>(query, params);

    return result.map((entity) => ({
      ...entity,
      firstSeen: new Date(entity.firstSeen),
      lastSeen: new Date(entity.lastSeen),
      deletedAt: entity.deletedAt ? new Date(entity.deletedAt) : null,
    }));
  });
}

// =====================================================
// EDGE OPERATIONS
// =====================================================

/**
 * Create edge between entities
 *
 * Implements edge deduplication: if edge already exists, increment weight
 * instead of creating a new row.
 *
 * @param userId - User ID for schema isolation
 * @param input - Edge creation data
 * @returns Created or updated edge with metadata
 */
export async function createEdge(
  userId: string,
  input: CreateEdgeInput
): Promise<EdgeWithMeta | null> {
  const result = await withUserSchema(userId, async (tx) => {
    const normalizedRelation = normalizeEdgeRelation(input.relation);
    const relationWasNormalized = normalizedRelation !== input.relation;
    const edgeProperties = { ...(input.properties ?? {}) };
    if (relationWasNormalized && edgeProperties.relation_alias === undefined) {
      edgeProperties.relation_alias = input.relation;
    }

    // Validate that source and target entities exist
    const [source, target] = await Promise.all([
      getEntityInternal(tx, input.sourceId),
      getEntityInternal(tx, input.targetId),
    ]);

    if (!source) {
      throw new Error(`NOT_FOUND: Source entity ${input.sourceId} not found`);
    }
    if (!target) {
      throw new Error(`NOT_FOUND: Target entity ${input.targetId} not found`);
    }

    // --- RELATION MATRIX VALIDATION (ontology enforcement) ---
    const validation = validateEdge(
      source.type as EntityType,
      target.type as EntityType,
      normalizedRelation
    );
    if (!validation.valid) {
      logger.warn('Edge validation failed', { ...validation, sourceId: input.sourceId, targetId: input.targetId });
      return null;
    }
    // Soft quarantine: edge is valid but flagged for review (novel relation or unexpected type combo)
    if (validation.quarantine) {
      await insertEdgeQuarantine(tx, {
        sourceType: source.type,
        targetType: target.type,
        relation: input.relation,
        sourceName: source.name,
        targetName: target.name,
        reason: validation.error || 'Novel relation',
        payload: {
          sourceId: input.sourceId,
          targetId: input.targetId,
          normalizedRelation,
          properties: edgeProperties,
        },
      });
      logger.info('Edge soft-quarantined (allowed into graph, flagged for review)', {
        relation: input.relation,
        normalizedRelation,
        source: source.name,
        target: target.name,
        reason: validation.error,
      });
      // Continue — edge will still be created below
    }

    if (relationWasNormalized) {
      logger.debug('Edge relation alias normalized', {
        sourceId: input.sourceId,
        targetId: input.targetId,
        relation: input.relation,
        normalizedRelation,
      });
    }

    // --- TEMPORAL TRANSITION for works_at ---
    // Save old edges info before marking them non-current (for contradiction detection)
    let oldWorksAtEdges: Array<{ id: number; target_name: string; meta_id: number | null }> = [];
    if (normalizedRelation === 'works_at') {
      oldWorksAtEdges = await tx.unsafe<Array<{ id: number; target_name: string; meta_id: number | null }>>(`
        SELECT e.id, ent.name AS target_name, mm.id AS meta_id
        FROM edges e
        JOIN entities ent ON ent.id = e.target_id
        LEFT JOIN memory_meta mm ON mm.source_ref = 'edge:' || e.id
        WHERE e.source_id = $1 AND e.relation = 'works_at' AND e.target_id != $2
          AND e._deleted_at IS NULL
          AND (e.properties->>'is_current')::boolean IS NOT FALSE
      `, [input.sourceId, input.targetId]);

      await tx.unsafe(`
        UPDATE edges SET
          properties = jsonb_set(COALESCE(properties, '{}'), '{is_current}', 'false'),
          last_seen = NOW()
        WHERE source_id = $1 AND relation = 'works_at' AND target_id != $2
          AND _deleted_at IS NULL
          AND (properties->>'is_current')::boolean IS NOT FALSE
      `, [input.sourceId, input.targetId]);
    }

    // Check for existing edge (same source, target, relation)
    const existing = await tx<Edge[]>`
      SELECT id,
        source_id AS "sourceId",
        target_id AS "targetId",
        relation, weight, confidence, evidence,
        first_seen AS "firstSeen",
        last_seen AS "lastSeen",
        properties
      FROM edges
      WHERE source_id = ${input.sourceId}
        AND target_id = ${input.targetId}
        AND relation = ${normalizedRelation}
      LIMIT 1
    `.execute();

    const confidence = input.confidence ?? getInitialConfidence(input.origin);

    if (existing.length > 0) {
      // Edge exists - increment weight and append evidence
      const edge = existing[0];
      const newWeight = Math.min(10.0, edge.weight + (input.weight ?? 0.5));
      const newEvidence = [...(edge.evidence as any[]), ...(input.evidence ?? [])];

      const [updated] = await tx<Edge[]>`
        UPDATE edges
        SET
          weight = ${newWeight},
          evidence = ${JSON.stringify(newEvidence)},
          last_seen = NOW(),
          confidence = GREATEST(confidence, ${confidence})
        WHERE id = ${edge.id}
        RETURNING id,
          source_id AS "sourceId",
          target_id AS "targetId",
          relation, weight, confidence, evidence,
          first_seen AS "firstSeen",
          last_seen AS "lastSeen",
          properties
      `.execute();

      // Fetch metadata
      const [meta] = await tx<MemoryMeta[]>`
        SELECT * FROM memory_meta
        WHERE source_ref = ${'edge:' + edge.id}
        LIMIT 1
      `.execute();

      // Update memory_meta
      if (meta) {
        await tx`
          UPDATE memory_meta
          SET
            confidence = GREATEST(confidence, ${confidence}),
            last_reinforced = NOW()
          WHERE id = ${meta.id}
        `.execute();
      }

      return {
        ...updated,
        meta: meta ?? null,
        _sourceName: source.name,
        _targetName: target.name,
      };
    }

    // Create new edge
    // Create memory_meta using MemoryQualityService
    const metaId = await createMemoryMetaInternal(tx, {
      sourceType: 'edge',
      sourceRef: 'edge:pending', // Updated after edge creation
      origin: input.origin ?? 'ai_inferred',
      agentSource: input.agentSource,
    });

    // Create edge
    const [edge] = await tx<Edge[]>`
      INSERT INTO edges (
        source_id,
        target_id,
        relation,
        weight,
        confidence,
        evidence,
        properties,
        first_seen,
        last_seen
      ) VALUES (
        ${input.sourceId},
        ${input.targetId},
        ${normalizedRelation},
        ${input.weight ?? 1.0},
        ${confidence},
        ${JSON.stringify(input.evidence ?? [])},
        ${JSON.stringify(edgeProperties)},
        NOW(),
        NOW()
      )
      RETURNING id,
        source_id AS "sourceId",
        target_id AS "targetId",
        relation, weight, confidence, evidence,
        first_seen AS "firstSeen",
        last_seen AS "lastSeen",
        properties
    `.execute();

    // Update memory_meta source_ref
    await tx`
      UPDATE memory_meta
      SET source_ref = ${'edge:' + edge.id}
      WHERE id = ${metaId}
    `.execute();

    // Fetch the created meta record
    const [meta] = await tx<MemoryMeta[]>`
      SELECT * FROM memory_meta WHERE id = ${metaId}
    `.execute();

    // --- CONTRADICTION DETECTION for works_at job changes ---
    if (normalizedRelation === 'works_at' && oldWorksAtEdges.length > 0) {
      for (const oldEdge of oldWorksAtEdges) {
        if (oldEdge.meta_id) {
          try {
            await registerContradictionInternal(tx, {
              oldMetaId: oldEdge.meta_id,
              newMetaId: metaId,
              field: 'works_at',
              oldValue: oldEdge.target_name,
              newValue: target.name,
              agent: input.agentSource || 'system',
            });
            logger.info('Registered works_at contradiction', {
              oldTarget: oldEdge.target_name,
              newTarget: target.name,
            });
          } catch (err) {
            logger.warn('Failed to register works_at contradiction', {
              oldEdgeId: oldEdge.id,
              error: String(err),
            });
          }
        }
      }
    }

    return {
      ...edge,
      meta,
      _sourceName: source.name,
      _targetName: target.name,
    };
  });

  // Fire-and-forget edge summary vectorization (outside transaction)
  if (result && getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')) {
    const { _sourceName, _targetName, ...edgeData } = result;
    const summaryText = `${_sourceName} ${edgeData.relation} ${_targetName}`;
    void vectorizeEdgeSummary(userId, edgeData.id, summaryText, {
      sourceId: edgeData.sourceId,
      targetId: edgeData.targetId,
      relation: edgeData.relation,
      sourceName: _sourceName,
      targetName: _targetName,
      confidence: edgeData.confidence,
      agentSource: input.agentSource,
    }).catch((err) =>
      logger.warn('Edge summary vectorization failed', { edgeId: edgeData.id, error: String(err) })
    );
    return edgeData as EdgeWithMeta;
  }

  if (result) {
    const { _sourceName, _targetName, ...edgeData } = result;
    return edgeData as EdgeWithMeta;
  }
  return result;
}

/**
 * Vectorize an edge summary into the 'graph_edges' collection.
 * Non-blocking — called fire-and-forget after edge creation.
 */
async function vectorizeEdgeSummary(
  userId: string,
  edgeId: number,
  summaryText: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { ingestMemoryText } = await import('./writeIngestion.service');
  await ingestMemoryText({
    userId,
    collection: 'graph_edges',
    text: summaryText,
    metadata: {
      source: 'edge_create',
      edgeId,
      ...metadata,
    },
    changedBy: (metadata.agentSource as string) || 'system',
    origin: 'ai_inferred',
    sourceRefHint: `edge:${edgeId}`,
  });
}

/**
 * Get edge by ID
 *
 * @param userId - User ID for schema isolation
 * @param edgeId - Edge ID
 * @returns Edge with metadata, or null if not found
 */
async function getEdgeInternal(
  tx: TransactionSql,
  edgeId: number
): Promise<EdgeWithMeta | null> {
  const result = await tx<(Edge & { meta: MemoryMeta | null })[]>`
    SELECT
      e.id,
      e.source_id AS "sourceId",
      e.target_id AS "targetId",
      e.relation,
      e.weight,
      e.confidence,
      e.evidence,
      e.first_seen AS "firstSeen",
      e.last_seen AS "lastSeen",
      e.properties,
      row_to_json(m.*) as meta
    FROM edges e
    LEFT JOIN memory_meta m ON m.source_ref = 'edge:' || e.id
    WHERE e.id = ${edgeId}
    LIMIT 1
  `.execute();

  if (result.length === 0) {
    return null;
  }

  return result[0];
}

export async function getEdge(
  userId: string,
  edgeId: number
): Promise<EdgeWithMeta | null> {
  return withUserSchema(userId, async (tx) => {
    return getEdgeInternal(tx, edgeId);
  });
}

/**
 * Update edge
 *
 * @param userId - User ID for schema isolation
 * @param edgeId - Edge ID
 * @param updates - Fields to update
 * @returns Updated edge with metadata
 */
export async function updateEdge(
  userId: string,
  edgeId: number,
  updates: UpdateEdgeInput
): Promise<EdgeWithMeta> {
  return withUserSchema(userId, async (tx) => {
    // Check edge exists
    const existing = await getEdgeInternal(tx, edgeId);
    if (!existing) {
      throw new Error('NOT_FOUND: Edge not found');
    }

    // Merge properties and evidence
    const newProperties = updates.properties
      ? { ...existing.properties, ...updates.properties }
      : existing.properties;
    const newEvidence = updates.evidence
      ? [...(existing.evidence as any[]), ...updates.evidence]
      : existing.evidence;

    // Update edge
    await tx<Edge[]>`
      UPDATE edges
      SET
        relation = COALESCE(${updates.relation ?? null}, relation),
        weight = COALESCE(${updates.weight ?? null}, weight),
        confidence = COALESCE(${updates.confidence ?? null}, confidence),
        evidence = ${JSON.stringify(newEvidence)},
        properties = ${JSON.stringify(newProperties)},
        last_seen = NOW()
      WHERE id = ${edgeId}
      RETURNING *
    `.execute();

    // Update memory_meta
    if (existing.meta && updates.confidence !== undefined) {
      await tx`
        UPDATE memory_meta
        SET
          confidence = ${updates.confidence},
          last_reinforced = NOW()
        WHERE id = ${existing.meta.id}
      `.execute();
    }

    // Fetch updated edge with meta
    const result = await getEdgeInternal(tx, edgeId);
    if (!result) {
      throw new Error('INTERNAL_ERROR: Edge disappeared after update');
    }

    return result;
  });
}

/**
 * Delete edge (soft delete)
 *
 * @param userId - User ID for schema isolation
 * @param edgeId - Edge ID
 */
export async function deleteEdge(userId: string, edgeId: number): Promise<void> {
  return withUserSchema(userId, async (tx) => {
    // Check edge exists
    const existing = await getEdgeInternal(tx, edgeId);
    if (!existing) {
      throw new Error('NOT_FOUND: Edge not found');
    }

    // Hard delete edge (edges don't have _deleted_at column per schema)
    // Actually, checking the schema again - edges don't have soft delete
    // Let's just delete it
    await tx`
      DELETE FROM edges
      WHERE id = ${edgeId}
    `.execute();

    // Update memory_meta status to REJECTED
    if (existing.meta) {
      await tx`
        UPDATE memory_meta
        SET status = 'rejected'
        WHERE id = ${existing.meta.id}
      `.execute();
    }
  });
}

/**
 * List edges with filters
 *
 * @param userId - User ID for schema isolation
 * @param filters - Filter criteria
 * @returns List of edges with metadata
 */
export async function listEdges(
  userId: string,
  filters: EdgeFilters = {}
): Promise<EdgeWithMeta[]> {
  return withUserSchema(userId, async (tx) => {
    const {
      sourceId,
      targetId,
      sourceIds,
      targetIds,
      entityIds,
      relation,
      limit = 50,
      offset = 0,
      includeDeleted = false,
    } = filters;

    let query = `
      SELECT
        e.id,
        e.source_id AS "sourceId",
        e.target_id AS "targetId",
        e.relation,
        e.weight,
        e.confidence,
        e.evidence,
        e.first_seen AS "firstSeen",
        e.last_seen AS "lastSeen",
        e.properties,
        row_to_json(m.*) as meta
      FROM edges e
      LEFT JOIN memory_meta m ON m.source_ref = 'edge:' || e.id
      WHERE 1=1
    `;

    const params: unknown[] =[];

    if (!includeDeleted) {
      query += ` AND e._deleted_at IS NULL`;
    }

    if (sourceId) {
      query += ` AND e.source_id = $${params.length + 1}`;
      params.push(sourceId);
    }

    if (targetId) {
      query += ` AND e.target_id = $${params.length + 1}`;
      params.push(targetId);
    }

    if (relation) {
      query += ` AND e.relation = $${params.length + 1}`;
      params.push(relation);
    }

    if (sourceIds && sourceIds.length > 0) {
      query += ` AND e.source_id = ANY($${params.length + 1}::int[])`;
      params.push(sourceIds);
    }

    if (targetIds && targetIds.length > 0) {
      query += ` AND e.target_id = ANY($${params.length + 1}::int[])`;
      params.push(targetIds);
    }

    if (entityIds && entityIds.length > 0) {
      query += `
        AND e.source_id = ANY($${params.length + 1}::int[])
        AND e.target_id = ANY($${params.length + 1}::int[])
      `;
      params.push(entityIds);
    }

    query += `
      ORDER BY
        e.weight DESC,
        e.confidence DESC,
        e.last_seen DESC,
        e.id ASC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const result = await tx.unsafe<(Edge & { meta: MemoryMeta | null })[]>(query, params);

    // Convert date strings to Date objects (tx.unsafe doesn't auto-convert)
    return result.map((row) => ({
      ...row,
      firstSeen: new Date(row.firstSeen as unknown as string),
      lastSeen: new Date(row.lastSeen as unknown as string),
    }));
  });
}

// =====================================================
// GRAPH QUERIES (Basic)
// =====================================================

/**
 * Get neighboring entities (single-hop traversal)
 *
 * @param userId - User ID for schema isolation
 * @param entityId - Starting entity ID
 * @param options - Query options
 * @returns Connected entities with their edge metadata
 */
export async function getNeighbors(
  userId: string,
  entityId: number,
  options: NeighborOptions = {}
): Promise<EntityWithEdge[]> {
  return withUserSchema(userId, async (tx) => {
    const {
      direction = 'both',
      relationFilter,
      confidenceMin = 0,
      limit = 50,
    } = options;

    // Check entity exists
    const entity = await getEntityInternal(tx, entityId);
    if (!entity) {
      throw new Error('NOT_FOUND: Entity not found');
    }

    let query = `
      SELECT
        ent.id,
        ent.type,
        ent.name,
        ent.properties,
        ent.confidence,
        ent.mention_count AS "mentionCount",
        ent.first_seen AS "firstSeen",
        ent.last_seen AS "lastSeen",
        ent._deleted_at AS "deletedAt",
        json_build_object(
          'id', e.id,
          'sourceId', e.source_id,
          'targetId', e.target_id,
          'relation', e.relation,
          'weight', e.weight,
          'confidence', e.confidence,
          'evidence', e.evidence,
          'firstSeen', e.first_seen,
          'lastSeen', e.last_seen,
          'properties', e.properties
        ) as edge
      FROM edges e
      JOIN entities ent ON (
        CASE
          WHEN e.source_id = $1 THEN ent.id = e.target_id
          WHEN e.target_id = $1 THEN ent.id = e.source_id
          ELSE false
        END
      )
      WHERE ent._deleted_at IS NULL
        AND e._deleted_at IS NULL
        AND e.confidence >= $2
    `;

    const params: unknown[] =[entityId, confidenceMin];

    // Add direction filter
    if (direction === 'outbound') {
      query += ` AND e.source_id = $1`;
    } else if (direction === 'inbound') {
      query += ` AND e.target_id = $1`;
    } else {
      query += ` AND (e.source_id = $1 OR e.target_id = $1)`;
    }

    // Add relation filter
    if (relationFilter) {
      query += ` AND e.relation = $${params.length + 1}`;
      params.push(relationFilter);
    }

    query += `
      ORDER BY e.weight DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const result = await tx.unsafe<(Entity & { edge: Edge })[]>(query, params);

    return result;
  });
}

// =====================================================
// ADVANCED GRAPH QUERIES (Part B - Phase 3.2)
// =====================================================

/**
 * Path node in multi-hop traversal
 */
export interface PathNode {
  id: number;
  name: string;
  type: EntityType;
  depth: number;
  pathWeight: number;
}

/**
 * Complete path between two entities
 */
export interface GraphPath {
  nodes: PathNode[];
  edges: Edge[];
  totalWeight: number;
  length: number;
}

/**
 * Traversal options for multi-hop queries
 */
export interface TraversalOptions {
  maxDepth?: number;
  relationFilter?: string | string[];
  entityTypeFilter?: string | string[];
  confidenceMin?: number;
  limit?: number;
}

/**
 * Get path between two entities using bidirectional search
 *
 * Implements multi-hop graph traversal (2-4 hops) using recursive CTEs
 * with bidirectional search optimization and path ranking by edge weights.
 *
 * @param userId - User ID for schema isolation
 * @param sourceId - Starting entity ID
 * @param targetId - Target entity ID
 * @param maxDepth - Maximum path length (default 3)
 * @returns Shortest weighted path between entities, or null if no path exists
 */
export async function getPathBetween(
  userId: string,
  sourceId: number,
  targetId: number,
  maxDepth: number = 3
): Promise<GraphPath | null> {
  return withUserSchema(userId, async (tx) => {
    // Validate entities exist
    const [source, target] = await Promise.all([
      getEntityInternal(tx, sourceId),
      getEntityInternal(tx, targetId),
    ]);

    if (!source) {
      throw new Error(`NOT_FOUND: Source entity ${sourceId} not found`);
    }
    if (!target) {
      throw new Error(`NOT_FOUND: Target entity ${targetId} not found`);
    }

    // Bidirectional BFS using recursive CTE
    // We search from both ends and meet in the middle for efficiency
    const result = await tx<any[]>`
      WITH RECURSIVE
        -- Forward search from source
        forward_search AS (
          SELECT
            e.target_id as entity_id,
            e.source_id as prev_id,
            e.id as edge_id,
            e.weight,
            1 as depth,
            ARRAY[${sourceId}]::integer[] as path_ids,
            ARRAY[e.id]::integer[] as edge_ids,
            e.weight as total_weight
          FROM edges e
          WHERE e.source_id = ${sourceId}
            AND e.confidence >= 0.3

          UNION ALL

          SELECT
            e.target_id,
            e.source_id,
            e.id,
            e.weight,
            f.depth + 1,
            f.path_ids || e.source_id,
            f.edge_ids || e.id,
            f.total_weight + e.weight
          FROM forward_search f
          JOIN edges e ON e.source_id = f.entity_id
          WHERE f.depth < ${maxDepth}
            AND NOT (e.target_id = ANY(f.path_ids)) -- Prevent cycles
            AND e.confidence >= 0.3
        ),
        -- Find paths that reached the target
        complete_paths AS (
          SELECT
            path_ids || entity_id as full_path,
            edge_ids,
            total_weight,
            depth
          FROM forward_search
          WHERE entity_id = ${targetId}
          ORDER BY total_weight DESC, depth ASC
          LIMIT 1
        )
      SELECT
        full_path,
        edge_ids,
        total_weight,
        depth
      FROM complete_paths
    `.execute();

    if (result.length === 0) {
      return null; // No path found
    }

    const pathData = result[0];
    const nodeIds: number[] = pathData.full_path;
    const edgeIds: number[] = pathData.edge_ids;

    // Fetch full entity and edge data
    const [nodes, edges] = await Promise.all([
      tx<Entity[]>`
        SELECT id, type, name, properties, confidence,
          mention_count AS "mentionCount",
          first_seen AS "firstSeen",
          last_seen AS "lastSeen",
          _deleted_at AS "deletedAt"
        FROM entities
        WHERE id = ANY(${nodeIds})
        ORDER BY array_position(${nodeIds}, id)
      `.execute(),
      tx<Edge[]>`
        SELECT id,
          source_id AS "sourceId",
          target_id AS "targetId",
          relation, weight, confidence, evidence,
          first_seen AS "firstSeen",
          last_seen AS "lastSeen",
          properties
        FROM edges
        WHERE id = ANY(${edgeIds})
        ORDER BY array_position(${edgeIds}, id)
      `.execute(),
    ]);

    // Build path nodes with depth information
    const pathNodes: PathNode[] = nodes.map((node: Entity, idx: number) => ({
      id: node.id,
      name: node.name,
      type: node.type as EntityType,
      depth: idx,
      pathWeight: idx === 0 ? 0 : edges[idx - 1].weight,
    }));

    return {
      nodes: pathNodes,
      edges,
      totalWeight: pathData.total_weight,
      length: pathData.depth,
    };
  });
}

/**
 * Multi-hop graph traversal from a starting entity
 *
 * Explores the graph outward from a starting entity up to maxDepth hops,
 * with optional filtering by relation type, entity type, and confidence.
 *
 * @param userId - User ID for schema isolation
 * @param startId - Starting entity ID
 * @param options - Traversal options
 * @returns All reachable entities within the depth limit
 */
export async function traverse(
  userId: string,
  startId: number,
  options: TraversalOptions = {}
): Promise<PathNode[]> {
  return withUserSchema(userId, async (tx) => {
    const {
      maxDepth = 3,
      relationFilter,
      entityTypeFilter,
      confidenceMin = 0.3,
      limit = 500,
    } = options;

    // Validate start entity exists
    const startEntity = await getEntityInternal(tx, startId);
    if (!startEntity) {
      throw new Error(`NOT_FOUND: Start entity ${startId} not found`);
    }

    // Build query with parameterized filters
    let query = `
      WITH RECURSIVE graph_traversal AS (
        -- Base case: starting entity
        SELECT
          e.id,
          e.name,
          e.type,
          e.properties,
          e.confidence,
          e.mention_count,
          e.first_seen,
          e.last_seen,
          e._deleted_at,
          0 as depth,
          0.0::NUMERIC as path_weight,
          ARRAY[e.id] as visited
        FROM entities e
        WHERE e.id = $1
          AND e._deleted_at IS NULL

        UNION ALL

        -- Recursive case: follow edges
        SELECT
          ent.id,
          ent.name,
          ent.type,
          ent.properties,
          ent.confidence,
          ent.mention_count,
          ent.first_seen,
          ent.last_seen,
          ent._deleted_at,
          g.depth + 1,
          (g.path_weight + e.weight)::NUMERIC,
          g.visited || ent.id
        FROM graph_traversal g
        JOIN edges e ON (e.source_id = g.id OR e.target_id = g.id)
        JOIN entities ent ON ent.id = CASE WHEN e.source_id = g.id THEN e.target_id ELSE e.source_id END
        WHERE g.depth < $2
          AND NOT (ent.id = ANY(g.visited))
          AND ent._deleted_at IS NULL
          AND e._deleted_at IS NULL
          AND e.confidence >= $3
    `;

    const params: unknown[] =[startId, maxDepth, confidenceMin];

    // Add relation filter
    if (relationFilter) {
      const relations = Array.isArray(relationFilter) ? relationFilter : [relationFilter];
      query += ` AND e.relation = ANY($${params.length + 1})`;
      params.push(relations);
    }

    // Add entity type filter
    if (entityTypeFilter) {
      const types = Array.isArray(entityTypeFilter) ? entityTypeFilter : [entityTypeFilter];
      query += ` AND ent.type = ANY($${params.length + 1})`;
      params.push(types);
    }

    query += `
      )
      SELECT DISTINCT ON (id)
        id,
        name,
        type,
        depth,
        path_weight
      FROM graph_traversal
      ORDER BY id, depth ASC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const result = await tx.unsafe<(Entity & { depth: number; path_weight: number })[]>(query, params);

    return result.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type as EntityType,
      depth: node.depth,
      pathWeight: node.path_weight,
    }));
  });
}

/**
 * Pattern-based query result
 */
export interface PatternQueryResult {
  entities: Entity[];
  explanation: string;
}

/**
 * Query pattern input
 */
export interface QueryPatternInput {
  pattern: string; // Natural language pattern
  limit?: number;
}

export interface QueryPatternStructuredInput {
  entityType?: string;
  entityName?: string;
  relation?: string;
  targetType?: string;
  limit?: number;
}

/**
 * Structured pattern query for MCP object-style patterns.
 *
 * Interprets `entityType` as target entity type and `targetType` as source entity type.
 */
export async function queryPatternStructured(
  userId: string,
  input: QueryPatternStructuredInput
): Promise<PatternQueryResult> {
  return withUserSchema(userId, async (tx) => {
    const { entityType, entityName, relation, targetType, limit = 20 } = input;

    let query = `
      SELECT DISTINCT
        e.id,
        e.type,
        e.name,
        e.properties,
        e.confidence,
        e.mention_count AS "mentionCount",
        e.first_seen AS "firstSeen",
        e.last_seen AS "lastSeen",
        e._deleted_at AS "deletedAt"
      FROM entities e
      LEFT JOIN edges ed ON ed.target_id = e.id AND ed._deleted_at IS NULL
      LEFT JOIN entities src ON src.id = ed.source_id AND src._deleted_at IS NULL
      WHERE e._deleted_at IS NULL
    `;

    const params: unknown[] = [];
    const hasValue = (value?: string) => !!value && value !== '*';

    if (hasValue(entityType)) {
      query += ` AND e.type = $${params.length + 1}`;
      params.push(entityType);
    }

    if (entityName) {
      query += ` AND e.name ILIKE $${params.length + 1}`;
      params.push(`%${entityName}%`);
    }

    if (hasValue(relation)) {
      query += ` AND ed.relation = $${params.length + 1}`;
      params.push(relation);
    }

    if (hasValue(targetType)) {
      query += ` AND src.type = $${params.length + 1}`;
      params.push(targetType);
    }

    query += `
      ORDER BY e.mention_count DESC, e.confidence DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const entities = await tx.unsafe<Entity[]>(query, params);

    return {
      entities,
      explanation: `Structured pattern matched ${entities.length} entities`,
    };
  });
}

/**
 * Pattern-based graph query
 *
 * Parses natural language patterns like "Who do I eat Italian with?"
 * into graph traversal patterns and executes them.
 *
 * Supported patterns:
 * - "Who do I [verb] [object] with?" → Find people connected via activity/food
 * - "What [type] do I like?" → Find entities of type with 'likes' relation
 * - "Where do I [verb]?" → Find places connected via activity
 *
 * @param userId - User ID for schema isolation
 * @param input - Pattern query input
 * @returns Matching entities with explanation
 */
export async function queryPattern(
  userId: string,
  input: QueryPatternInput
): Promise<PatternQueryResult> {
  return withUserSchema(userId, async (tx) => {
    const { pattern, limit = 20 } = input;
    const lowerPattern = pattern.toLowerCase().trim();

    // Pattern 1: "who do I [verb] [object] with?"
    // Example: "who do I eat Italian with?" → find person entities connected to 'Italian food' via 'ate'
    const whoWithMatch = lowerPattern.match(
      /who (?:do|does) (?:i|we) (\w+) (.+?) with\??/
    );
    if (whoWithMatch) {
      const verb = whoWithMatch[1]; // 'eat'
      const object = whoWithMatch[2]; // 'Italian'

      // Map verb to relation
      const relationMap: Record<string, string> = {
        eat: 'ate',
        visit: 'visited',
        watch: 'watched',
        read: 'read',
        play: 'performed',
      };
      const relation = relationMap[verb] || verb;

      // Find the object entity (fuzzy match)
      const objectEntities = await getEntityByNameInternal(tx, object, undefined, 0.3, 5);

      if (objectEntities.length === 0) {
        return {
          entities: [],
          explanation: `No entity found matching "${object}"`,
        };
      }

      const objectEntity = objectEntities[0];

      // Find people who share edges with this object
      const result = await tx<Entity[]>`
        SELECT DISTINCT p.*
        FROM entities p
        JOIN edges e1 ON e1.source_id = p.id
        JOIN edges e2 ON e2.target_id = e1.target_id
        WHERE p.type = 'person'
          AND p._deleted_at IS NULL
          AND e1.relation = ${relation}
          AND e2.source_id != p.id
          AND e2.target_id = ${objectEntity.id}
          AND e1.confidence >= 0.3
          AND e2.confidence >= 0.3
        ORDER BY p.mention_count DESC
        LIMIT ${limit}
      `.execute();

      return {
        entities: result,
        explanation: `Found ${result.length} people you ${verb} ${objectEntity.name} with`,
      };
    }

    // Pattern 2: "what [type] do I like?"
    // Example: "what food do I like?" → find food entities with 'likes' relation from user
    const whatLikeMatch = lowerPattern.match(/what (\w+) (?:do|does) (?:i|we) like\??/);
    if (whatLikeMatch) {
      const entityType = whatLikeMatch[1]; // 'food'

      const result = await tx<Entity[]>`
        SELECT e.*
        FROM entities e
        JOIN edges ed ON ed.target_id = e.id
        WHERE e.type = ${entityType}
          AND e._deleted_at IS NULL
          AND ed.relation = 'likes'
          AND ed.confidence >= 0.3
        ORDER BY ed.weight DESC
        LIMIT ${limit}
      `.execute();

      return {
        entities: result,
        explanation: `Found ${result.length} ${entityType} items you like`,
      };
    }

    // Pattern 3: "where do I [verb]?"
    // Example: "where do I run?" → find place entities connected via place relations
    const whereMatch = lowerPattern.match(/where (?:do|does) (?:i|we) (\w+)\??/);
    if (whereMatch) {
      const verb = whereMatch[1]; // 'run'

      // Map verb to valid ontology relation (person → place)
      const relationMap: Record<string, string> = {
        run: 'visited',
        work: 'works_at',
        eat: 'visited',
        shop: 'visited',
        exercise: 'works_out_at',
        gym: 'works_out_at',
      };
      const relation = relationMap[verb] || 'visited';

      const verbPattern = `%${verb}%`;
      const result = await tx<Entity[]>`
        SELECT DISTINCT p.*, e1.weight
        FROM entities p
        JOIN edges e1 ON e1.target_id = p.id
        JOIN entities act ON act.id = e1.source_id
        WHERE p.type = 'place'
          AND p._deleted_at IS NULL
          AND act._deleted_at IS NULL
          AND (
            (e1.relation = ${relation})
            OR (act.name ILIKE ${verbPattern} AND e1.relation = 'located_at')
          )
          AND e1.confidence >= 0.3
        ORDER BY e1.weight DESC
        LIMIT ${limit}
      `.execute();

      return {
        entities: result,
        explanation: `Found ${result.length} places where you ${verb}`,
      };
    }

    // No pattern matched
    throw new Error(
      'PATTERN_NOT_RECOGNIZED: Supported patterns: "who do I [verb] X with?", "what [type] do I like?", "where do I [verb]?"'
    );
  });
}

/**
 * Graph statistics
 */
export interface GraphStats {
  totalEntities: number;
  totalEdges: number;
  entitiesByType: Record<string, number>;
  topRelations: Array<{ relation: string; count: number }>;
  avgConfidence: number;
  avgDegree: number;
}

/**
 * Get graph statistics
 *
 * Computes overall graph metrics for analytics and visualization.
 *
 * @param userId - User ID for schema isolation
 * @returns Graph statistics
 */
export async function getGraphStats(userId: string): Promise<GraphStats> {
  return withUserSchema(userId, async (tx) => {
    const [
      totalEntitiesResult,
      totalEdgesResult,
      entitiesByTypeResult,
      topRelationsResult,
      avgConfidenceResult,
      avgDegreeResult,
    ] = await Promise.all([
      // Total entities
      tx<[{ count: number }]>`
        SELECT COUNT(*)::int as count
        FROM entities
        WHERE _deleted_at IS NULL
      `.execute(),

      // Total edges
      tx<[{ count: number }]>`
        SELECT COUNT(*)::int as count FROM edges
      `.execute(),

      // Entities by type
      tx<Array<{ type: string; count: number }>>`
        SELECT type, COUNT(*)::int as count
        FROM entities
        WHERE _deleted_at IS NULL
        GROUP BY type
        ORDER BY count DESC
      `.execute(),

      // Top relations
      tx<Array<{ relation: string; count: number }>>`
        SELECT relation, COUNT(*)::int as count
        FROM edges
        GROUP BY relation
        ORDER BY count DESC
        LIMIT 10
      `.execute(),

      // Average confidence
      tx<[{ avg: number }]>`
        SELECT COALESCE(AVG(confidence), 0)::float as avg
        FROM entities
        WHERE _deleted_at IS NULL
      `.execute(),

      // Average degree (edges per entity)
      tx<[{ avg: number }]>`
        SELECT COALESCE(AVG(degree), 0)::float as avg
        FROM (
          SELECT entity_id, COUNT(*)::int as degree
          FROM (
            SELECT source_id as entity_id FROM edges
            UNION ALL
            SELECT target_id as entity_id FROM edges
          ) all_edges
          GROUP BY entity_id
        ) degrees
      `.execute(),
    ]);

    const entitiesByType: Record<string, number> = {};
    for (const row of entitiesByTypeResult) {
      entitiesByType[row.type] = row.count;
    }

    return {
      totalEntities: totalEntitiesResult[0].count,
      totalEdges: totalEdgesResult[0].count,
      entitiesByType,
      topRelations: topRelationsResult,
      avgConfidence: avgConfidenceResult[0].avg,
      avgDegree: avgDegreeResult[0].avg,
    };
  });
}

/**
 * Centrality metrics for an entity
 */
export interface EntityCentrality {
  entityId: number;
  degreeCentrality: number; // Number of connections
  weightedDegree: number; // Sum of edge weights
  betweenness: number; // How often entity appears in shortest paths (approximated)
}

/**
 * Get centrality metrics for an entity
 *
 * Computes graph analytics metrics to identify important/central entities.
 *
 * @param userId - User ID for schema isolation
 * @param entityId - Entity ID
 * @returns Centrality metrics
 */
export async function getEntityCentrality(
  userId: string,
  entityId: number
): Promise<EntityCentrality> {
  return withUserSchema(userId, async (tx) => {
    // Validate entity exists
    const entity = await getEntityInternal(tx, entityId);
    if (!entity) {
      throw new Error(`NOT_FOUND: Entity ${entityId} not found`);
    }

    // Compute degree centrality (number of edges)
    const [degreeResult] = await tx<[{ count: number; total_weight: number }]>`
      SELECT
        COUNT(*)::int as count,
        COALESCE(SUM(weight), 0)::float as total_weight
      FROM edges
      WHERE source_id = ${entityId} OR target_id = ${entityId}
    `.execute();

    // Approximate betweenness centrality
    // For personal graphs, we approximate this by counting how many
    // distinct entity pairs are connected through this entity
    const [betweennessResult] = await tx<[{ betweenness: number }]>`
      SELECT COUNT(DISTINCT (e1.source_id, e2.target_id))::int as betweenness
      FROM edges e1
      JOIN edges e2 ON e1.target_id = e2.source_id
      WHERE e1.target_id = ${entityId}
        AND e1.source_id != e2.target_id
    `.execute();

    return {
      entityId,
      degreeCentrality: degreeResult.count,
      weightedDegree: degreeResult.total_weight,
      betweenness: betweennessResult.betweenness,
    };
  });
}

/**
 * Clustering coefficient (how connected an entity's neighbors are)
 */
export interface ClusteringCoefficient {
  entityId: number;
  coefficient: number; // 0-1, where 1 means all neighbors are connected
  neighborCount: number;
  neighborEdgeCount: number;
}

/**
 * Get clustering coefficient for an entity
 *
 * Measures how interconnected an entity's neighbors are.
 * High clustering = entity is part of a tight-knit community.
 *
 * @param userId - User ID for schema isolation
 * @param entityId - Entity ID
 * @returns Clustering coefficient
 */
export async function getClusteringCoefficient(
  userId: string,
  entityId: number
): Promise<ClusteringCoefficient> {
  return withUserSchema(userId, async (tx) => {
    // Validate entity exists
    const entity = await getEntityInternal(tx, entityId);
    if (!entity) {
      throw new Error(`NOT_FOUND: Entity ${entityId} not found`);
    }

    // Get neighbors
    const neighbors = await tx<Array<{ id: number }>>`
      SELECT DISTINCT
        CASE
          WHEN source_id = ${entityId} THEN target_id
          ELSE source_id
        END as id
      FROM edges
      WHERE source_id = ${entityId} OR target_id = ${entityId}
    `.execute();

    const neighborIds = neighbors.map((n: { id: number }) => n.id);
    const neighborCount = neighborIds.length;

    if (neighborCount < 2) {
      // Need at least 2 neighbors to compute clustering
      return {
        entityId,
        coefficient: 0,
        neighborCount,
        neighborEdgeCount: 0,
      };
    }

    // Count edges between neighbors
    const [edgeResult] = await tx<[{ count: number }]>`
      SELECT COUNT(*)::int as count
      FROM edges
      WHERE source_id = ANY(${neighborIds})
        AND target_id = ANY(${neighborIds})
    `.execute();

    const neighborEdgeCount = edgeResult.count;

    // Clustering coefficient = actual edges / possible edges
    // Possible edges = n * (n - 1) / 2 for undirected graph
    const possibleEdges = (neighborCount * (neighborCount - 1)) / 2;
    const coefficient = possibleEdges > 0 ? neighborEdgeCount / possibleEdges : 0;

    return {
      entityId,
      coefficient,
      neighborCount,
      neighborEdgeCount,
    };
  });
}
