import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveMemory } from '@/services/tools/saveMemory';
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
  createWriteId: vi.fn(() => 'write-789'),
  ingestMemoryText: vi.fn(),
}));
vi.mock('@/services/threadLinking', () => ({
  linkRelatedRecords: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { ingestMemoryText } from '@/services/writeIngestion.service';
import { linkRelatedRecords } from '@/services/threadLinking';

const mockRequireConsent = vi.mocked(requireConsent);
const mockLogAuditEntry = vi.mocked(logAuditEntry);
const mockIngestMemoryText = vi.mocked(ingestMemoryText);
const mockLinkRelatedRecords = vi.mocked(linkRelatedRecords);

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

const memoryResult = {
  vectorId: 55,
  sourceRef: 'notes:55',
  writeId: 'write-789',
  writeStatus: 'accepted' as const,
  jobId: 12,
};

describe('saveMemory service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireConsent.mockResolvedValue(undefined);
    mockLogAuditEntry.mockResolvedValue(undefined);
    mockIngestMemoryText.mockResolvedValue(memoryResult);
    mockLinkRelatedRecords.mockResolvedValue(undefined as any);
  });

  it('returns success with correct data shape', async () => {
    const result = await saveMemory(
      { collection: 'notes', text: 'Remember this important fact', metadata: { topic: 'facts' } },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      success: true,
      collection: 'notes',
      vectorId: 55,
      pendingVectorId: undefined,
      sourceRef: 'notes:55',
      writeId: 'write-789',
      writeStatus: 'accepted',
      jobId: 12,
      message: 'Memory saved successfully',
    });
  });

  it('checks consent for vectors/<collection> write', async () => {
    await saveMemory(
      { collection: 'notes', text: 'test' },
      makeCtx(),
    );

    expect(mockRequireConsent).toHaveBeenCalledWith('user-1', 'agent-1', 'vectors/notes', 'write');
  });

  it('returns CONSENT_DENIED on consent failure', async () => {
    mockRequireConsent.mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'agent-1' does not have write access to vectors/notes"),
    );

    const result = await saveMemory(
      { collection: 'notes', text: 'test' },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
  });

  it('logs audit entry', async () => {
    await saveMemory(
      { collection: 'notes', text: 'Hello world', metadata: { foo: 'bar' } },
      makeCtx(),
    );

    expect(mockLogAuditEntry).toHaveBeenCalledWith('user-1', {
      agentId: 'agent-1',
      action: 'mcp_save_memory',
      resource: 'vectors/notes',
      details: {
        textLength: 11,
        metadata: { foo: 'bar' },
      },
    });
  });

  it('passes tier to ingestMemoryText', async () => {
    await saveMemory(
      { collection: 'notes', text: 'test' },
      makeCtx({ tier: 'pro' }),
    );

    expect(mockIngestMemoryText).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'pro' }),
    );
  });

  it('defaults metadata to empty object', async () => {
    await saveMemory(
      { collection: 'notes', text: 'test' },
      makeCtx(),
    );

    expect(mockIngestMemoryText).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
    );
  });

  it('fires linkRelatedRecords when vectorId is present', async () => {
    await saveMemory(
      { collection: 'notes', text: 'test' },
      makeCtx(),
    );

    expect(mockLinkRelatedRecords).toHaveBeenCalledWith('user-1', 55, 'vectors');
  });

  it('does not fire linkRelatedRecords when vectorId is absent (pending)', async () => {
    mockIngestMemoryText.mockResolvedValue({
      pendingVectorId: 99,
      sourceRef: 'notes:pending:99',
      writeId: 'write-789',
      writeStatus: 'pending_enrichment',
    });

    const result = await saveMemory(
      { collection: 'notes', text: 'test' },
      makeCtx(),
    );

    expect(mockLinkRelatedRecords).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pendingVectorId).toBe(99);
    expect(result.data.vectorId).toBeUndefined();
  });

  it('returns INTERNAL_ERROR when ingestMemoryText throws', async () => {
    mockIngestMemoryText.mockRejectedValue(new Error('DB connection lost'));

    const result = await saveMemory(
      { collection: 'notes', text: 'test' },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe('DB connection lost');
    expect(result.retryable).toBe(true);
  });
});
