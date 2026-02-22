/**
 * Profile Routes
 *
 * Endpoints for user profile management
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import { requireAuth } from '@/middleware/auth';
import { buildToolContext } from '@/services/tools/context';
import { getUserContext } from '@/services/tools/getUserContext';
import {
  getLatestProfile,
  getProfileHistory,
  validateProfile,
} from '@/services/profile.service';
import { createWriteId, ingestProfileUpdate } from '@/services/writeIngestion.service';
import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import {
  patchProfileSchema,
  profileContextQuerySchema,
  profileHistoryQuerySchema,
} from '@/validators/api';

const profile = new Hono<HonoEnv>();

function normalizeProfilePatch(
  payload: Record<string, unknown>
): Record<string, unknown> {
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

/**
 * GET /v1/profile
 *
 * Get current user profile
 */
profile.get('/', requireAuth, async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'profile', 'read');
  }

  // Get latest profile
  const profile = await getLatestProfile(userId);

  // Only audit agent reads, not session reads (avoids self-referential flooding from dashboard polling)
  if (authType !== 'session') {
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'read',
      resource: 'profile',
      details: {},
    });
  }

  return c.json({
    data: profile?.data || {},
    version: profile?.version || 1,
    updated_at: profile?.updated_at || new Date().toISOString(),
    meta: {},
  });
});

/**
 * GET /v1/profile/context
 *
 * Retrieve aggregated user context for SDK usage.
 * API-key auth only (session auth is intentionally rejected).
 */
profile.get(
  '/context',
  requireAuth,
  zValidator('query', profileContextQuerySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = String(c.get('agentId') || 'unknown-agent');
    const authType = c.get('authType');
    const tier = String(c.get('tier') || 'free');
    const { topic } = c.req.valid('query');

    // Keep semantics deterministic for SDK integrations.
    if (authType === 'session') {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'This endpoint requires API key authentication',
          },
        },
        403
      );
    }

    const toolContext = buildToolContext({
      userId,
      agentId,
      tier,
      authType: 'api_key',
    });

    const contextResult = await getUserContext({ topic }, toolContext);
    if (!contextResult.success) {
      const status = contextResult.code === 'CONSENT_DENIED'
        ? 403
        : contextResult.code === 'INVALID_ARGS'
          ? 400
          : contextResult.code === 'NOT_FOUND'
            ? 404
            : contextResult.code === 'RATE_LIMITED'
              ? 429
              : 500;

      return c.json(
        {
          error: {
            code: contextResult.code,
            message: contextResult.message,
          },
        },
        status
      );
    }

    return c.json({
      data: contextResult.data,
      meta: {
        message: contextResult.message,
        ...(contextResult.meta?.warnings
          ? { warnings: contextResult.meta.warnings }
          : {}),
      },
    });
  }
);

/**
 * PATCH /v1/profile
 *
 * Update user profile (deep merge)
 */
profile.patch(
  '/',
  requireAuth,
  zValidator('json', patchProfileSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const payload = c.req.valid('json') as Record<string, unknown>;
    const body = normalizeProfilePatch(payload) as Record<string, unknown>;

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, 'profile', 'write');
    }

    // Validate profile structure
    try {
      validateProfile(body);
    } catch (error) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Profile validation failed',
          },
        },
        422
      );
    }

    // Determine origin based on auth type
    const origin = authType === 'session' ? 'user_typed' : 'ai_inferred';
    const changedBy = authType === 'api_key' && agentId ? agentId : 'user';
    const writeId = createWriteId();

    // Update profile
    const updated = await ingestProfileUpdate({
      userId,
      patch: body,
      changedBy,
      origin,
      writeId,
    });

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'write',
      resource: 'profile',
      details: {
        version: updated.profile.version,
        changedFields: updated.profile.changedFields,
        sourceRef: updated.sourceRef,
        writeId: updated.writeId,
        writeStatus: updated.writeStatus,
        jobId: updated.jobId,
      },
    });

    return c.json({
      data: {
        version: updated.profile.version,
        data: updated.profile.data,
        changedFields: updated.profile.changedFields,
        changedAt: updated.profile.changedAt.toISOString(),
        sourceRef: updated.sourceRef,
        writeId: updated.writeId,
        writeStatus: updated.writeStatus,
        jobId: updated.jobId,
      },
      meta: {},
    });
  }
);

/**
 * GET /v1/profile/history
 *
 * Get profile version history
 */
profile.get(
  '/history',
  requireAuth,
  zValidator('query', profileHistoryQuerySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const { limit } = c.req.valid('query');

    // Only allow user access (not agents) for history
    if (c.get('authType') === 'api_key') {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Profile history is only accessible to users',
          },
        },
        403
      );
    }

    // Get history
    const history = await getProfileHistory(userId, limit);

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'read',
      resource: 'profile/history',
      details: { limit },
    });

    return c.json({
      data: history.map((v) => ({
        version: v.version,
        data: v.data,
        changedBy: v.changedBy,
        changedFields: v.changedFields,
        changedAt: v.changedAt.toISOString(),
        updated_at: v.changedAt.toISOString(),
      })),
      meta: {
        total: history.length,
      },
    });
  }
);

export default profile;
