// api/tests/unit/services/tools/listTables.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listTables } from '@/services/tools/listTables';
import { ToolErrorCode } from '@/services/tools/types';
import type { ToolContext } from '@/services/tools/types';

// Mock dependencies
vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));
vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));
vi.mock('@/services/table.service', () => ({
  listTables: vi.fn(),
}));

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { listTables as listTablesService } from '@/services/table.service';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('listTables service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns success with table list', async () => {
    vi.mocked(listTablesService).mockResolvedValue([
      {
        tableName: 'meals',
        description: 'Food log',
        columns: [{ name: 'food', type: 'text', nullable: true }],
        recordCount: 5,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
    ]);

    const result = await listTables({}, mockContext);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tables).toHaveLength(1);
      expect(result.data.tables[0].name).toBe('meals');
      expect(result.data.tables[0].description).toBe('Food log');
      expect(result.data.tables[0].columns).toEqual([{ name: 'food', type: 'text', nullable: true }]);
      expect(result.data.tables[0].recordCount).toBe(5);
      expect(result.data.tables[0].createdAt).toEqual(new Date('2026-01-01'));
      expect(result.data.tables[0].updatedAt).toEqual(new Date('2026-01-02'));
    }
    expect(requireConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'tables/*', 'read');
    expect(logAuditEntry).toHaveBeenCalledWith('user-123', {
      agentId: 'test-agent',
      action: 'mcp_list_tables',
      resource: 'tables/*',
      details: {},
    });
  });

  it('returns CONSENT_DENIED on missing consent', async () => {
    vi.mocked(requireConsent).mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'test-agent' does not have read access to tables/*"),
    );

    const result = await listTables({}, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
      expect(result.message).toBe(
        "CONSENT_DENIED: Agent 'test-agent' does not have read access to tables/*",
      );
      expect(result.retryable).toBe(false);
    }
  });

  it('returns INTERNAL_ERROR on table service failure', async () => {
    vi.mocked(listTablesService).mockRejectedValue(new Error('DB connection failed'));

    const result = await listTables({}, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
      expect(result.message).toBe('DB connection failed');
      expect(result.retryable).toBe(true);
    }
  });

  it('returns empty table list on success with no tables', async () => {
    vi.mocked(listTablesService).mockResolvedValue([]);

    const result = await listTables({}, mockContext);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tables).toHaveLength(0);
      expect(result.message).toBe('Found 0 table(s)');
    }
  });
});
