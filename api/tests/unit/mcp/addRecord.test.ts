import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));

vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));

vi.mock('@/services/writeIngestion.service', () => ({
  createWriteId: vi.fn(() => 'write-test-1'),
  ingestTableRecord: vi.fn(),
  ingestMemoryText: vi.fn(),
}));

import { addRecord } from '@/mcp/tools/addRecord';
import { ingestTableRecord } from '@/services/writeIngestion.service';
import type { McpContext } from '@/mcp/server';

const ingestTableRecordMock = vi.mocked(ingestTableRecord);

describe('mcp add_record', () => {
  const context: McpContext = {
    userId: 'u1',
    agentId: 'claude',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ingestTableRecordMock.mockResolvedValue({
      recordId: 12,
      sourceRef: 'meals:12',
      writeId: 'write-test-1',
      writeStatus: 'accepted',
      jobId: 99,
    });
  });

  it('accepts legacy tableName argument for backward compatibility', async () => {
    const result = await addRecord(
      {
        tableName: 'meals',
        data: { food: 'breakfast burrito' },
      },
      context
    );

    expect(ingestTableRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: 'meals',
      })
    );
    expect(result.table).toBe('meals');
    expect(result.recordId).toBe(12);
  });

  it('throws invalid args when table/tableName are both missing', async () => {
    await expect(
      addRecord(
        {
          data: { food: 'breakfast burrito' },
        } as any,
        context
      )
    ).rejects.toThrow(/INVALID_ARGS/);
  });
});
