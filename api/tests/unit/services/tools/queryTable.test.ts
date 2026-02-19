import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryTable } from '@/services/tools/queryTable';
import { ToolErrorCode } from '@/services/tools/types';
import type { ToolContext } from '@/services/tools/types';

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

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { queryTableRecords } from '@/mcp/serviceWrappers.js';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';
import { recordAccess } from '@/services/memoryQuality.service';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('queryTable service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns INVALID_ARGS when table is missing', async () => {
    const result = await queryTable({}, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toBe('INVALID_ARGS: query_table requires "table" (or legacy "tableName").');
    }
  });

  it('accepts legacy tableName parameter', async () => {
    vi.mocked(queryTableRecords).mockResolvedValue([{ id: 1, name: 'salad' }] as any);

    const result = await queryTable({ tableName: 'meals' }, mockContext);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.table).toBe('meals');
      expect(result.data.recordCount).toBe(1);
    }
    expect(requireConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'tables/meals', 'read');
  });

  it('returns success with structured filter records', async () => {
    const mockRecords = [
      { id: 1, food: 'salad', calories: 200 },
      { id: 2, food: 'pasta', calories: 400 },
    ];
    vi.mocked(queryTableRecords).mockResolvedValue(mockRecords as any);

    const result = await queryTable(
      { table: 'meals', filters: { food: 'salad' }, limit: 10, offset: 0 },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.table).toBe('meals');
      expect(result.data.recordCount).toBe(2);
      expect(result.data.records).toEqual(mockRecords);
    }
    expect(queryTableRecords).toHaveBeenCalledWith('user-123', 'meals', {
      filters: { food: 'salad' },
      limit: 10,
      offset: 0,
    });
  });

  it('uses default limit/offset for structured filters', async () => {
    vi.mocked(queryTableRecords).mockResolvedValue([] as any);

    await queryTable({ table: 'meals' }, mockContext);

    expect(queryTableRecords).toHaveBeenCalledWith('user-123', 'meals', {
      filters: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it('uses SQL sandbox path when sql is provided', async () => {
    vi.mocked(executeSandboxedQuery).mockResolvedValue({
      rows: [{ id: 1, food: 'salad' }],
      rowCount: 1,
    } as any);

    const result = await queryTable(
      { table: 'meals', sql: 'SELECT * FROM meals LIMIT 5' },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recordCount).toBe(1);
    }
    expect(executeSandboxedQuery).toHaveBeenCalledWith(
      'user-123',
      'SELECT * FROM meals LIMIT 5',
      30,
      1000,
      { excludeSoftDeleted: true },
    );
  });

  it('calls recordAccess for SQL results with _meta_id', async () => {
    vi.mocked(executeSandboxedQuery).mockResolvedValue({
      rows: [
        { id: 1, _meta_id: 42 },
        { id: 2, _meta_id: 43 },
      ],
      rowCount: 2,
    } as any);

    await queryTable({ table: 'meals', sql: 'SELECT * FROM meals' }, mockContext);

    expect(recordAccess).toHaveBeenCalledTimes(2);
    expect(recordAccess).toHaveBeenCalledWith('user-123', 42);
    expect(recordAccess).toHaveBeenCalledWith('user-123', 43);
  });

  it('handles string _meta_id values', async () => {
    vi.mocked(executeSandboxedQuery).mockResolvedValue({
      rows: [{ id: 1, _meta_id: '99' }],
      rowCount: 1,
    } as any);

    await queryTable({ table: 'meals', sql: 'SELECT * FROM meals' }, mockContext);

    expect(recordAccess).toHaveBeenCalledWith('user-123', 99);
  });

  it('returns CONSENT_DENIED on missing consent', async () => {
    vi.mocked(requireConsent).mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'test-agent' does not have read access to tables/meals"),
    );

    const result = await queryTable({ table: 'meals' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
      expect(result.retryable).toBe(false);
    }
  });

  it('returns INTERNAL_ERROR on SQL sandbox failure', async () => {
    vi.mocked(executeSandboxedQuery).mockRejectedValue(new Error('SQL syntax error'));

    const result = await queryTable(
      { table: 'meals', sql: 'SELECT * FROM bad_syntax' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
      expect(result.message).toBe('SQL syntax error');
      expect(result.retryable).toBe(true);
    }
  });
});
