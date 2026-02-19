import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reviewMemories } from '@/services/tools/reviewMemories';
import { ToolErrorCode } from '@/services/tools/types';
import type { ToolContext } from '@/services/tools/types';

vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));
vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));
vi.mock('@/mcp/serviceWrappers.js', () => ({
  getContradictions: vi.fn(),
  resolveContradiction: vi.fn(),
}));

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { getContradictions, resolveContradiction } from '@/mcp/serviceWrappers.js';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('reviewMemories service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns success with contradiction list', async () => {
    const mockContradictions = [
      { metaId: 1, text: 'likes coffee', conflictingText: 'hates coffee' },
      { metaId: 2, text: 'is vegan', conflictingText: 'eats meat' },
    ];
    vi.mocked(getContradictions).mockResolvedValue(mockContradictions);

    const result = await reviewMemories({ action: 'list' }, mockContext);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        contradictionCount: 2,
        contradictions: mockContradictions,
      });
    }
    expect(requireConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'memory', 'read');
    expect(getContradictions).toHaveBeenCalledWith('user-123', { limit: 5 });
  });

  it('returns success when resolving contradiction', async () => {
    vi.mocked(resolveContradiction).mockResolvedValue(undefined);

    const result = await reviewMemories(
      { action: 'resolve', metaId: 42, resolution: 'confirm' },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        success: true,
        metaId: 42,
        resolution: 'confirm',
        message: 'Contradiction resolved successfully',
      });
    }
    // read consent first
    expect(requireConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'memory', 'read');
    // then write consent
    expect(requireConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'memory', 'write');
    expect(resolveContradiction).toHaveBeenCalledWith('user-123', 42, 'confirm', {
      resolvedBy: 'test-agent',
    });
  });

  it('returns INVALID_ARGS when metaId missing for resolve', async () => {
    const result = await reviewMemories(
      { action: 'resolve', resolution: 'confirm' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toBe('INVALID_ARGS: metaId and resolution are required for resolve action');
    }
  });

  it('returns INVALID_ARGS when resolution missing for resolve', async () => {
    const result = await reviewMemories(
      { action: 'resolve', metaId: 42 },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toBe('INVALID_ARGS: metaId and resolution are required for resolve action');
    }
  });

  it('returns INVALID_ARGS for invalid action', async () => {
    const result = await reviewMemories(
      { action: 'invalid' as any },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toBe('INVALID_ARGS: Invalid action: invalid');
    }
  });

  it('returns CONSENT_DENIED on missing read consent', async () => {
    vi.mocked(requireConsent).mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'test-agent' does not have read access to memory"),
    );

    const result = await reviewMemories({ action: 'list' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
      expect(result.retryable).toBe(false);
    }
  });

  it('returns CONSENT_DENIED on missing write consent for resolve', async () => {
    // Read consent passes
    vi.mocked(requireConsent)
      .mockResolvedValueOnce(undefined)
      // Write consent fails
      .mockRejectedValueOnce(
        new Error("CONSENT_DENIED: Agent 'test-agent' does not have write access to memory"),
      );

    const result = await reviewMemories(
      { action: 'resolve', metaId: 42, resolution: 'reject' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
      expect(result.message).toBe(
        "CONSENT_DENIED: Agent 'test-agent' does not have write access to memory",
      );
    }
  });

  it('returns INTERNAL_ERROR on service failure', async () => {
    vi.mocked(getContradictions).mockRejectedValue(new Error('database error'));

    const result = await reviewMemories({ action: 'list' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
      expect(result.message).toBe('database error');
      expect(result.retryable).toBe(true);
    }
  });
});
