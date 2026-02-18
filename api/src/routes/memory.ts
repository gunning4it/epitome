/**
 * Memory Routes
 *
 * Endpoints for memory quality and review
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import { requireAuth, requireUser } from '@/middleware/auth';
import {
  getMemoriesNeedingReview,
  resolveReview,
  getMemoryQualityStats,
} from '@/services/memoryQuality.service';
import { logAuditEntry } from '@/services/audit.service';
import {
  memoryReviewIdSchema,
  memoryResolveSchema,
} from '@/validators/api';

const memory = new Hono<HonoEnv>();

/**
 * GET /v1/memory/review
 *
 * Get memories needing manual review (max 5)
 * User-only endpoint
 */
memory.get('/review', requireAuth, requireUser, async (c) => {
  const userId = c.get('userId') as string;

  // Get memories needing review
  const memories = await getMemoriesNeedingReview(userId);

  // Log audit entry
  await logAuditEntry(userId, {
    agentId: 'user',
    action: 'read',
    resource: 'memory/review',
    details: { count: memories.length },
  });

  return c.json({
    data: memories.map((m) => ({
      id: m.id,
      sourceType: m.sourceType,
      sourceRef: m.sourceRef,
      confidence: m.confidence,
      status: m.status,
      contradictions: m.contradictions,
      createdAt: m.createdAt.toISOString(),
    })),
    meta: {
      total: memories.length,
      maxItems: 5,
    },
  });
});

/**
 * POST /v1/memory/review/:id/resolve
 *
 * Resolve a memory in review state
 * User-only endpoint
 */
memory.post(
  '/review/:id/resolve',
  requireAuth,
  requireUser,
  zValidator('param', memoryReviewIdSchema),
  zValidator('json', memoryResolveSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const { id } = c.req.valid('param');
    const { body } = c.req.valid('json');

    // Resolve review
    await resolveReview(userId, id, body.action);

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: 'user',
      action: 'write',
      resource: 'memory/review',
      details: {
        memoryId: id,
        action: body.action,
      },
    });

    return c.json({
      data: {
        success: true,
        action: body.action,
      },
      meta: {},
    });
  }
);

/**
 * GET /v1/memory/stats
 *
 * Get memory quality statistics
 */
memory.get('/stats', requireAuth, async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');

  // Get stats
  const stats = await getMemoryQualityStats(userId);

  // Log audit entry
  await logAuditEntry(userId, {
    agentId: agentId || 'user',
    action: 'read',
    resource: 'memory/stats',
    details: {},
  });

  return c.json({
    data: stats,
    meta: {},
  });
});

export default memory;
