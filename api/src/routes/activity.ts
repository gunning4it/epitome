/**
 * Activity Routes
 *
 * Endpoints for audit logs, agent management, and data export
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import { requireAuth, requireUser } from '@/middleware/auth';
import { queryAuditLog } from '@/services/audit.service';
import { revokeAllAgentConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { activityQuerySchema, agentIdSchema } from '@/validators/api';
import { getLatestProfile } from '@/services/profile.service';
import { listTables, queryRecords } from '@/services/table.service';
import { listCollections, listVectors } from '@/services/vector.service';
import { listEntities, listEdges } from '@/services/graphService';
import { getMemoryQualityStats, getMemoryDecayStatus } from '@/services/memoryQuality.service';
import { getNightlyExtractionStatus } from '@/services/entityExtraction';
import { logger } from '@/utils/logger';

const activity = new Hono<HonoEnv>();

/**
 * GET /v1/activity
 *
 * Query audit log with optional filters
 */
activity.get(
  '/activity',
  requireAuth,
  zValidator('query', activityQuerySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const authType = c.get('authType');
    const filters = c.req.valid('query');

    // Only users can view full audit log (not agents)
    if (authType === 'api_key') {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Audit log is only accessible to users',
          },
        },
        403
      );
    }

    // Query audit log
    const entries = await queryAuditLog(userId, {
      agentId: filters.agentId,
      action: filters.action as any,
      resource: filters.resource,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      limit: filters.limit,
      offset: filters.offset,
    });

    // Skip audit for activity reads — logging reads of the activity log creates a self-referential loop

    return c.json({
      data: entries.map((entry) => ({
        id: entry.id,
        agent_id: entry.agentId,
        agent_name: entry.agentName,
        action: entry.action,
        resource: entry.resource,
        resource_type: entry.resource.split('/')[0],
        resource_id: entry.resource.split('/').slice(1).join('/') || null,
        details: entry.details,
        timestamp: entry.createdAt.toISOString(),
        created_at: entry.createdAt.toISOString(),
      })),
      meta: {
        total: entries.length,
        limit: filters.limit,
        offset: filters.offset,
      },
    });
  }
);

/**
 * DELETE /v1/agents/:id
 *
 * Revoke all permissions for an agent
 * User-only endpoint
 */
activity.delete(
  '/agents/:id',
  requireAuth,
  requireUser,
  zValidator('param', agentIdSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const { id: agentId } = c.req.valid('param');

    // Revoke all consent for this agent
    await revokeAllAgentConsent(userId, agentId);

    // Log the revocation
    await logAuditEntry(userId, {
      agentId: 'user',
      action: 'delete',
      resource: `agents/${agentId}`,
      details: {
        action: 'revoke_all_consent',
      },
    });

    return c.json({
      data: {
        success: true,
        agentId,
        message: 'All permissions revoked for agent',
      },
      meta: {},
    });
  }
);

/**
 * GET /v1/system/extraction
 *
 * Report nightly extraction scheduler status
 * User-only endpoint
 */
activity.get('/system/extraction', requireAuth, requireUser, async (c) => {
  const userId = c.get('userId') as string;
  const extraction = await getNightlyExtractionStatus();
  const memoryDecay = getMemoryDecayStatus();

  await logAuditEntry(userId, {
    agentId: 'user',
    action: 'read',
    resource: 'system/extraction',
    details: {
      extractionEnabled: extraction.enabled,
      extractionPgCronAvailable: extraction.pgCronAvailable,
      extractionScheduled: extraction.scheduled,
      extractionJobId: extraction.jobId ?? null,
      memoryDecayEnabled: memoryDecay.enabled,
      memoryDecayMode: memoryDecay.mode,
    },
  });

  return c.json({
    data: {
      extraction,
      memoryDecay,
    },
    meta: {},
  });
});

/**
 * GET /v1/export
 *
 * Export all user data (profile + tables + vectors + graph + memory quality)
 * User-only endpoint
 */
activity.get('/export', requireAuth, requireUser, async (c) => {
  const userId = c.get('userId') as string;

  try {
    const TABLE_PAGE_SIZE = 1000;
    const VECTOR_PAGE_SIZE = 1000;
    const GRAPH_PAGE_SIZE = 500;

    // Get profile
    const profile = await getLatestProfile(userId);

    // Get all tables with complete paginated data
    const tables = await listTables(userId);
    const tablesData: Record<string, unknown[]> = {};

    for (const table of tables) {
      let offset = 0;
      const records: unknown[] = [];

      while (true) {
        const batch = await queryRecords(userId, table.tableName, {}, TABLE_PAGE_SIZE, offset);
        records.push(...batch);
        if (batch.length < TABLE_PAGE_SIZE) break;
        offset += TABLE_PAGE_SIZE;
      }

      tablesData[table.tableName] = records;
    }

    // Get all vector collections with complete paginated entries
    const collections = await listCollections(userId);
    const vectorsData: Record<string, unknown[]> = {};
    let totalVectors = 0;

    for (const collection of collections) {
      let offset = 0;
      const entries: unknown[] = [];

      while (true) {
        const batch = await listVectors(userId, collection.collection, VECTOR_PAGE_SIZE, offset);
        entries.push(
          ...batch.map((entry) => ({
            id: entry.id,
            collection: entry.collection,
            text: entry.text,
            metadata: entry.metadata || {},
            created_at: entry.createdAt.toISOString(),
            deleted_at: entry.deletedAt ? entry.deletedAt.toISOString() : null,
            meta_id: entry.metaId ?? null,
          }))
        );

        if (batch.length < VECTOR_PAGE_SIZE) break;
        offset += VECTOR_PAGE_SIZE;
      }

      vectorsData[collection.collection] = entries;
      totalVectors += entries.length;
    }

    // Get complete graph snapshot (entities + edges)
    let entityOffset = 0;
    const graphEntities: Array<Record<string, unknown>> = [];
    while (true) {
      const batch = await listEntities(userId, {
        limit: GRAPH_PAGE_SIZE,
        offset: entityOffset,
      });
      graphEntities.push(
        ...batch.map((entity) => ({
          id: entity.id,
          type: entity.type,
          name: entity.name,
          properties: entity.properties,
          confidence: entity.confidence,
          mention_count: entity.mentionCount,
          first_seen: entity.firstSeen.toISOString(),
          last_seen: entity.lastSeen.toISOString(),
          deleted_at: entity.deletedAt ? entity.deletedAt.toISOString() : null,
          meta: entity.meta
            ? {
                id: entity.meta.id,
                origin: entity.meta.origin,
                confidence: entity.meta.confidence,
                status: entity.meta.status,
              }
            : null,
        }))
      );
      if (batch.length < GRAPH_PAGE_SIZE) break;
      entityOffset += GRAPH_PAGE_SIZE;
    }

    let edgeOffset = 0;
    const graphEdges: Array<Record<string, unknown>> = [];
    while (true) {
      const batch = await listEdges(userId, {
        limit: GRAPH_PAGE_SIZE,
        offset: edgeOffset,
      });
      graphEdges.push(
        ...batch.map((edge) => ({
          id: edge.id,
          source_id: edge.sourceId,
          target_id: edge.targetId,
          relation: edge.relation,
          weight: edge.weight,
          confidence: edge.confidence,
          evidence: edge.evidence || [],
          first_seen: edge.firstSeen.toISOString(),
          last_seen: edge.lastSeen.toISOString(),
          properties: edge.properties || {},
          meta: edge.meta
            ? {
                id: edge.meta.id,
                origin: edge.meta.origin,
                confidence: edge.meta.confidence,
                status: edge.meta.status,
              }
            : null,
        }))
      );
      if (batch.length < GRAPH_PAGE_SIZE) break;
      edgeOffset += GRAPH_PAGE_SIZE;
    }

    const memoryQuality = await getMemoryQualityStats(userId);

    // Log the export
    await logAuditEntry(userId, {
      agentId: 'user',
      action: 'read',
      resource: 'export',
      details: {
        profileExported: !!profile,
        tablesExported: Object.keys(tablesData).length,
        vectorCollectionsExported: Object.keys(vectorsData).length,
        vectorsExported: totalVectors,
        graphEntitiesExported: graphEntities.length,
        graphEdgesExported: graphEdges.length,
        totalRecords: Object.values(tablesData).reduce(
          (sum, records) => sum + records.length,
          0
        ),
      },
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      userId,
      profile: profile?.data || null,
      tables: tablesData,
      vectors: {
        collections: collections.map((collection) => ({
          collection: collection.collection,
          description: collection.description || null,
          entry_count: collection.entryCount,
          embedding_dim: collection.embeddingDim,
          created_at: collection.createdAt.toISOString(),
          updated_at: collection.updatedAt.toISOString(),
        })),
        entries: vectorsData,
      },
      graph: {
        entities: graphEntities,
        edges: graphEdges,
      },
      memory_quality: memoryQuality,
      meta: {
        tableCount: tables.length,
        recordCount: Object.values(tablesData).reduce(
          (sum, records) => sum + records.length,
          0
        ),
        vectorCount: totalVectors,
        vectorCollectionCount: collections.length,
        graphEntityCount: graphEntities.length,
        graphEdgeCount: graphEdges.length,
      },
    };

    return c.json({
      data: exportData,
      meta: {
        format: 'json',
        version: '1.0',
      },
    });
  } catch (error) {
    logger.error('Error exporting data', { error: String(error) });
    return c.json(
      {
        error: {
          code: 'EXPORT_ERROR',
          message: 'Failed to export user data',
        },
      },
      500
    );
  }
});

export default activity;
