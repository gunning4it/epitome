import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));

vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));

vi.mock('@/mcp/serviceWrappers.js', () => ({
  queryTableRecords: vi.fn(),
}));

vi.mock('@/services/sqlSandbox.service', () => ({
  executeSandboxedQuery: vi.fn(),
}));

vi.mock('@/services/memoryQuality.service', () => ({
  recordAccess: vi.fn(),
}));

import { queryTable } from '@/mcp/tools/queryTable';
import { queryTableRecords } from '@/mcp/serviceWrappers.js';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';
import { recordAccess } from '@/services/memoryQuality.service';
import type { McpContext } from '@/mcp/server';

const queryTableRecordsMock = vi.mocked(queryTableRecords);
const executeSandboxedQueryMock = vi.mocked(executeSandboxedQuery);
const recordAccessMock = vi.mocked(recordAccess);

describe('mcp query_table', () => {
  const context: McpContext = {
    userId: 'u1',
    agentId: 'claude',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts legacy tableName argument for structured query', async () => {
    queryTableRecordsMock.mockResolvedValue([{ id: 1, food: 'street tacos' }] as any);

    const result = await queryTable(
      {
        tableName: 'meals',
        filters: { food: 'street tacos' },
      },
      context
    );

    expect(queryTableRecordsMock).toHaveBeenCalledWith(
      'u1',
      'meals',
      expect.objectContaining({
        filters: { food: 'street tacos' },
      })
    );
    expect(result.table).toBe('meals');
    expect(result.recordCount).toBe(1);
  });

  it('accepts legacy tableName argument for SQL mode', async () => {
    executeSandboxedQueryMock.mockResolvedValue({
      rows: [{ id: 2, food: 'carne asada tacos' }],
      executionTime: 10,
      truncated: false,
    });

    const result = await queryTable(
      {
        tableName: 'meals',
        sql: 'SELECT * FROM meals',
      },
      context
    );

    expect(executeSandboxedQueryMock).toHaveBeenCalledWith(
      'u1',
      'SELECT * FROM meals',
      30,
      1000,
      { excludeSoftDeleted: true }
    );
    expect(result.table).toBe('meals');
    expect(result.recordCount).toBe(1);
    expect(recordAccessMock).not.toHaveBeenCalled();
  });

  it('records access reinforcement for SQL rows with _meta_id', async () => {
    executeSandboxedQueryMock.mockResolvedValue({
      rows: [
        { id: 2, food: 'carne asada tacos', _meta_id: 17 },
        { id: 3, food: 'fish taco', _meta_id: '17' },
        { id: 4, food: 'burrito', _meta_id: 21 },
      ],
      executionTime: 10,
      truncated: false,
    });

    await queryTable(
      {
        tableName: 'meals',
        sql: 'SELECT * FROM meals',
      },
      context
    );

    expect(recordAccessMock).toHaveBeenCalledTimes(2);
    expect(recordAccessMock).toHaveBeenCalledWith('u1', 17);
    expect(recordAccessMock).toHaveBeenCalledWith('u1', 21);
  });

  it('throws invalid args when table/tableName are both missing', async () => {
    await expect(
      queryTable(
        {
          filters: { food: 'burrito' },
        } as any,
        context
      )
    ).rejects.toThrow(/INVALID_ARGS/);
  });
});
