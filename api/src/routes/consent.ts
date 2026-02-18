/**
 * Consent Routes
 *
 * Manage per-agent permissions for resources
 *
 * Routes:
 * - GET    /v1/consent          - List agents with their consent rules
 * - PATCH  /v1/consent/:agentId - Update permissions for an agent
 * - DELETE /v1/consent/:agentId - Revoke all access for an agent
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '@/types/hono';
import { requireAuth, requireUser } from '@/middleware/auth';
import { db } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import {
  getAgentConsent,
  grantConsent,
  revokeConsent,
  revokeAllAgentConsent,
} from '@/services/consent.service';
import { logger } from '@/utils/logger';

// H-7 SECURITY FIX: Zod schema for consent update validation
const consentUpdateSchema = z.object({
  permissions: z.array(z.object({
    resource: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_/*.-]+$/),
    permission: z.enum(['read', 'write', 'none']),
  })).min(1).max(50),
}).strict();

const agentIdParamSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.-]+$/);

const consent = new Hono<HonoEnv>();

/**
 * GET /v1/consent
 *
 * List all agents with their consent permissions.
 * Queries api_keys for unique agentIds, then fetches consent rules for each.
 */
consent.get('/', requireAuth, requireUser, async (c) => {
  const userId = c.get('userId') as string;

  // Get all non-revoked API keys with agentIds for this user
  const keys = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt),
        isNotNull(apiKeys.agentId)
      )
    )
    .orderBy(apiKeys.createdAt);

  // Deduplicate by agentId, keeping the most recently used
  const agentMap = new Map<string, typeof keys[0]>();
  for (const key of keys) {
    if (!key.agentId) continue;
    const existing = agentMap.get(key.agentId);
    if (!existing || (key.lastUsedAt && (!existing.lastUsedAt || key.lastUsedAt > existing.lastUsedAt))) {
      agentMap.set(key.agentId, key);
    }
  }

  // For each agent, get their consent rules
  const agents = await Promise.all(
    Array.from(agentMap.entries()).map(async ([agentId, key]) => {
      const rules = await getAgentConsent(userId, agentId);
      return {
        agent_id: agentId,
        agent_name: key.label || agentId,
        permissions: rules.map((r) => ({
          resource: r.resource,
          permission: r.permission,
        })),
        last_used: key.lastUsedAt?.toISOString() || null,
        created_at: key.createdAt.toISOString(),
      };
    })
  );

  return c.json({ data: agents });
});

/**
 * PATCH /v1/consent/:agentId
 *
 * Update permissions for an agent.
 * Accepts { permissions: [{ resource, permission }] }
 * Permission 'none' revokes that resource.
 */
consent.patch('/:agentId', requireAuth, requireUser, async (c) => {
  const userId = c.get('userId') as string;
  const rawAgentId = c.req.param('agentId');

  // H-7 SECURITY FIX: Validate agentId path parameter
  const agentIdResult = agentIdParamSchema.safeParse(rawAgentId);
  if (!agentIdResult.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid agentId parameter', details: agentIdResult.error.issues } },
      400
    );
  }
  const agentId = agentIdResult.data;

  try {
    // H-7 SECURITY FIX: Validate request body with Zod schema
    const rawBody = await c.req.json();
    const bodyResult = consentUpdateSchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid request body', details: bodyResult.error.issues } },
        400
      );
    }
    const body = bodyResult.data;

    // Deduplicate permissions — last one wins per resource
    const deduped = new Map<string, 'read' | 'write' | 'none'>();
    for (const p of body.permissions) {
      deduped.set(p.resource, p.permission);
    }

    for (const [resource, permission] of deduped) {
      if (permission === 'none') {
        await revokeConsent(userId, agentId, resource);
      } else {
        await grantConsent(userId, { agentId, resource, permission });
      }
    }

    // Return updated state
    const rules = await getAgentConsent(userId, agentId);
    return c.json({
      data: {
        agent_id: agentId,
        permissions: rules.map((r) => ({
          resource: r.resource,
          permission: r.permission,
        })),
      },
    });
  } catch (error) {
    logger.error('Failed to update consent', { agentId, error: String(error) });
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to update permissions' } },
      500
    );
  }
});

/**
 * DELETE /v1/consent/:agentId
 *
 * Revoke all permissions for an agent.
 */
consent.delete('/:agentId', requireAuth, requireUser, async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.req.param('agentId');

  await revokeAllAgentConsent(userId, agentId);

  return c.json({ success: true });
});

export default consent;
