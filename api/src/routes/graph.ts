/**
 * Graph Routes
 *
 * Knowledge graph endpoints for entities, edges, and graph queries
 *
 * Reference: EPITOME_TECH_SPEC.md §6.4
 * Reference: knowledge-graph SKILL.md
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import { requireAuth } from '@/middleware/auth';
import { expensiveOperationRateLimit } from '@/middleware/rateLimit';
import { getEffectiveTier } from '@/services/metering.service';
import { logger } from '@/utils/logger';
import {
  createEntity,
  getEntity,
  updateEntity,
  deleteEntity,
  listEntities,
  listEdges,
  getEntityByName,
  createEdge,
  getNeighbors,
  traverse,
  getPathBetween,
  queryPattern,
  getGraphStats,
  getEntityCentrality,
} from '@/services/graphService';
import { mergeEntities } from '@/services/deduplication';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';
import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import {
  entityIdSchema,
  createEntitySchema,
  updateEntitySchema,
  mergeEntitySchema,
  entityListQuerySchema,
  entityNeighborsQuerySchema,
  createEdgeSchema,
  graphQuerySchema,
  traverseSchema,
  pathQuerySchema,
  patternQuerySchema,
} from '@/validators/graph';

const graph = new Hono<HonoEnv>();
// Note: Stable mode currently only filters entities, not edges.
// Edges are already scoped to visible entities by listEdges() SQL.
// If re-adding edge filtering, include 'ai_inferred' and 'ai_pattern'
// origins and 'unvetted' status, or use a separate lower threshold.

function isSyntheticThreadEntity(entity: {
  type: string;
  name: string;
  properties?: Record<string, unknown>;
}): boolean {
  if (entity.type !== 'event') return false;

  const props = entity.properties;
  if (!props || typeof props !== 'object') return false;

  const table = props.table;
  const recordId = props.record_id;
  if (typeof table !== 'string' || table.trim() === '') return false;
  if (!(typeof recordId === 'number' || (typeof recordId === 'string' && /^\d+$/.test(recordId)))) {
    return false;
  }

  return /^[a-z0-9_]+_\d+$/i.test(entity.name);
}

function unwrapBody<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  if (
    'body' in payload &&
    typeof payload.body === 'object' &&
    payload.body !== null &&
    !Array.isArray(payload.body)
  ) {
    return payload.body as Record<string, unknown>;
  }

  return payload;
}

// =====================================================
// ENTITY ENDPOINTS
// =====================================================

/**
 * GET /v1/graph/entities
 *
 * List entities with optional filters
 */
graph.get(
  '/entities',
  requireAuth,
  zValidator('query', entityListQuerySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const filters = c.req.valid('query');
    const {
      includeSynthetic,
      edgeLimit,
      edgeOffset,
      stableMode,
      stableConfidenceMin,
      ...entityFilters
    } = filters;

    logger.debug('GET /entities', { userId, agentId, authType });

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'graph/entities', 'read');
    }

    const entities = await listEntities(userId, entityFilters);
    const visibleEntities = includeSynthetic
      ? entities
      : entities.filter((entity) => !isSyntheticThreadEntity(entity));

    const visibleEntityIds = visibleEntities.map((entity) => entity.id);
    let scopedEdges = visibleEntityIds.length > 0
      ? await listEdges(userId, {
          entityIds: visibleEntityIds,
          limit: edgeLimit,
          offset: edgeOffset,
        })
      : [];

    logger.debug('listEntities returned', {
      count: entities.length,
      visibleCount: visibleEntities.length,
      edgeCount: scopedEdges.length,
      includeSynthetic,
      edgeLimit,
      edgeOffset,
      stableMode,
      stableConfidenceMin,
    });

    // Log audit entry (skip for session/dashboard polling to avoid flooding)
    if (authType !== 'session') {
      await logAuditEntry(userId, {
        agentId: agentId || 'user',
        action: 'query',
        resource: 'graph/entities',
        details: {
          filters,
          resultCount: visibleEntities.length,
        },
      });
    }

    return c.json({
      entities: visibleEntities.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        properties: e.properties,
        confidence: e.confidence,
        mention_count: e.mentionCount,
        first_seen: e.firstSeen.toISOString(),
        last_seen: e.lastSeen.toISOString(),
        meta: e.meta
          ? {
              id: e.meta.id,
              status: e.meta.status,
              origin: e.meta.origin,
              confidence: e.meta.confidence,
            }
          : null,
      })),
      edges: scopedEdges.map((e) => ({
        id: e.id,
        source_id: e.sourceId,
        target_id: e.targetId,
        relation: e.relation,
        weight: e.weight,
        confidence: e.confidence,
        status: e.meta?.status ?? null,
        origin: e.meta?.origin ?? null,
      })),
      meta: {
        total: visibleEntities.length,
        edge_total: scopedEdges.length,
        filters: entityFilters,
        includeSynthetic,
        edge_pagination: {
          limit: edgeLimit,
          offset: edgeOffset,
          hasMore: scopedEdges.length === edgeLimit,
        },
        stableMode,
        stableConfidenceMin,
      },
    });
  }
);

/**
 * POST /v1/graph/entities
 *
 * Create a new entity
 */
graph.post(
  '/entities',
  requireAuth,
  zValidator('json', createEntitySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { body } = c.req.valid('json');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'graph/entities', 'write');
    }

    // Determine origin
    const origin = body.origin || (authType === 'session' ? 'user_stated' : 'ai_inferred');
    const tier = getEffectiveTier(c);

    const entity = await createEntity(userId, {
      ...body,
      origin,
      agentSource: agentId,
    }, tier);

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'write',
      resource: 'graph/entities',
      details: {
        entityId: entity.id,
        type: entity.type,
        name: entity.name,
      },
    });

    return c.json(
      {
        data: {
          id: entity.id,
          type: entity.type,
          name: entity.name,
          properties: entity.properties,
          confidence: entity.confidence,
          mentionCount: entity.mentionCount,
          firstSeen: entity.firstSeen.toISOString(),
          lastSeen: entity.lastSeen.toISOString(),
        },
        meta: {},
      },
      201
    );
  }
);

/**
 * GET /v1/graph/entities/:id
 *
 * Get entity by ID
 */
graph.get('/entities/:id', requireAuth, zValidator('param', entityIdSchema), async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');
  const { id } = c.req.valid('param');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'graph/entities', 'read');
  }

  const entity = await  getEntity(userId, id);

  if (!entity) {
    return c.json({ error: 'Entity not found' }, 404);
  }

  // Log audit entry (skip for session/dashboard polling to avoid flooding)
  if (authType !== 'session') {
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'read',
      resource: `graph/entities/${id}`,
      details: {
        entityType: entity.type,
        entityName: entity.name,
      },
    });
  }

  return c.json({
    id: entity.id,
    type: entity.type,
    name: entity.name,
    properties: entity.properties,
    confidence: entity.confidence,
    mentionCount: entity.mentionCount,
    firstSeen: entity.firstSeen.toISOString(),
    lastSeen: entity.lastSeen.toISOString(),
    meta: entity.meta
      ? {
          id: entity.meta.id,
          status: entity.meta.status,
          origin: entity.meta.origin,
          confidence: entity.meta.confidence,
          accessCount: entity.meta.accessCount,
        }
      : null,
  });
});

/**
 * PATCH /v1/graph/entities/:id
 *
 * Update entity
 */
graph.patch(
  '/entities/:id',
  requireAuth,
  zValidator('param', entityIdSchema),
  zValidator('json', updateEntitySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { id } = c.req.valid('param');
    const payload = c.req.valid('json') as Record<string, unknown>;
    const body = unwrapBody(payload) as {
      name?: string;
      properties?: Record<string, unknown>;
      confidence?: number;
    };

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'graph/entities', 'write');
    }

    try {
      const entity = await updateEntity(userId, id, body);

      // Log audit entry
      await logAuditEntry(userId, {
        agentId: agentId || 'user',
        action: 'write',
        resource: `graph/entities/${id}`,
        details: {
          updates: body,
        },
      });

      return c.json({
        data: {
          id: entity.id,
          type: entity.type,
          name: entity.name,
          properties: entity.properties,
          confidence: entity.confidence,
          lastSeen: entity.lastSeen.toISOString(),
        },
        meta: {},
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
        return c.json({ error: 'Entity not found' }, 404);
      }
      throw error;
    }
  }
);

/**
 * POST /v1/graph/entities/:id/merge
 *
 * Merge source entity into target entity
 */
graph.post(
  '/entities/:id/merge',
  requireAuth,
  zValidator('param', entityIdSchema),
  zValidator('json', mergeEntitySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { id: sourceId } = c.req.valid('param');
    const payload = c.req.valid('json') as Record<string, unknown>;
    const body = unwrapBody(payload) as { targetId?: number; target_id?: number };
    const targetIdRaw = body.targetId ?? body.target_id;
    const targetId = Number(targetIdRaw);

    if (!Number.isInteger(targetId) || targetId <= 0) {
      return c.json({ error: 'targetId (or target_id) is required' }, 400);
    }

    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'graph/entities', 'write');
    }

    try {
      await mergeEntities(userId, sourceId, targetId);
      const mergedTarget = await getEntity(userId, targetId);

      await logAuditEntry(userId, {
        agentId: agentId || 'user',
        action: 'write',
        resource: `graph/entities/${sourceId}/merge`,
        details: {
          sourceId,
          targetId,
          merged: true,
        },
      });

      return c.json({
        data: {
          sourceId,
          targetId,
          entity: mergedTarget
            ? {
                id: mergedTarget.id,
                type: mergedTarget.type,
                name: mergedTarget.name,
                properties: mergedTarget.properties,
                confidence: mergedTarget.confidence,
                mentionCount: mergedTarget.mentionCount,
                firstSeen: mergedTarget.firstSeen.toISOString(),
                lastSeen: mergedTarget.lastSeen.toISOString(),
              }
            : null,
        },
        meta: {},
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: 'Source or target entity not found' }, 404);
      }
      if (error instanceof Error && error.message.includes('itself')) {
        return c.json({ error: 'Cannot merge an entity with itself' }, 400);
      }
      throw error;
    }
  }
);

/**
 * DELETE /v1/graph/entities/:id
 *
 * Soft delete entity
 */
graph.delete(
  '/entities/:id',
  requireAuth,
  zValidator('param', entityIdSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { id } = c.req.valid('param');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'graph/entities', 'write');
    }

    try {
      await deleteEntity(userId, id);

      // Log audit entry
      await logAuditEntry(userId, {
        agentId: agentId || 'user',
        action: 'delete',
        resource: `graph/entities/${id}`,
        details: {},
      });

      return c.json({ data: { deleted: true }, meta: {} });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
        return c.json({ error: 'Entity not found' }, 404);
      }
      throw error;
    }
  }
);

/**
 * GET /v1/graph/entities/:id/neighbors
 *
 * Get neighboring entities (single-hop)
 */
graph.get(
  '/entities/:id/neighbors',
  requireAuth,
  zValidator('param', entityIdSchema),
  zValidator('query', entityNeighborsQuerySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { id } = c.req.valid('param');
    const options = c.req.valid('query');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'graph/entities', 'read');
    }

    try {
      const neighbors = await getNeighbors(userId, id, {
        direction: options.direction,
        relationFilter: options.relation,
        confidenceMin: options.confidenceMin,
        limit: options.limit,
      });

      // Log audit entry (skip for session/dashboard polling to avoid flooding)
      if (authType !== 'session') {
        await logAuditEntry(userId, {
          agentId: agentId || 'user',
          action: 'query',
          resource: `graph/entities/${id}/neighbors`,
          details: {
            direction: options.direction,
            resultCount: neighbors.length,
          },
        });
      }

      return c.json({
        neighbors: neighbors.map((n) => {
          // Edge is returned as JSON from postgres, need to parse if it's a string
          const edge = typeof n.edge === 'string' ? JSON.parse(n.edge) : n.edge;

          return {
            entity: {
              id: n.id,
              type: n.type,
              name: n.name,
              properties: n.properties,
              confidence: n.confidence,
              mention_count: n.mentionCount,
              first_seen: n.firstSeen instanceof Date ? n.firstSeen.toISOString() : n.firstSeen,
              last_seen: n.lastSeen instanceof Date ? n.lastSeen.toISOString() : n.lastSeen,
            },
            // Flatten relation to top level (test expects neighbors[0].relation)
            relation: edge.relation,
            weight: edge.weight,
            edgeConfidence: edge.confidence,
            sourceId: edge.source_id,
            targetId: edge.target_id,
          };
        }),
        meta: {
          total: neighbors.length,
          entityId: id,
          options,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
        return c.json({ error: 'Entity not found' }, 404);
      }
      throw error;
    }
  }
);

/**
 * GET /v1/graph/entities/:id/centrality
 *
 * Get centrality metrics for entity
 */
graph.get(
  '/entities/:id/centrality',
  requireAuth,
  zValidator('param', entityIdSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { id } = c.req.valid('param');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'graph/analytics', 'read');
    }

    try {
      const centrality = await  getEntityCentrality(userId, id);

      // Log audit entry
      await logAuditEntry(userId, {
        agentId: agentId || 'user',
        action: 'query',
        resource: `graph/entities/${id}/centrality`,
        details: {},
      });

      return c.json({
        data: centrality,
        meta: {},
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
        return c.json({ error: 'Entity not found' }, 404);
      }
      throw error;
    }
  }
);

// =====================================================
// EDGE ENDPOINTS
// =====================================================

/**
 * POST /v1/graph/edges
 *
 * Create edge between entities
 */
graph.post('/edges', requireAuth, zValidator('json', createEdgeSchema), async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');
  const { body } = c.req.valid('json');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'graph/edges', 'write');
  }

  // Determine origin
  const origin = body.origin || (authType === 'session' ? 'user_stated' : 'ai_inferred');

  try {
    const edge = await createEdge(userId, {
      ...body,
      origin,
      agentSource: agentId,
    });

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'write',
      resource: 'graph/edges',
      details: {
        edgeId: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relation: edge.relation,
      },
    });

    return c.json(
      {
        data: {
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          relation: edge.relation,
          weight: edge.weight,
          confidence: edge.confidence,
          evidence: edge.evidence,
          properties: edge.properties,
          firstSeen: edge.firstSeen.toISOString(),
          lastSeen: edge.lastSeen.toISOString(),
        },
        meta: {},
      },
      201
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      return c.json({ error: error.message.replace('NOT_FOUND: ', '') }, 404);
    }
    throw error;
  }
});

// =====================================================
// GRAPH QUERY ENDPOINTS
// =====================================================

/**
 * POST /v1/graph/query
 *
 * Query graph: structured params (semantic search) OR SQL (sandboxed)
 * H-3 SECURITY: Expensive operation rate limited to 100 req/min
 */
graph.post(
  '/query',
  requireAuth,
  expensiveOperationRateLimit, // H-3 Security Fix
  zValidator('json', graphQuerySchema),
  async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');
  const params = c.req.valid('json');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'graph/query', 'read');
  }

  try {
    // Mode 1: Semantic search by name (structured params)
    if (params.query) {
      const results = await getEntityByName(
        userId,
        params.query,
        params.type,
        0.3, // similarity threshold
        params.limit || 10
      );

      // Log audit entry
      await logAuditEntry(userId, {
        agentId: agentId || 'user',
        action: 'query',
        resource: 'graph/query',
        details: {
          mode: 'semantic_search',
          query: params.query,
          type: params.type,
          resultCount: results.length,
        },
      });

      return c.json({
        results: results.map((r) => ({
          id: r.id,
          type: r.type,
          name: r.name,
          properties: r.properties,
          confidence: r.confidence,
          similarity: r.similarity,
        })),
        meta: {
          query: params.query,
          type: params.type,
          resultCount: results.length,
        },
      });
    }

    // Mode 2: SQL query (sandboxed execution)
    if (params.sql) {
      const result = await executeSandboxedQuery(
        userId,
        params.sql,
        params.timeout,
        params.limit
      );

      // Log audit entry
      await logAuditEntry(userId, {
        agentId: agentId || 'user',
        action: 'query',
        resource: 'graph/query',
        details: {
          mode: 'sql',
          sqlLength: params.sql.length,
          rowCount: result.rowCount,
          executionTime: result.executionTime,
        },
      });

      return c.json({
        results: result.rows,
        meta: {
          rowCount: result.rowCount,
          executionTime: result.executionTime,
        },
      });
    }

    // Neither query nor sql provided
    return c.json({ error: 'Must provide either query or sql parameter' }, 400);
  } catch (error: unknown) {
    if (error instanceof Error && error.message?.startsWith('SQL_SANDBOX_ERROR')) {
      return c.json(
        {
          error: error.message.replace('SQL_SANDBOX_ERROR: ', ''),
        },
        400
      );
    }
    throw error;
  }
});

/**
 * POST /v1/graph/traverse
 *
 * Multi-hop graph traversal
 * H-3 SECURITY: Expensive operation rate limited to 100 req/min
 */
graph.post(
  '/traverse',
  requireAuth,
  expensiveOperationRateLimit, // H-3 Security Fix
  zValidator('json', traverseSchema),
  async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');
  const params = c.req.valid('json');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'graph/traverse', 'read');
  }

  try {
    const nodes = await traverse(userId, params.startId, {
      maxDepth: params.maxDepth,
      relationFilter: params.relationFilter,
      entityTypeFilter: params.entityTypeFilter,
      confidenceMin: params.confidenceMin,
      limit: params.limit,
    });

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'query',
      resource: 'graph/traverse',
      details: {
        startId: params.startId,
        maxDepth: params.maxDepth,
        resultCount: nodes.length,
      },
    });

    return c.json({
      paths: nodes,
      meta: {
        total: nodes.length,
        startId: params.startId,
        maxDepth: params.maxDepth,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      return c.json({ error: error.message.replace('NOT_FOUND: ', '') }, 404);
    }
    throw error;
  }
});

/**
 * POST /v1/graph/path
 *
 * Find path between two entities
 * H-3 SECURITY: Expensive operation rate limited to 100 req/min
 */
graph.post(
  '/path',
  requireAuth,
  expensiveOperationRateLimit, // H-3 Security Fix
  zValidator('json', pathQuerySchema),
  async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');
  const { body } = c.req.valid('json');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'graph/path', 'read');
  }

  try {
    const path = await getPathBetween(userId, body.sourceId, body.targetId, body.maxDepth);

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'query',
      resource: 'graph/path',
      details: {
        sourceId: body.sourceId,
        targetId: body.targetId,
        pathFound: path !== null,
        pathLength: path?.length,
      },
    });

    if (!path) {
      return c.json({
        data: null,
        meta: {
          message: 'No path found between entities',
        },
      });
    }

    return c.json({
      data: {
        nodes: path.nodes,
        edges: path.edges.map((e) => ({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          relation: e.relation,
          weight: e.weight,
          confidence: e.confidence,
        })),
        totalWeight: path.totalWeight,
        length: path.length,
      },
      meta: {
        sourceId: body.sourceId,
        targetId: body.targetId,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      return c.json({ error: error.message.replace('NOT_FOUND: ', '') }, 404);
    }
    throw error;
  }
});

/**
 * POST /v1/graph/pattern
 *
 * Pattern-based natural language query
 * H-3 SECURITY: Expensive operation rate limited to 100 req/min
 */
graph.post(
  '/pattern',
  requireAuth,
  expensiveOperationRateLimit, // H-3 Security Fix
  zValidator('json', patternQuerySchema),
  async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');
  const params = c.req.valid('json');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'graph/pattern', 'read');
  }

  try {
    const result = await queryPattern(userId, {
      pattern: params.pattern,
      limit: params.limit,
    });

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'query',
      resource: 'graph/pattern',
      details: {
        pattern: params.pattern,
        resultCount: result.entities.length,
      },
    });

    return c.json({
      data: {
        entities: result.entities.map((e) => ({
          id: e.id,
          type: e.type,
          name: e.name,
          properties: e.properties,
          confidence: e.confidence,
          mentionCount: e.mentionCount,
        })),
        explanation: result.explanation,
      },
      meta: {
        pattern: params.pattern,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('PATTERN_NOT_RECOGNIZED')) {
      return c.json(
        {
          error: error.message.replace('PATTERN_NOT_RECOGNIZED: ', ''),
        },
        400
      );
    }
    throw error;
  }
});

// =====================================================
// ANALYTICS ENDPOINTS
// =====================================================

/**
 * GET /v1/graph/stats
 *
 * Get graph statistics
 */
graph.get('/stats', requireAuth, async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'graph/stats', 'read');
  }

  const stats = await getGraphStats(userId);

  // Log audit entry (skip for session/dashboard polling to avoid flooding)
  if (authType !== 'session') {
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'query',
      resource: 'graph/stats',
      details: {
        totalEntities: stats.totalEntities,
        totalEdges: stats.totalEdges,
      },
    });
  }

  // Convert topRelations array to Record for API response
  const relations: Record<string, number> = {};
  for (const rel of stats.topRelations) {
    relations[rel.relation] = rel.count;
  }

  return c.json({
    total_entities: stats.totalEntities,
    total_edges: stats.totalEdges,
    types: stats.entitiesByType,
    relations,
    avg_confidence: stats.avgConfidence,
    avg_degree: stats.avgDegree,
  });
});

export default graph;
