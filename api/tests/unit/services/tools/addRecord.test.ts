import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addRecord } from '@/services/tools/addRecord';
import type { ToolContext } from '@/services/tools/types';
import { ToolErrorCode } from '@/services/tools/types';

// Mock dependencies
vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));
vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));
vi.mock('@/services/writeIngestion.service', () => ({
  createWriteId: vi.fn(() => 'write-456'),
  ingestTableRecord: vi.fn(),
  ingestMemoryText: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { ingestTableRecord, ingestMemoryText } from '@/services/writeIngestion.service';

const mockRequireConsent = vi.mocked(requireConsent);
const mockLogAuditEntry = vi.mocked(logAuditEntry);
const mockIngestTableRecord = vi.mocked(ingestTableRecord);
const mockIngestMemoryText = vi.mocked(ingestMemoryText);

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    userId: 'user-1',
    agentId: 'agent-1',
    tier: 'free',
    authType: 'api_key',
    schemaName: 'user_user1',
    requestId: 'req-1',
    ...overrides,
  };
}

const tableResult = {
  recordId: 42,
  sourceRef: 'meals:42',
  writeId: 'write-456',
  writeStatus: 'accepted' as const,
  jobId: 8,
};

describe('addRecord service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireConsent.mockResolvedValue(undefined);
    mockLogAuditEntry.mockResolvedValue(undefined);
    mockIngestTableRecord.mockResolvedValue(tableResult);
    mockIngestMemoryText.mockResolvedValue({
      vectorId: 10,
      sourceRef: 'meals:10',
      writeId: 'write-456',
      writeStatus: 'accepted',
    });
  });

  it('returns INVALID_ARGS when neither table nor tableName provided', async () => {
    const result = await addRecord(
      { data: { food: 'pizza' } },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
    expect(result.message).toBe('INVALID_ARGS: add_record requires "table" (or legacy "tableName").');
  });

  it('accepts table parameter', async () => {
    const result = await addRecord(
      { table: 'meals', data: { food: 'pizza' } },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.table).toBe('meals');
  });

  it('accepts legacy tableName parameter', async () => {
    const result = await addRecord(
      { tableName: 'meals', data: { food: 'pizza' } },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.table).toBe('meals');
  });

  it('prefers table over tableName when both provided', async () => {
    const result = await addRecord(
      { table: 'meals', tableName: 'old_meals', data: { food: 'pizza' } },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.table).toBe('meals');
  });

  it('returns success with correct data shape', async () => {
    const result = await addRecord(
      { table: 'meals', data: { food: 'pizza', calories: 300 } },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      success: true,
      table: 'meals',
      recordId: 42,
      sourceRef: 'meals:42',
      writeId: 'write-456',
      writeStatus: 'accepted',
      jobId: 8,
      message: 'Record added successfully',
    });
  });

  it('checks consent for tables/<table> write', async () => {
    await addRecord(
      { table: 'meals', data: { food: 'pizza' } },
      makeCtx(),
    );

    expect(mockRequireConsent).toHaveBeenCalledWith('user-1', 'agent-1', 'tables/meals', 'write');
  });

  it('returns CONSENT_DENIED on consent failure', async () => {
    mockRequireConsent.mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'agent-1' does not have write access to tables/meals"),
    );

    const result = await addRecord(
      { table: 'meals', data: { food: 'pizza' } },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
  });

  it('logs audit entry with table info', async () => {
    await addRecord(
      { table: 'meals', data: { food: 'pizza' }, tableDescription: 'Daily meals' },
      makeCtx(),
    );

    expect(mockLogAuditEntry).toHaveBeenCalledWith('user-1', {
      agentId: 'agent-1',
      action: 'mcp_add_record',
      resource: 'tables/meals',
      details: {
        tableDescription: 'Daily meals',
        fields: ['food'],
      },
    });
  });

  it('passes tier to ingestTableRecord', async () => {
    await addRecord(
      { table: 'meals', data: { food: 'pizza' } },
      makeCtx({ tier: 'pro' }),
    );

    expect(mockIngestTableRecord).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'pro' }),
    );
  });

  it('fires ingestMemoryText as side effect', async () => {
    await addRecord(
      { table: 'meals', data: { food: 'pizza', calories: 300 } },
      makeCtx(),
    );

    expect(mockIngestMemoryText).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        collection: 'meals',
        text: 'meals: food: pizza, calories: 300',
        metadata: expect.objectContaining({
          source: 'add_record',
          agent: 'agent-1',
          table: 'meals',
          record_id: 42,
        }),
      }),
    );
  });

  it('returns INTERNAL_ERROR when ingestTableRecord throws', async () => {
    mockIngestTableRecord.mockRejectedValue(new Error('DB connection lost'));

    const result = await addRecord(
      { table: 'meals', data: { food: 'pizza' } },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe('DB connection lost');
    expect(result.retryable).toBe(true);
  });
});
