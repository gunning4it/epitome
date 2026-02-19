/**
 * Authentication Middleware
 *
 * Resolves authentication from multiple sources:
 * - Bearer token (API keys for agents)
 * - Session cookie (dashboard users)
 * - X-API-Key header (alternative to Bearer)
 *
 * Sets context variables:
 * - c.get('userId') - Authenticated user ID
 * - c.get('agentId') - Agent ID if authenticated via API key
 * - c.get('authType') - 'session' | 'api_key'
 */

import { Context, Next, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { db } from '@/db/client';
import { eq, and, isNull, or, gt } from 'drizzle-orm';
import { apiKeys, sessions, users } from '@/db/schema';
import crypto from 'crypto';
import { hashSessionToken } from '@/utils/crypto';
import { logger } from '@/utils/logger';

/**
 * Auth context type extensions
 */
export type AuthContext = {
  userId?: string;
  agentId?: string;
  authType?: 'session' | 'api_key';
};

/**
 * Authentication resolver middleware
 *
 * Validates Bearer token, session cookie, or X-API-Key header
 * Sets userId and agentId on context if authenticated
 */
export const authResolver: MiddlewareHandler = async (c: Context, next: Next) => {
  logger.debug('authResolver middleware START');

  // In test env, allow test headers set by integration/load test helpers.
  // L-4 SECURITY FIX: Block test auth bypass when DEPLOYED is set (staging/prod)
  if (process.env.NODE_ENV === 'test' && !process.env.DEPLOYED) {
    // Hono uses Web Standards Headers API
    const testUserId = c.req.header('x-test-user-id');
    const testAgentId = c.req.header('x-test-agent-id');

    logger.debug('Test mode auth', { userId: testUserId, agentId: testAgentId });

    if (testUserId) {
      c.set('userId', testUserId);
      if (testAgentId) c.set('agentId', testAgentId);
      // If x-test-auth-type header is provided, use it; otherwise default based on agent presence
      const testAuthType = c.req.header('x-test-auth-type');
      if (testAuthType === 'session') {
        c.set('authType', 'session');
      } else {
        c.set('authType', 'api_key');
      }
      // Allow tests to set tier explicitly
      const testTier = c.req.header('x-test-tier') as 'free' | 'pro' | 'enterprise' | undefined;
      if (testTier) {
        c.set('tier', testTier);
      }

      logger.debug('authResolver middleware END (test headers), calling next()');
      return next();
    }
    // No test headers — fall through to real auth checks
  }

  // Try Bearer token first
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const result = await validateApiKey(token);

    if (result) {
      c.set('userId', result.userId);
      c.set('agentId', result.agentId);
      c.set('tier', result.tier);
      c.set('authType', 'api_key');
      return next();
    }
  }

  // Try X-API-Key header
  const apiKeyHeader = c.req.header('X-API-Key');
  if (apiKeyHeader) {
    const result = await validateApiKey(apiKeyHeader);

    if (result) {
      c.set('userId', result.userId);
      c.set('agentId', result.agentId);
      c.set('tier', result.tier);
      c.set('authType', 'api_key');
      return next();
    }
  }

  // Try session cookie
  const sessionToken = getCookie(c, 'epitome_session');
  if (sessionToken) {
    const result = await validateSession(sessionToken);

    if (result) {
      c.set('userId', result.userId);
      c.set('tier', result.tier);
      c.set('authType', 'session');
      return next();
    }
  }

  // No valid authentication found - continue without auth
  // Individual routes can require authentication with requireAuth guard
  return next();
};

/**
 * Require authentication guard
 *
 * Throws 401 if not authenticated
 * Use after authResolver in middleware chain
 */
export const requireAuth: MiddlewareHandler = async (c: Context, next: Next) => {
  const userId = c.get('userId');

  logger.debug('requireAuth check', { userId });

  if (!userId) {
    logger.debug('requireAuth denied - no userId');
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    c.header(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    return c.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
        },
      },
      401
    );
  }

  return next();
};

/**
 * Require user authentication (not agent)
 *
 * Throws 403 if authenticated as agent
 * Use for dashboard-only endpoints
 */
export const requireUser: MiddlewareHandler = async (c: Context, next: Next) => {
  const userId = c.get('userId');
  const authType = c.get('authType');

  if (!userId) {
    return c.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
        },
      },
      401
    );
  }

  if (authType === 'api_key') {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'This endpoint requires user authentication (not agent)',
        },
      },
      403
    );
  }

  return next();
};

/**
 * Validate API key
 *
 * Looks up the key by its SHA-256 hash (direct lookup, no scanning).
 * API keys are high-entropy (32 random bytes), so SHA-256 is sufficient.
 */
async function validateApiKey(
  key: string
): Promise<{ userId: string; agentId: string | null; tier: 'free' | 'pro' } | null> {
  try {
    const keyParts = key.split('_');
    if (keyParts.length !== 3 || keyParts[0] !== 'epi') {
      return null;
    }

    // Hash the key with SHA-256 (matches how generateApiKey stores it)
    const hash = crypto.createHash('sha256').update(key).digest('hex');

    const now = new Date();
    const [matchedKey] = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, hash),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))
        )
      )
      .limit(1);

    if (!matchedKey) {
      return null;
    }

    // Update last_used_at timestamp (fire and forget)
    db.update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, matchedKey.id))
      .execute()
      .catch((err) => logger.error('Failed to update API key last_used_at', { error: String(err) }));

    return {
      userId: matchedKey.userId,
      agentId: matchedKey.agentId,
      tier: (matchedKey.tier || 'free') as 'free' | 'pro',
    };
  } catch (error) {
    logger.error('Error validating API key', { error: String(error) });
    return null;
  }
}

/**
 * Validate session token
 *
 * Checks if session exists and is not expired
 * Returns user_id if valid
 */
async function validateSession(
  token: string
): Promise<{ userId: string; tier: 'free' | 'pro' | 'enterprise' } | null> {
  try {
    const now = new Date();

    // H-1 SECURITY FIX: Hash the token before querying
    const tokenHash = hashSessionToken(token);

    // Query session by hashed token, JOIN users to get tier
    const [result] = await db
      .select({
        userId: sessions.userId,
        tier: users.tier,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    if (!result) {
      return null;
    }

    return {
      userId: result.userId,
      tier: (result.tier || 'free') as 'free' | 'pro' | 'enterprise',
    };
  } catch (error) {
    logger.error('Error validating session', { error: String(error) });
    return null;
  }
}
