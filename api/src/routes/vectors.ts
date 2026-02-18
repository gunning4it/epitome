/**
 * Vector Routes
 *
 * Endpoints for vector embeddings and semantic search
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import { requireAuth, requireUser } from '@/middleware/auth';
import { expensiveOperationRateLimit } from '@/middleware/rateLimit';
import { searchVectors, searchAllVectors, listRecentVectors, listCollections } from '@/services/vector.service';
import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { ingestMemoryText } from '@/services/writeIngestion.service';
import {
  vectorCollectionSchema,
  vectorAddSchema,
  vectorSearchSchema,
} from '@/validators/api';

const vectors = new Hono<HonoEnv>();

/**
 * GET /v1/vectors/recent
 *
 * Browse recent vectors (dashboard-only)
 */
vectors.get(
  '/recent',
  requireAuth,
  requireUser,
  async (c) => {
    const userId = c.get('userId') as string;
    const collection = c.req.query('collection') || undefined;
    const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
    const offset = Number(c.req.query('offset')) || 0;

    const { vectors: entries, total } = await listRecentVectors(userId, {
      collection,
      limit,
      offset,
    });

    return c.json({
      data: entries.map((v) => ({
        id: v.id,
        collection: v.collection,
        text: v.text,
        metadata: v.metadata || {},
        confidence: v.confidence ?? 0.5,
        status: v.status ?? 'active',
        created_at: v.created_at,
      })),
      meta: { total, limit, offset },
    });
  }
);

/**
 * GET /v1/vectors/collections
 *
 * List all vector collections (dashboard-only)
 */
vectors.get(
  '/collections',
  requireAuth,
  requireUser,
  async (c) => {
    const userId = c.get('userId') as string;
    const collections = await listCollections(userId);

    return c.json({
      data: collections.map((col) => ({
        collection: col.collection,
        description: col.description ?? null,
        entry_count: col.entryCount,
        created_at: col.createdAt.toISOString(),
      })),
      meta: { total: collections.length },
    });
  }
);

/**
 * POST /v1/vectors/:collection/add
 *
 * Add vector entry with automatic embedding generation
 */
vectors.post(
  '/:collection/add',
  requireAuth,
  zValidator('param', vectorCollectionSchema),
  zValidator('json', vectorAddSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { collection } = c.req.valid('param');
    const { body } = c.req.valid('json');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, `vectors/${collection}`, 'write');
    }

    // Determine origin
    const origin = authType === 'session' ? 'user_typed' : 'ai_inferred';
    const changedBy = authType === 'api_key' && agentId ? agentId : 'user';

    const ingested = await ingestMemoryText({
      userId,
      collection,
      text: body.text,
      metadata: body.metadata || {},
      changedBy,
      origin,
    });

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'write',
      resource: `vectors/${collection}`,
      details: {
        vectorId: ingested.vectorId || null,
        pendingVectorId: ingested.pendingVectorId || null,
        sourceRef: ingested.sourceRef,
        writeId: ingested.writeId,
        writeStatus: ingested.writeStatus,
        jobId: ingested.jobId || null,
        textLength: body.text.length,
      },
    });

    return c.json(
      {
        data: {
          id: ingested.vectorId || null,
          pending_id: ingested.pendingVectorId || null,
          collection,
          sourceRef: ingested.sourceRef,
          writeId: ingested.writeId,
          writeStatus: ingested.writeStatus,
          jobId: ingested.jobId || null,
        },
        meta: {},
      },
      201
    );
  }
);

/**
 * POST /v1/vectors/:collection
 *
 * Backward-compatible alias for /:collection/add
 */
vectors.post(
  '/:collection',
  requireAuth,
  zValidator('param', vectorCollectionSchema),
  zValidator('json', vectorAddSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { collection } = c.req.valid('param');
    const { body } = c.req.valid('json');

    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, `vectors/${collection}`, 'write');
    }

    const origin = authType === 'session' ? 'user_typed' : 'ai_inferred';
    const changedBy = authType === 'api_key' && agentId ? agentId : 'user';

    const ingested = await ingestMemoryText({
      userId,
      collection,
      text: body.text,
      metadata: body.metadata || {},
      changedBy,
      origin,
    });

    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'write',
      resource: `vectors/${collection}`,
      details: {
        vectorId: ingested.vectorId || null,
        pendingVectorId: ingested.pendingVectorId || null,
        sourceRef: ingested.sourceRef,
        writeId: ingested.writeId,
        writeStatus: ingested.writeStatus,
        jobId: ingested.jobId || null,
        textLength: body.text.length,
      },
    });

    return c.json(
      {
        data: {
          id: ingested.vectorId || null,
          pending_id: ingested.pendingVectorId || null,
          collection,
          sourceRef: ingested.sourceRef,
          writeId: ingested.writeId,
          writeStatus: ingested.writeStatus,
          jobId: ingested.jobId || null,
        },
        meta: {},
      },
      201
    );
  }
);

/**
 * POST /v1/vectors/:collection/search
 *
 * Semantic search via cosine similarity
 * H-3 SECURITY: Expensive operation rate limited to 100 req/min
 */
vectors.post(
  '/:collection/search',
  requireAuth,
  expensiveOperationRateLimit, // H-3 Security Fix
  zValidator('param', vectorCollectionSchema),
  zValidator('json', vectorSearchSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { collection } = c.req.valid('param');
    const { body } = c.req.valid('json');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, `vectors/${collection}`, 'read');
    }

    // Search vectors — use cross-collection search for '_all', single collection otherwise
    const results = collection === '_all'
      ? await searchAllVectors(userId, body.query, body.limit, body.minSimilarity)
      : await searchVectors(userId, collection, body.query, body.limit, body.minSimilarity);

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'query',
      resource: `vectors/${collection}`,
      details: {
        queryLength: body.query.length,
        resultCount: results.length,
        minSimilarity: body.minSimilarity,
      },
    });

    return c.json({
      data: results.map((r) => ({
        id: r.id,
        collection: r.collection,
        text: r.text,
        metadata: r.metadata,
        similarity: r.similarity,
        confidence: r.confidence,
        status: r.status,
        created_at: r.createdAt.toISOString(),
      })),
      meta: {
        total: results.length,
        query: body.query,
        minSimilarity: body.minSimilarity,
      },
    });
  }
);

export default vectors;
