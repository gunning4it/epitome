import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recall } from '@/services/tools/recall';
import { ToolErrorCode } from '@/services/tools/types';
import type { ToolContext } from '@/services/tools/types';

// Mock the underlying services
vi.mock('@/services/tools/getUserContext', () => ({
  getUserContext: vi.fn(),
}));
vi.mock('@/services/tools/retrieveUserKnowledge', () => ({
  retrieveUserKnowledge: vi.fn(),
}));
vi.mock('@/services/tools/searchMemory', () => ({
  searchMemory: vi.fn(),
}));
vi.mock('@/services/tools/queryGraph', () => ({
  queryGraph: vi.fn(),
}));
vi.mock('@/services/tools/queryTable', () => ({
  queryTable: vi.fn(),
}));
vi.mock('@/services/tools/listTables', () => ({
  listTables: vi.fn(),
}));

import { getUserContext } from '@/services/tools/getUserContext';
import { retrieveUserKnowledge } from '@/services/tools/retrieveUserKnowledge';
import { searchMemory } from '@/services/tools/searchMemory';
import { queryGraph } from '@/services/tools/queryGraph';
import { queryTable } from '@/services/tools/queryTable';
import { listTables } from '@/services/tools/listTables';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('recall facade service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Default behavior (no mode) ─────────────────────────────────

  it('delegates to getUserContext when no topic is provided', async () => {
    const mockResult = {
      success: true as const,
      data: { profile: {}, tables: [], collections: [], topEntities: [], recentMemories: [], hints: {} },
      message: 'User context retrieved successfully.',
    };
    vi.mocked(getUserContext).mockResolvedValue(mockResult);

    const result = await recall({}, mockContext);

    expect(result).toBe(mockResult);
    expect(getUserContext).toHaveBeenCalledWith({}, mockContext);
    expect(retrieveUserKnowledge).not.toHaveBeenCalled();
  });

  it('delegates to getUserContext when topic is empty string', async () => {
    const mockResult = {
      success: true as const,
      data: { profile: {} },
      message: 'ok',
    };
    vi.mocked(getUserContext).mockResolvedValue(mockResult);

    const result = await recall({ topic: '' }, mockContext);

    expect(result).toBe(mockResult);
    expect(getUserContext).toHaveBeenCalledWith({}, mockContext);
    expect(retrieveUserKnowledge).not.toHaveBeenCalled();
  });

  it('delegates to retrieveUserKnowledge when topic is provided', async () => {
    const mockResult = {
      success: true as const,
      data: { topic: 'books', facts: [], sourcesQueried: [] },
      message: 'Retrieved 5 facts about "books"',
    };
    vi.mocked(retrieveUserKnowledge).mockResolvedValue(mockResult);

    const result = await recall({ topic: 'books' }, mockContext);

    expect(result).toBe(mockResult);
    expect(retrieveUserKnowledge).toHaveBeenCalledWith(
      { topic: 'books', budget: undefined },
      mockContext,
    );
    expect(getUserContext).not.toHaveBeenCalled();
  });

  it('forwards budget parameter to retrieveUserKnowledge', async () => {
    const mockResult = {
      success: true as const,
      data: { topic: 'food', facts: [] },
      message: 'ok',
    };
    vi.mocked(retrieveUserKnowledge).mockResolvedValue(mockResult);

    await recall({ topic: 'food', budget: 'deep' }, mockContext);

    expect(retrieveUserKnowledge).toHaveBeenCalledWith(
      { topic: 'food', budget: 'deep' },
      mockContext,
    );
  });

  it('propagates consent failures from getUserContext', async () => {
    const failureResult = {
      success: false as const,
      code: 'CONSENT_DENIED' as const,
      message: 'CONSENT_DENIED: No profile access',
      retryable: false,
    };
    vi.mocked(getUserContext).mockResolvedValue(failureResult as any);

    const result = await recall({}, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/CONSENT_DENIED/);
    }
  });

  it('propagates consent failures from retrieveUserKnowledge', async () => {
    const failureResult = {
      success: false as const,
      code: 'CONSENT_DENIED' as const,
      message: 'CONSENT_DENIED: No profile access',
      retryable: false,
    };
    vi.mocked(retrieveUserKnowledge).mockResolvedValue(failureResult as any);

    const result = await recall({ topic: 'test' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/CONSENT_DENIED/);
    }
  });

  // ── Explicit mode routing ──────────────────────────────────────

  it('mode:context delegates to getUserContext', async () => {
    const mockResult = {
      success: true as const,
      data: { profile: {} },
      message: 'ok',
    };
    vi.mocked(getUserContext).mockResolvedValue(mockResult);

    const result = await recall({ mode: 'context', topic: 'food' }, mockContext);

    expect(result).toBe(mockResult);
    expect(getUserContext).toHaveBeenCalledWith({ topic: 'food' }, mockContext);
  });

  it('mode:knowledge delegates to retrieveUserKnowledge', async () => {
    const mockResult = {
      success: true as const,
      data: { topic: 'food', facts: [] },
      message: 'ok',
    };
    vi.mocked(retrieveUserKnowledge).mockResolvedValue(mockResult);

    const result = await recall({ mode: 'knowledge', topic: 'food', budget: 'deep' }, mockContext);

    expect(result).toBe(mockResult);
    expect(retrieveUserKnowledge).toHaveBeenCalledWith(
      { topic: 'food', budget: 'deep' },
      mockContext,
    );
  });

  it('mode:knowledge without topic returns INVALID_ARGS', async () => {
    const result = await recall({ mode: 'knowledge' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/topic/);
    }
  });

  it('mode:memory delegates to searchMemory', async () => {
    const mockResult = {
      success: true as const,
      data: { results: [] },
      message: 'ok',
    };
    vi.mocked(searchMemory).mockResolvedValue(mockResult);

    const memoryArgs = { collection: 'journal', query: 'coffee', minSimilarity: 0.8 };
    const result = await recall({ mode: 'memory', memory: memoryArgs }, mockContext);

    expect(result).toBe(mockResult);
    expect(searchMemory).toHaveBeenCalledWith(memoryArgs, mockContext);
  });

  it('mode:memory without memory object returns INVALID_ARGS', async () => {
    const result = await recall({ mode: 'memory' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/memory/);
    }
  });

  it('mode:memory with missing collection returns INVALID_ARGS', async () => {
    const result = await recall(
      { mode: 'memory', memory: { collection: '', query: 'test' } as any },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/collection/);
    }
  });

  it('mode:memory with missing query returns INVALID_ARGS', async () => {
    const result = await recall(
      { mode: 'memory', memory: { collection: 'journal', query: '' } as any },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/query/);
    }
  });

  it('mode:graph delegates to queryGraph', async () => {
    const mockResult = {
      success: true as const,
      data: { entities: [] },
      message: 'ok',
    };
    vi.mocked(queryGraph).mockResolvedValue(mockResult);

    const graphArgs = { queryType: 'traverse' as const, entityId: 1, maxHops: 2 };
    const result = await recall({ mode: 'graph', graph: graphArgs }, mockContext);

    expect(result).toBe(mockResult);
    expect(queryGraph).toHaveBeenCalledWith(graphArgs, mockContext);
  });

  it('mode:graph without graph object returns INVALID_ARGS', async () => {
    const result = await recall({ mode: 'graph' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/graph/);
    }
  });

  it('mode:graph with missing queryType returns INVALID_ARGS', async () => {
    const result = await recall(
      { mode: 'graph', graph: { queryType: '' as any } },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/queryType/);
    }
  });

  it('mode:table delegates to queryTable', async () => {
    const mockResult = {
      success: true as const,
      data: { records: [] },
      message: 'ok',
    };
    vi.mocked(queryTable).mockResolvedValue(mockResult);

    const tableArgs = { table: 'meals', filters: { date: '2024-01-15' } };
    const result = await recall({ mode: 'table', table: tableArgs }, mockContext);

    expect(result).toBe(mockResult);
    expect(queryTable).toHaveBeenCalledWith(tableArgs, mockContext);
  });

  it('mode:table accepts table string shorthand and delegates to queryTable', async () => {
    const mockResult = {
      success: true as const,
      data: { records: [] },
      message: 'ok',
    };
    vi.mocked(queryTable).mockResolvedValue(mockResult);

    const result = await recall({ mode: 'table', table: 'books' as any }, mockContext);

    expect(result).toBe(mockResult);
    expect(queryTable).toHaveBeenCalledWith({ table: 'books' }, mockContext);
  });

  it('mode:table accepts top-level tableName shorthand and delegates to queryTable', async () => {
    const mockResult = {
      success: true as const,
      data: { records: [] },
      message: 'ok',
    };
    vi.mocked(queryTable).mockResolvedValue(mockResult);

    const result = await recall({ mode: 'table', tableName: 'books' } as any, mockContext);

    expect(result).toBe(mockResult);
    expect(queryTable).toHaveBeenCalledWith({ table: 'books' }, mockContext);
  });

  it('mode:table without table object delegates to listTables', async () => {
    const mockResult = {
      success: true as const,
      data: { tables: [] },
      message: 'Found 0 table(s)',
    };
    vi.mocked(listTables).mockResolvedValue(mockResult as any);

    const result = await recall({ mode: 'table' }, mockContext);

    expect(result).toBe(mockResult);
    expect(listTables).toHaveBeenCalledWith({}, mockContext);
    expect(queryTable).not.toHaveBeenCalled();
  });

  it('mode:table with empty table object delegates to listTables', async () => {
    const mockResult = {
      success: true as const,
      data: { tables: [{ name: 'books' }] },
      message: 'Found 1 table(s)',
    };
    vi.mocked(listTables).mockResolvedValue(mockResult as any);

    const result = await recall({ mode: 'table', table: {} }, mockContext);

    expect(result).toBe(mockResult);
    expect(listTables).toHaveBeenCalledWith({}, mockContext);
    expect(queryTable).not.toHaveBeenCalled();
  });

  it('unknown mode returns INVALID_ARGS', async () => {
    const result = await recall({ mode: 'foobar' as any }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/unknown mode/i);
    }
  });
});
