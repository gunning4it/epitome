import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =====================================================
// Mocks — vi.hoisted() runs before vi.mock() hoisting
// =====================================================

const { mockSql, mockTx, mockWithUserSchema } = vi.hoisted(() => {
  const mockTx = Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve([] as unknown[])),
    { unsafe: vi.fn() }
  );

  const mockWithUserSchema = vi.fn(
    async <T>(_userId: string, fn: (tx: typeof mockTx) => Promise<T>): Promise<T> => {
      return fn(mockTx);
    }
  );

  const mockSql = Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve([] as unknown[])),
    { begin: vi.fn(), unsafe: vi.fn() }
  );

  return { mockSql, mockTx, mockWithUserSchema };
});

vi.mock('@/db/client', () => ({
  sql: mockSql,
  withUserSchema: mockWithUserSchema,
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import {
  getTierLimits,
  softCheckLimit,
  recordApiCall,
  flushUsageCounters,
  getEffectiveTier,
  snapshotDailyUsage,
  getCurrentUsage,
} from '@/services/metering.service';

// =====================================================
// Helpers
// =====================================================

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * The limitsCache is module-level and persists across tests.
 * Its TTL is 5 minutes based on Date.now(). By advancing system
 * time by 10 minutes on each test, we guarantee all prior cache
 * entries are stale.
 */
let timeOffset = 0;

// =====================================================
// Tests
// =====================================================

describe('metering.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Each test gets a time 20min later than the previous, busting the 5min cache.
    // 20min is needed because some tests advance time internally (up to ~5min),
    // so a 10min gap could leave the cache entry within the TTL window.
    timeOffset += 20 * 60 * 1000;
    vi.setSystemTime(new Date(Date.UTC(2026, 1, 18, 12, 0, 0) + timeOffset));
    // Reset the default withUserSchema implementation (some tests override it)
    mockWithUserSchema.mockImplementation(
      async <T>(_userId: string, fn: (tx: typeof mockTx) => Promise<T>): Promise<T> => {
        return fn(mockTx);
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------
  // getTierLimits
  // ---------------------------------------------------
  describe('getTierLimits()', () => {
    it('returns limits from system_config on cache miss', async () => {
      mockSql.mockResolvedValueOnce([
        {
          value: {
            max_tables: 10,
            max_agents: 5,
            max_graph_entities: 200,
            audit_retention_days: 90,
          },
        },
      ]);

      const limits = await getTierLimits('free');

      expect(limits).toEqual({
        maxTables: 10,
        maxAgents: 5,
        maxGraphEntities: 200,
        auditRetentionDays: 90,
      });
      expect(mockSql).toHaveBeenCalledTimes(1);
    });

    it('returns cached limits on cache hit (within 5min TTL)', async () => {
      mockSql.mockResolvedValueOnce([
        {
          value: {
            max_tables: 10,
            max_agents: 5,
            max_graph_entities: 200,
            audit_retention_days: 90,
          },
        },
      ]);

      // First call — cache miss, fetches from DB
      const first = await getTierLimits('pro');
      expect(mockSql).toHaveBeenCalledTimes(1);

      // Advance 2 minutes (within TTL)
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Second call — cache hit, no additional DB query
      const second = await getTierLimits('pro');
      expect(mockSql).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('refetches after cache TTL expires (5min)', async () => {
      mockSql
        .mockResolvedValueOnce([
          { value: { max_tables: 10, max_agents: 5, max_graph_entities: 200, audit_retention_days: 90 } },
        ])
        .mockResolvedValueOnce([
          { value: { max_tables: 20, max_agents: 10, max_graph_entities: 500, audit_retention_days: 180 } },
        ]);

      const first = await getTierLimits('free');
      expect(first.maxTables).toBe(10);
      expect(mockSql).toHaveBeenCalledTimes(1);

      // Advance past 5min TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const refreshed = await getTierLimits('free');
      expect(mockSql).toHaveBeenCalledTimes(2);
      expect(refreshed.maxTables).toBe(20);
    });

    it('falls back to free defaults when system_config has no entry', async () => {
      mockSql.mockResolvedValueOnce([]); // No rows

      const limits = await getTierLimits('free');

      expect(limits).toEqual({
        maxTables: 5,
        maxAgents: 3,
        maxGraphEntities: 100,
        auditRetentionDays: 30,
      });
    });

    it('falls back to pro defaults when system_config has no entry', async () => {
      mockSql.mockResolvedValueOnce([]);

      const limits = await getTierLimits('pro');

      expect(limits).toEqual({
        maxTables: -1,
        maxAgents: -1,
        maxGraphEntities: -1,
        auditRetentionDays: 365,
      });
    });

    it('falls back to enterprise defaults when system_config has no entry', async () => {
      mockSql.mockResolvedValueOnce([]);

      const limits = await getTierLimits('enterprise');

      expect(limits).toEqual({
        maxTables: -1,
        maxAgents: -1,
        maxGraphEntities: -1,
        auditRetentionDays: -1,
      });
    });

    it('uses free defaults for partial config (missing fields)', async () => {
      mockSql.mockResolvedValueOnce([
        { value: { max_tables: 8 } }, // Only max_tables provided
      ]);

      const limits = await getTierLimits('free');

      expect(limits.maxTables).toBe(8);
      // Remaining fields use free-tier defaults
      expect(limits.maxAgents).toBe(3);
      expect(limits.maxGraphEntities).toBe(100);
      expect(limits.auditRetentionDays).toBe(30);
    });
  });

  // ---------------------------------------------------
  // softCheckLimit
  // ---------------------------------------------------
  describe('softCheckLimit()', () => {
    it('returns under limit when current count < limit', async () => {
      // getTierLimits call
      mockSql.mockResolvedValueOnce([
        { value: { max_tables: 5, max_agents: 3, max_graph_entities: 100, audit_retention_days: 30 } },
      ]);
      // withUserSchema -> tx query for tables count
      mockTx.mockResolvedValueOnce([{ count: 2 }]);

      const result = await softCheckLimit(TEST_USER_ID, 'free', 'tables');

      expect(result).toEqual({ current: 2, limit: 5, exceeded: false });
    });

    it('returns exceeded when current count >= limit', async () => {
      mockSql.mockResolvedValueOnce([
        { value: { max_tables: 5, max_agents: 3, max_graph_entities: 100, audit_retention_days: 30 } },
      ]);
      mockTx.mockResolvedValueOnce([{ count: 5 }]);

      const result = await softCheckLimit(TEST_USER_ID, 'free', 'tables');

      expect(result).toEqual({ current: 5, limit: 5, exceeded: true });
    });

    it('returns unlimited (limit=-1, exceeded=false) for pro tier', async () => {
      mockSql.mockResolvedValueOnce([
        { value: { max_tables: -1, max_agents: -1, max_graph_entities: -1, audit_retention_days: 365 } },
      ]);

      const result = await softCheckLimit(TEST_USER_ID, 'pro', 'tables');

      expect(result).toEqual({ current: 0, limit: -1, exceeded: false });
      // Should NOT have queried for current count since limit is -1
      expect(mockWithUserSchema).not.toHaveBeenCalled();
    });

    it('checks agents count via sql (not withUserSchema)', async () => {
      mockSql
        .mockResolvedValueOnce([
          { value: { max_tables: 5, max_agents: 3, max_graph_entities: 100, audit_retention_days: 30 } },
        ])
        .mockResolvedValueOnce([{ count: 1 }]); // agents count query

      const result = await softCheckLimit(TEST_USER_ID, 'free', 'agents');

      expect(result).toEqual({ current: 1, limit: 3, exceeded: false });
      // agents query goes through sql directly, not withUserSchema
      expect(mockWithUserSchema).not.toHaveBeenCalled();
    });

    it('checks graphEntities count via withUserSchema', async () => {
      mockSql.mockResolvedValueOnce([
        { value: { max_tables: 5, max_agents: 3, max_graph_entities: 100, audit_retention_days: 30 } },
      ]);
      mockTx.mockResolvedValueOnce([{ count: 42 }]);

      const result = await softCheckLimit(TEST_USER_ID, 'free', 'graphEntities');

      expect(result).toEqual({ current: 42, limit: 100, exceeded: false });
      expect(mockWithUserSchema).toHaveBeenCalledWith(TEST_USER_ID, expect.any(Function));
    });
  });

  // ---------------------------------------------------
  // recordApiCall + flushUsageCounters
  // ---------------------------------------------------
  describe('recordApiCall() + flushUsageCounters()', () => {
    it('buffers a single api call and flushes it to DB', async () => {
      mockSql.mockResolvedValue([]);

      await recordApiCall(TEST_USER_ID, 'api_calls', 'agent-1');

      // Nothing flushed yet — just buffered
      const callsBefore = mockSql.mock.calls.length;

      await flushUsageCounters();

      // Now the upsert should have been called
      expect(mockSql.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('accumulates multiple calls for the same key', async () => {
      mockSql.mockResolvedValue([]);

      await recordApiCall(TEST_USER_ID, 'api_calls', 'agent-1');
      await recordApiCall(TEST_USER_ID, 'api_calls', 'agent-1');
      await recordApiCall(TEST_USER_ID, 'api_calls', 'agent-1');

      await flushUsageCounters();

      // Should have flushed once with count=3 (single key accumulated)
      const flushCalls = mockSql.mock.calls;
      expect(flushCalls.length).toBe(1);
    });

    it('uses __aggregate__ when no agentId is provided', async () => {
      mockSql.mockResolvedValue([]);

      await recordApiCall(TEST_USER_ID, 'mcp_calls');

      await flushUsageCounters();

      // The flush SQL should have been called; the agent value should be null
      expect(mockSql).toHaveBeenCalled();
    });

    it('flushUsageCounters is a no-op when buffer is empty', async () => {
      mockSql.mockClear();

      await flushUsageCounters();

      expect(mockSql).not.toHaveBeenCalled();
    });

    it('handles different resources and dates as separate keys', async () => {
      mockSql.mockResolvedValue([]);

      await recordApiCall(TEST_USER_ID, 'api_calls', 'agent-1');
      await recordApiCall(TEST_USER_ID, 'mcp_calls', 'agent-1');

      await flushUsageCounters();

      // Two distinct keys should produce two SQL calls
      expect(mockSql).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------
  // getEffectiveTier
  // ---------------------------------------------------
  describe('getEffectiveTier()', () => {
    function createMockContext(overrides: Record<string, unknown> = {}) {
      const store = new Map<string, unknown>(Object.entries(overrides));
      return {
        get: (key: string) => store.get(key),
        set: (key: string, value: unknown) => store.set(key, value),
      } as unknown as import('hono').Context<import('@/types/hono').HonoEnv>;
    }

    it('returns "free" by default when no tier or x402 set', () => {
      const c = createMockContext({});
      expect(getEffectiveTier(c)).toBe('free');
    });

    it('returns "pro" when x402Paid is true (overrides tier)', () => {
      const c = createMockContext({ x402Paid: true, tier: 'free' });
      expect(getEffectiveTier(c)).toBe('pro');
    });

    it('returns tier from context when x402Paid is not set', () => {
      const c = createMockContext({ tier: 'enterprise' });
      expect(getEffectiveTier(c)).toBe('enterprise');
    });

    it('returns the stored tier (pro) when no x402 payment', () => {
      const c = createMockContext({ tier: 'pro' });
      expect(getEffectiveTier(c)).toBe('pro');
    });

    it('treats falsy x402Paid as no payment', () => {
      const c = createMockContext({ x402Paid: false, tier: 'free' });
      expect(getEffectiveTier(c)).toBe('free');
    });
  });

  // ---------------------------------------------------
  // snapshotDailyUsage
  // ---------------------------------------------------
  describe('snapshotDailyUsage()', () => {
    it('calls getCurrentUsage for each user and upserts results', async () => {
      // First sql call: SELECT id FROM public.users
      mockSql.mockResolvedValueOnce([
        { id: 'user-aaa' },
        { id: 'user-bbb' },
      ]);

      // For getCurrentUsage (user-aaa):
      // - withUserSchema for tables count
      mockTx.mockResolvedValueOnce([{ count: 3 }]);
      // - sql for agents count
      mockSql.mockResolvedValueOnce([{ count: 1 }]);
      // - withUserSchema for graphEntities count
      mockTx.mockResolvedValueOnce([{ count: 50 }]);
      // - 3 upsert calls for user-aaa (tables, agents, graphEntities)
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);

      // For getCurrentUsage (user-bbb):
      mockTx.mockResolvedValueOnce([{ count: 1 }]);
      mockSql.mockResolvedValueOnce([{ count: 0 }]);
      mockTx.mockResolvedValueOnce([{ count: 10 }]);
      // 3 upsert calls for user-bbb
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);

      await snapshotDailyUsage();

      // 1 (user list) + 1 (agents aaa) + 3 (upserts aaa) + 1 (agents bbb) + 3 (upserts bbb) = 9
      expect(mockSql.mock.calls.length).toBe(9);
      // withUserSchema called 2x per user (tables + graphEntities) * 2 users = 4
      expect(mockWithUserSchema).toHaveBeenCalledTimes(4);
    });

    it('continues processing remaining users when one user fails', async () => {
      mockSql.mockResolvedValueOnce([
        { id: 'user-fail' },
        { id: 'user-ok' },
      ]);

      // user-fail: withUserSchema throws on first call (tables count for user-fail)
      mockWithUserSchema.mockRejectedValueOnce(new Error('schema not found'));

      // user-ok: restore normal implementation for remaining calls
      mockWithUserSchema.mockImplementation(
        async <T>(_userId: string, fn: (tx: typeof mockTx) => Promise<T>): Promise<T> => fn(mockTx)
      );
      mockTx.mockResolvedValueOnce([{ count: 2 }]);
      mockSql.mockResolvedValueOnce([{ count: 0 }]);
      mockTx.mockResolvedValueOnce([{ count: 5 }]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);

      // Should not throw — errors are caught per-user
      await expect(snapshotDailyUsage()).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------
  // getCurrentUsage
  // ---------------------------------------------------
  describe('getCurrentUsage()', () => {
    it('returns combined counts from tables, agents, and graphEntities', async () => {
      // withUserSchema for tables
      mockTx.mockResolvedValueOnce([{ count: 4 }]);
      // sql for agents
      mockSql.mockResolvedValueOnce([{ count: 2 }]);
      // withUserSchema for graphEntities
      mockTx.mockResolvedValueOnce([{ count: 75 }]);

      const usage = await getCurrentUsage(TEST_USER_ID);

      expect(usage).toEqual({
        tables: 4,
        agents: 2,
        graphEntities: 75,
      });
    });
  });
});
