import { describe, it, expect, vi, beforeEach } from 'vitest';

// =====================================================
// Mocks — vi.hoisted() runs before vi.mock() hoisting
// =====================================================

const { mockSql, mockTx } = vi.hoisted(() => {
  const mockTx = Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve([] as unknown[])),
    { unsafe: vi.fn() }
  );

  const mockSql = Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve([] as unknown[])),
    {
      begin: vi.fn(),
      unsafe: vi.fn(),
    }
  );

  return { mockSql, mockTx };
});

vi.mock('@/db/client', () => ({
  sql: mockSql,
  withUserSchema: vi.fn(
    async <T>(_userId: string, fn: (tx: typeof mockTx) => Promise<T>): Promise<T> => fn(mockTx)
  ),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { TierLimitError } from '@/errors/tierLimit';
import { withTierLimitLock } from '@/services/metering.service';

// =====================================================
// Tests
// =====================================================

const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';

describe('TierLimitError', () => {
  it('has the correct error code', () => {
    const err = new TierLimitError('tables', 5, 5);
    expect(err.code).toBe('TIER_LIMIT_EXCEEDED');
  });

  it('has the correct resource field', () => {
    const err = new TierLimitError('agents', 3, 3);
    expect(err.resource).toBe('agents');
  });

  it('has the correct current and limit fields', () => {
    const err = new TierLimitError('graphEntities', 100, 100);
    expect(err.current).toBe(100);
    expect(err.limit).toBe(100);
  });

  it('formats the message as "Free tier limit reached: current/limit resource"', () => {
    const err = new TierLimitError('tables', 5, 5);
    expect(err.message).toBe('Free tier limit reached: 5/5 tables');
  });

  it('formats message correctly for different resources and counts', () => {
    const err = new TierLimitError('graphEntities', 100, 100);
    expect(err.message).toBe('Free tier limit reached: 100/100 graphEntities');
  });

  it('is an instance of Error', () => {
    const err = new TierLimitError('agents', 3, 3);
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of TierLimitError', () => {
    const err = new TierLimitError('tables', 5, 5);
    expect(err).toBeInstanceOf(TierLimitError);
  });

  it('has name set to "TierLimitError"', () => {
    const err = new TierLimitError('agents', 2, 3);
    expect(err.name).toBe('TierLimitError');
  });

  it('code is readonly and typed as "TIER_LIMIT_EXCEEDED"', () => {
    const err = new TierLimitError('tables', 1, 5);
    // TypeScript guarantees the readonly + const assertion.
    // At runtime, verify the value is exactly the literal string.
    const code: 'TIER_LIMIT_EXCEEDED' = err.code;
    expect(code).toBe('TIER_LIMIT_EXCEEDED');
  });

  it('can be caught and inspected via try/catch', () => {
    try {
      throw new TierLimitError('agents', 3, 3);
    } catch (e) {
      expect(e).toBeInstanceOf(TierLimitError);
      if (e instanceof TierLimitError) {
        expect(e.code).toBe('TIER_LIMIT_EXCEEDED');
        expect(e.resource).toBe('agents');
        expect(e.current).toBe(3);
        expect(e.limit).toBe(3);
      }
    }
  });
});

describe('withTierLimitLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-18T12:00:00Z'));
  });

  it('rejects invalid userId (non-UUID)', async () => {
    await expect(
      withTierLimitLock('not-a-uuid', 'free', 'tables', async () => 'ok')
    ).rejects.toThrow('Invalid userId format: must be a UUID');
  });

  it('runs fn in transaction for unlimited tier without checking count', async () => {
    // getTierLimits -> return pro defaults (unlimited)
    mockSql.mockResolvedValueOnce([
      {
        value: {
          max_tables: -1,
          max_agents: -1,
          max_graph_entities: -1,
          audit_retention_days: 365,
        },
      },
    ]);

    // sql.begin calls the callback with tx
    mockSql.begin.mockImplementationOnce(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      return fn(mockTx);
    });

    const result = await withTierLimitLock(TEST_USER_ID, 'pro', 'tables', async () => {
      return 'created';
    });

    expect(result).toBe('created');
    // Should have set search path for tables resource
    expect(mockTx.unsafe).toHaveBeenCalled();
  });

  it('throws TierLimitError when at the limit', async () => {
    // getTierLimits -> free tier limits
    mockSql.mockResolvedValueOnce([
      {
        value: {
          max_tables: 5,
          max_agents: 3,
          max_graph_entities: 100,
          audit_retention_days: 30,
        },
      },
    ]);

    // sql.begin calls the callback with tx
    mockSql.begin.mockImplementationOnce(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      return fn(mockTx);
    });

    // Advisory lock call
    mockTx.mockResolvedValueOnce([]);
    // countResource: tables count = 5 (at the limit)
    mockTx.mockResolvedValueOnce([{ count: 5 }]);

    await expect(
      withTierLimitLock(TEST_USER_ID, 'free', 'tables', async () => 'should not run')
    ).rejects.toThrow(TierLimitError);
  });

  it('allows operation when under the limit', async () => {
    // getTierLimits
    mockSql.mockResolvedValueOnce([
      {
        value: {
          max_tables: 5,
          max_agents: 3,
          max_graph_entities: 100,
          audit_retention_days: 30,
        },
      },
    ]);

    mockSql.begin.mockImplementationOnce(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      return fn(mockTx);
    });

    // Advisory lock
    mockTx.mockResolvedValueOnce([]);
    // countResource: tables count = 3 (under limit of 5)
    mockTx.mockResolvedValueOnce([{ count: 3 }]);

    const result = await withTierLimitLock(TEST_USER_ID, 'free', 'tables', async () => {
      return 'table-created';
    });

    expect(result).toBe('table-created');
  });

  it('runs fn without advisory lock for agents on unlimited tier', async () => {
    mockSql.mockResolvedValueOnce([
      {
        value: {
          max_tables: -1,
          max_agents: -1,
          max_graph_entities: -1,
          audit_retention_days: 365,
        },
      },
    ]);

    mockSql.begin.mockImplementationOnce(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      return fn(mockTx);
    });

    const result = await withTierLimitLock(TEST_USER_ID, 'pro', 'agents', async () => {
      return 'agent-registered';
    });

    expect(result).toBe('agent-registered');
    // agents resource on unlimited tier should NOT set search path
    expect(mockTx.unsafe).not.toHaveBeenCalled();
  });
});
