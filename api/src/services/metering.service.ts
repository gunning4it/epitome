/**
 * Metering Service
 *
 * Usage counting, tier limit enforcement, and buffered usage tracking.
 *
 * - Live counts (for enforcement — always accurate, runs inside advisory lock)
 * - Tier limits from system_config (cached 5min)
 * - withTierLimitLock: callback-style atomic check+create
 * - Buffered increment: non-authoritative counters for dashboard analytics
 * - getEffectiveTier: resolves x402 payment → pro tier override
 */

import { sql, withUserSchema, type TransactionSql } from '@/db/client';
import { TierLimitError } from '@/errors/tierLimit';
import { logger } from '@/utils/logger';
import type { Context } from 'hono';
import type { HonoEnv } from '@/types/hono';

// =====================================================
// TIER LIMITS (cached from system_config)
// =====================================================

export interface TierLimits {
  maxTables: number;
  maxAgents: number;
  maxGraphEntities: number;
  auditRetentionDays: number;
}

const limitsCache = new Map<string, { limits: TierLimits; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read tier limits from system_config, cached for 5 minutes.
 */
export async function getTierLimits(tier: 'free' | 'pro' | 'enterprise'): Promise<TierLimits> {
  const cached = limitsCache.get(tier);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.limits;
  }

  const configKey = `tier_limits_${tier}`;
  const rows = await sql`
    SELECT value FROM system_config WHERE key = ${configKey} LIMIT 1
  `;

  if (rows.length > 0 && rows[0].value) {
    const v = rows[0].value as Record<string, number>;
    const limits: TierLimits = {
      maxTables: v.max_tables ?? (tier === 'free' ? 2 : -1),
      maxAgents: v.max_agents ?? (tier === 'free' ? 3 : -1),
      maxGraphEntities: v.max_graph_entities ?? (tier === 'free' ? 100 : -1),
      auditRetentionDays: v.audit_retention_days ?? (tier === 'free' ? 30 : 365),
    };
    limitsCache.set(tier, { limits, fetchedAt: Date.now() });
    return limits;
  }

  // Fallback defaults if no system_config entry
  const defaults: Record<string, TierLimits> = {
    free: { maxTables: 2, maxAgents: 3, maxGraphEntities: 100, auditRetentionDays: 30 },
    pro: { maxTables: -1, maxAgents: -1, maxGraphEntities: -1, auditRetentionDays: 365 },
    enterprise: { maxTables: -1, maxAgents: -1, maxGraphEntities: -1, auditRetentionDays: -1 },
  };

  const limits = defaults[tier] || defaults.free;
  limitsCache.set(tier, { limits, fetchedAt: Date.now() });
  return limits;
}

// =====================================================
// LIVE COUNTS (for enforcement)
// =====================================================

const RESOURCE_TO_LIMIT_KEY: Record<string, keyof TierLimits> = {
  tables: 'maxTables',
  agents: 'maxAgents',
  graphEntities: 'maxGraphEntities',
};

/**
 * Count current resource usage for a user.
 * Runs inside an existing transaction.
 */
async function countResource(
  tx: TransactionSql,
  userId: string,
  resource: 'tables' | 'agents' | 'graphEntities'
): Promise<number> {
  if (resource === 'tables') {
    // Count from user schema _table_registry
    const rows = await tx`SELECT COUNT(*)::int AS count FROM _table_registry`;
    return rows[0]?.count ?? 0;
  }

  if (resource === 'agents') {
    // Count active (non-revoked) API keys with an agentId
    const rows = await tx`
      SELECT COUNT(DISTINCT agent_id)::int AS count
      FROM public.api_keys
      WHERE user_id = ${userId}
        AND agent_id IS NOT NULL
        AND revoked_at IS NULL
    `;
    return rows[0]?.count ?? 0;
  }

  if (resource === 'graphEntities') {
    const rows = await tx`
      SELECT COUNT(*)::int AS count FROM entities WHERE _deleted_at IS NULL
    `;
    return rows[0]?.count ?? 0;
  }

  return 0;
}

/**
 * Get current live usage counts for a user (for display, not enforcement).
 */
export async function getCurrentUsage(userId: string): Promise<{
  tables: number;
  agents: number;
  graphEntities: number;
}> {
  const tables = await withUserSchema(userId, async (tx) => {
    const rows = await tx`SELECT COUNT(*)::int AS count FROM _table_registry`;
    return rows[0]?.count ?? 0;
  });

  const agentRows = await sql`
    SELECT COUNT(DISTINCT agent_id)::int AS count
    FROM public.api_keys
    WHERE user_id = ${userId}
      AND agent_id IS NOT NULL
      AND revoked_at IS NULL
  `;
  const agents = agentRows[0]?.count ?? 0;

  const graphEntities = await withUserSchema(userId, async (tx) => {
    const rows = await tx`SELECT COUNT(*)::int AS count FROM entities WHERE _deleted_at IS NULL`;
    return rows[0]?.count ?? 0;
  });

  return { tables, agents, graphEntities };
}

// =====================================================
// ADVISORY LOCK ENFORCEMENT
// =====================================================

/**
 * Hash a string to a 32-bit integer for pg_advisory_xact_lock.
 */
function hashToInt(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Callback-style atomic limit check + operation.
 *
 * Acquires an advisory lock for the user+resource pair, checks the current
 * count against the tier limit, and if allowed, runs `fn` inside the same
 * transaction. If the limit is exceeded, throws TierLimitError (never calls fn).
 *
 * For 'tables' and 'graphEntities', the count query runs against user schema
 * tables, so the transaction sets the search path first.
 */
export async function withTierLimitLock<T>(
  userId: string,
  tier: string,
  resource: 'tables' | 'agents' | 'graphEntities',
  fn: (tx: TransactionSql) => Promise<T>
): Promise<T> {
  // Strict UUID validation
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Invalid userId format: must be a UUID');
  }

  const schemaName = `user_${userId.replace(/-/g, '')}`;
  const lockKey = hashToInt(`${userId}:${resource}`);
  const limits = await getTierLimits(tier as 'free' | 'pro' | 'enterprise');
  const limitValue = limits[RESOURCE_TO_LIMIT_KEY[resource]];

  // -1 means unlimited (pro/enterprise)
  if (limitValue === -1) {
    // No limit — still run in user schema context for tables/graphEntities
    if (resource === 'tables' || resource === 'graphEntities') {
      return await sql.begin(async (rawTx) => {
        const tx = rawTx as TransactionSql;
        await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public`);
        return await fn(tx);
      }) as T;
    }
    // agents don't need user schema
    return await sql.begin(async (rawTx) => {
      const tx = rawTx as TransactionSql;
      return await fn(tx);
    }) as T;
  }

  // Enforce limit with advisory lock
  return await sql.begin(async (rawTx) => {
    const tx = rawTx as TransactionSql;

    // Set search path for user-schema resources
    if (resource === 'tables' || resource === 'graphEntities') {
      await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public`);
    }

    // Advisory lock: prevents concurrent requests for same user+resource
    await tx`SELECT pg_advisory_xact_lock(${lockKey})`;

    const current = await countResource(tx, userId, resource);

    if (current >= limitValue) {
      throw new TierLimitError(resource, current, limitValue);
    }

    return await fn(tx);
  }) as T;
}

/**
 * Non-locking soft limit check (for async operations like entity extraction).
 * Returns current count and limit without holding a lock.
 */
export async function softCheckLimit(
  userId: string,
  tier: string,
  resource: 'tables' | 'agents' | 'graphEntities'
): Promise<{ current: number; limit: number; exceeded: boolean }> {
  const limits = await getTierLimits(tier as 'free' | 'pro' | 'enterprise');
  const limitValue = limits[RESOURCE_TO_LIMIT_KEY[resource]];

  if (limitValue === -1) {
    return { current: 0, limit: -1, exceeded: false };
  }

  let current = 0;
  if (resource === 'tables') {
    current = await withUserSchema(userId, async (tx) => {
      const rows = await tx`SELECT COUNT(*)::int AS count FROM _table_registry`;
      return rows[0]?.count ?? 0;
    });
  } else if (resource === 'agents') {
    const rows = await sql`
      SELECT COUNT(DISTINCT agent_id)::int AS count
      FROM public.api_keys
      WHERE user_id = ${userId}
        AND agent_id IS NOT NULL
        AND revoked_at IS NULL
    `;
    current = rows[0]?.count ?? 0;
  } else if (resource === 'graphEntities') {
    current = await withUserSchema(userId, async (tx) => {
      const rows = await tx`SELECT COUNT(*)::int AS count FROM entities WHERE _deleted_at IS NULL`;
      return rows[0]?.count ?? 0;
    });
  }

  return { current, limit: limitValue, exceeded: current >= limitValue };
}

// =====================================================
// EFFECTIVE TIER RESOLUTION
// =====================================================

/**
 * Resolve the effective tier for a request.
 * x402 payment verified → treat as pro (agent paid for this call).
 * Otherwise use tier from auth resolver.
 */
export function getEffectiveTier(c: Context<HonoEnv>): 'free' | 'pro' | 'enterprise' {
  if (c.get('x402Paid')) return 'pro';
  return (c.get('tier') as 'free' | 'pro' | 'enterprise') || 'free';
}

// =====================================================
// BUFFERED USAGE COUNTERS (non-authoritative, for dashboard)
// =====================================================

const counterBuffer = new Map<string, number>();
let flushInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Buffer a usage increment (flushed every 10s).
 * Key format: "userId:resource:YYYY-MM-DD:agentId"
 */
export async function recordApiCall(
  userId: string,
  resource: 'api_calls' | 'mcp_calls',
  agentId?: string
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${resource}:${date}:${agentId || '__aggregate__'}`;
  counterBuffer.set(key, (counterBuffer.get(key) || 0) + 1);
}

/**
 * Flush buffered counters to DB using ON CONFLICT upsert.
 */
export async function flushUsageCounters(): Promise<void> {
  if (counterBuffer.size === 0) return;

  const entries = Array.from(counterBuffer.entries());
  counterBuffer.clear();

  for (const [key, count] of entries) {
    const [userId, resource, date, agentId] = key.split(':');
    const agentValue = agentId === '__aggregate__' ? null : agentId;

    try {
      await sql`
        INSERT INTO public.usage_records (user_id, resource, count, period_date, agent_id, updated_at)
        VALUES (${userId}, ${resource}, ${count}, ${date}::date, ${agentValue}, NOW())
        ON CONFLICT (user_id, resource, period_date, COALESCE(agent_id, '__aggregate__'))
        DO UPDATE SET
          count = usage_records.count + EXCLUDED.count,
          updated_at = NOW()
      `;
    } catch (err) {
      logger.error('Failed to flush usage counter', { key, count, error: String(err) });
    }
  }
}

/**
 * Start the periodic flush interval (call on server startup).
 */
export function startMeteringFlush(): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    flushUsageCounters().catch((err) => {
      logger.error('Metering flush error', { error: String(err) });
    });
  }, 10_000);
}

/**
 * Stop the flush interval and flush remaining (call on server shutdown).
 */
export function stopMeteringFlush(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  // Flush remaining counters synchronously-ish
  flushUsageCounters().catch((err) => {
    logger.error('Final metering flush error', { error: String(err) });
  });
}

/**
 * Snapshot daily usage for all users (called from scheduler).
 * Records current live counts as usage_records entries.
 */
export async function snapshotDailyUsage(): Promise<void> {
  const userRows = await sql`SELECT id FROM public.users`;
  const today = new Date().toISOString().slice(0, 10);

  for (const row of userRows) {
    try {
      const usage = await getCurrentUsage(row.id);

      for (const [resource, count] of Object.entries(usage) as Array<[string, number]>) {
        const dbResource = resource === 'graphEntities' ? 'graph_entities' : resource;
        await sql`
          INSERT INTO public.usage_records (user_id, resource, count, period_date, updated_at)
          VALUES (${row.id}, ${dbResource}, ${count}, ${today}::date, NOW())
          ON CONFLICT (user_id, resource, period_date, COALESCE(agent_id, '__aggregate__'))
          DO UPDATE SET
            count = EXCLUDED.count,
            updated_at = NOW()
        `;
      }
    } catch (err) {
      logger.error('Failed to snapshot usage for user', { userId: row.id, error: String(err) });
    }
  }
}
