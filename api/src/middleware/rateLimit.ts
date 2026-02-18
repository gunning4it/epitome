/**
 * Rate Limiting Middleware (H-3 Vulnerability Fix)
 *
 * Implements request rate limiting to prevent:
 * - DoS attacks
 * - Brute force attacks
 * - API abuse
 * - Resource exhaustion
 *
 * Returns 429 Too Many Requests when limit exceeded
 */

import type { Context, Next } from 'hono';
import type { HonoEnv } from '@/types/hono';
import {
  consumeRateLimit,
  determineRateLimitTier,
  getRateLimitKey,
  RateLimitTier,
  type RateLimitResult,
} from '@/services/rateLimit.service';

/**
 * Rate limiting middleware
 *
 * Determines appropriate tier and enforces limits
 */
export async function rateLimitMiddleware(c: Context<HonoEnv>, next: Next) {
  // Extract auth context from request
  const userId = c.get('userId');
  const agentId = c.get('agentId');
  const authType = c.get('authType');
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
             c.req.header('x-real-ip') ||
             'unknown';

  const isMcpTool = c.req.path.startsWith('/mcp');

  // Determine rate limit tier
  const apiKeyTier = c.get('tier') || 'free'; // Read from auth middleware
  const tier = determineRateLimitTier({
    isAuthenticated: !!userId,
    authType: authType,
    apiKeyTier,
    isMcpTool,
  });

  // Get rate limit key
  const key = getRateLimitKey({
    userId: userId,
    agentId: agentId,
    ip,
    isAuthenticated: !!userId,
  });

  // Consume rate limit
  const result: RateLimitResult = await consumeRateLimit(key, tier);

  // Set rate limit headers
  c.header('X-RateLimit-Limit', String(result.remainingPoints + 1)); // Total limit
  c.header('X-RateLimit-Remaining', String(result.remainingPoints));
  c.header('X-RateLimit-Reset', String(result.resetTime));

  if (!result.allowed) {
    // Rate limit exceeded
    c.header('Retry-After', String(result.retryAfter || 60));

    return c.json(
      {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: result.retryAfter,
          tier,
        },
      },
      429
    );
  }

  // Rate limit OK, proceed
  return next();
}

/**
 * Special rate limiting for expensive operations
 * (vector search, graph queries, SQL queries)
 */
export async function expensiveOperationRateLimit(
  c: Context<HonoEnv>,
  next: Next
) {
  const userId = c.get('userId');
  const agentId = c.get('agentId');
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
             c.req.header('x-real-ip') ||
             'unknown';

  // More restrictive limits for expensive operations
  const key = `expensive:${getRateLimitKey({
    userId: userId,
    agentId: agentId,
    ip,
    isAuthenticated: !!userId,
  })}`;

  // Use API_KEY_FREE tier (100 req/min) for expensive operations
  // Even pro users get this limit for expensive ops
  const result = await consumeRateLimit(key, RateLimitTier.API_KEY_FREE);

  c.header('X-RateLimit-Limit-Expensive', String(result.remainingPoints + 1));
  c.header('X-RateLimit-Remaining-Expensive', String(result.remainingPoints));
  c.header('X-RateLimit-Reset-Expensive', String(result.resetTime));

  if (!result.allowed) {
    c.header('Retry-After', String(result.retryAfter || 60));

    return c.json(
      {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message:
            'Too many expensive operations. This endpoint is rate limited to 100 requests per minute.',
          retryAfter: result.retryAfter,
        },
      },
      429
    );
  }

  return next();
}
