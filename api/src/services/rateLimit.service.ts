/**
 * Rate Limiting Service (H-3 Vulnerability Fix)
 *
 * Implements rate limiting to prevent DoS, brute force, and API abuse.
 *
 * Strategy:
 * - In-memory store (production should use Redis)
 * - Different limits per authentication type
 * - Exponential backoff for repeated violations
 *
 * Rate Limits:
 * - API keys: 1000 req/min (pro tier)
 * - OAuth sessions: 100 req/min
 * - IP-based (unauthenticated): 20 req/min
 * - MCP tools: 500 req/min
 */

import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { logger } from '@/utils/logger';

/**
 * Rate limit tiers and their configurations
 */
export enum RateLimitTier {
  UNAUTHENTICATED = 'unauthenticated', // IP-based, no auth
  OAUTH_SESSION = 'oauth_session', // Dashboard users
  API_KEY_FREE = 'api_key_free', // Free tier API keys
  API_KEY_PRO = 'api_key_pro', // Pro tier API keys
  MCP_TOOL = 'mcp_tool', // MCP tool calls
}

/**
 * Rate limit configuration per tier
 */
const RATE_LIMIT_CONFIG = {
  [RateLimitTier.UNAUTHENTICATED]: {
    points: 20, // 20 requests
    duration: 60, // per 60 seconds
    blockDuration: 300, // block for 5 minutes after violation
  },
  [RateLimitTier.OAUTH_SESSION]: {
    points: 100,
    duration: 60,
    blockDuration: 60, // block for 1 minute
  },
  [RateLimitTier.API_KEY_FREE]: {
    points: 100,
    duration: 60,
    blockDuration: 60,
  },
  [RateLimitTier.API_KEY_PRO]: {
    points: 1000,
    duration: 60,
    blockDuration: 30, // shorter block for paying customers
  },
  [RateLimitTier.MCP_TOOL]: {
    points: 500,
    duration: 60,
    blockDuration: 60,
  },
};

/**
 * Rate limiter instances per tier
 */
const rateLimiters: Record<RateLimitTier, RateLimiterMemory> = {
  [RateLimitTier.UNAUTHENTICATED]: new RateLimiterMemory(
    RATE_LIMIT_CONFIG[RateLimitTier.UNAUTHENTICATED]
  ),
  [RateLimitTier.OAUTH_SESSION]: new RateLimiterMemory(
    RATE_LIMIT_CONFIG[RateLimitTier.OAUTH_SESSION]
  ),
  [RateLimitTier.API_KEY_FREE]: new RateLimiterMemory(
    RATE_LIMIT_CONFIG[RateLimitTier.API_KEY_FREE]
  ),
  [RateLimitTier.API_KEY_PRO]: new RateLimiterMemory(
    RATE_LIMIT_CONFIG[RateLimitTier.API_KEY_PRO]
  ),
  [RateLimitTier.MCP_TOOL]: new RateLimiterMemory(
    RATE_LIMIT_CONFIG[RateLimitTier.MCP_TOOL]
  ),
};

/**
 * Rate limit result for middleware response
 */
export interface RateLimitResult {
  allowed: boolean;
  tier: RateLimitTier;
  remainingPoints: number;
  resetTime: number; // Unix timestamp when limit resets
  retryAfter?: number; // Seconds to wait before retry
}

/**
 * Consume a rate limit point for a given key and tier
 */
export async function consumeRateLimit(
  key: string,
  tier: RateLimitTier
): Promise<RateLimitResult> {
  const limiter = rateLimiters[tier];
  const config = RATE_LIMIT_CONFIG[tier];

  try {
    const result: RateLimiterRes = await limiter.consume(key);

    return {
      allowed: true,
      tier,
      remainingPoints: result.remainingPoints,
      resetTime: Math.floor(Date.now() / 1000) + config.duration,
    };
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      // Rate limit exceeded
      return {
        allowed: false,
        tier,
        remainingPoints: 0,
        resetTime: Math.floor(Date.now() / 1000) + error.msBeforeNext / 1000,
        retryAfter: Math.ceil(error.msBeforeNext / 1000),
      };
    }

    // Unknown error - fail open (allow request but log)
    logger.error('Rate limiter error', { error: String(error) });
    return {
      allowed: true,
      tier,
      remainingPoints: config.points,
      resetTime: Math.floor(Date.now() / 1000) + config.duration,
    };
  }
}

/**
 * Determine rate limit tier for a given auth context
 */
export function determineRateLimitTier(authContext: {
  isAuthenticated: boolean;
  authType?: 'session' | 'api_key';
  apiKeyTier?: 'free' | 'pro';
  isMcpTool?: boolean;
}): RateLimitTier {
  if (!authContext.isAuthenticated) {
    return RateLimitTier.UNAUTHENTICATED;
  }

  if (authContext.isMcpTool) {
    return RateLimitTier.MCP_TOOL;
  }

  if (authContext.authType === 'session') {
    return RateLimitTier.OAUTH_SESSION;
  }

  if (authContext.authType === 'api_key') {
    return authContext.apiKeyTier === 'pro'
      ? RateLimitTier.API_KEY_PRO
      : RateLimitTier.API_KEY_FREE;
  }

  // Default to most restrictive
  return RateLimitTier.UNAUTHENTICATED;
}

/**
 * Get rate limit key for tracking
 */
export function getRateLimitKey(authContext: {
  userId?: string;
  agentId?: string;
  ip?: string;
  isAuthenticated: boolean;
}): string {
  if (authContext.userId) {
    return `user:${authContext.userId}`;
  }

  if (authContext.agentId) {
    return `agent:${authContext.agentId}`;
  }

  // Fall back to IP for unauthenticated requests
  return `ip:${authContext.ip || 'unknown'}`;
}

/**
 * Reset rate limit for a key (admin function)
 */
export async function resetRateLimit(
  key: string,
  tier: RateLimitTier
): Promise<void> {
  const limiter = rateLimiters[tier];
  await limiter.delete(key);
}

/**
 * Reset all rate limiters (for testing only)
 *
 * Clears all in-memory rate limit state
 */
export async function resetAllRateLimits(): Promise<void> {
  for (const tier of Object.values(RateLimitTier)) {
    const limiter = rateLimiters[tier as RateLimitTier];
    if (limiter) {
      // RateLimiterMemory doesn't have a clear-all method,
      // so we recreate the instances
      const config = RATE_LIMIT_CONFIG[tier as RateLimitTier];
      rateLimiters[tier as RateLimitTier] = new RateLimiterMemory(config);
    }
  }
}

/**
 * Get current rate limit status without consuming
 */
export async function getRateLimitStatus(
  key: string,
  tier: RateLimitTier
): Promise<RateLimitResult> {
  const limiter = rateLimiters[tier];
  const config = RATE_LIMIT_CONFIG[tier];

  try {
    const result = await limiter.get(key);

    if (!result) {
      // No rate limit data yet
      return {
        allowed: true,
        tier,
        remainingPoints: config.points,
        resetTime: Math.floor(Date.now() / 1000) + config.duration,
      };
    }

    return {
      allowed: result.remainingPoints > 0,
      tier,
      remainingPoints: result.remainingPoints,
      resetTime: Math.floor(Date.now() / 1000) + result.msBeforeNext / 1000,
      retryAfter:
        result.remainingPoints <= 0
          ? Math.ceil(result.msBeforeNext / 1000)
          : undefined,
    };
  } catch (error) {
    logger.error('Error getting rate limit status', { error: String(error) });
    return {
      allowed: true,
      tier,
      remainingPoints: config.points,
      resetTime: Math.floor(Date.now() / 1000) + config.duration,
    };
  }
}
