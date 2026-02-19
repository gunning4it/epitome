import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchMemory } from '@/services/tools/searchMemory';
import { ToolErrorCode } from '@/services/tools/types';
import type { ToolContext } from '@/services/tools/types';

vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));
vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));
vi.mock('@/services/vector.service', () => ({
  searchVectors: vi.fn(),
}));

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { searchVectors } from '@/services/vector.service';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('searchMemory service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns success with search results', async () => {
    vi.mocked(searchVectors).mockResolvedValue([
      {
        text: 'I love dark chocolate',
        similarity: 0.92,
        metadata: { source: 'chat' },
        createdAt: new Date('2026-01-15'),
      },
    ] as any);

    const result = await searchMemory(
      { collection: 'general', query: 'chocolate preferences' },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.collection).toBe('general');
      expect(result.data.query).toBe('chocolate preferences');
      expect(result.data.resultCount).toBe(1);
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0].text).toBe('I love dark chocolate');
      expect(result.data.results[0].similarity).toBe(0.92);
    }
    expect(requireConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'vectors/general', 'read');
    expect(logAuditEntry).toHaveBeenCalledWith('user-123', expect.objectContaining({
      agentId: 'test-agent',
      action: 'mcp_search_memory',
      resource: 'vectors/general',
    }));
  });

  it('passes limit and minSimilarity to searchVectors', async () => {
    vi.mocked(searchVectors).mockResolvedValue([] as any);

    await searchMemory(
      { collection: 'notes', query: 'test', limit: 5, minSimilarity: 0.8 },
      mockContext,
    );

    expect(searchVectors).toHaveBeenCalledWith('user-123', 'notes', 'test', 5, 0.8);
  });

  it('uses default limit and minSimilarity', async () => {
    vi.mocked(searchVectors).mockResolvedValue([] as any);

    await searchMemory(
      { collection: 'general', query: 'test' },
      mockContext,
    );

    expect(searchVectors).toHaveBeenCalledWith('user-123', 'general', 'test', 10, 0.7);
  });

  it('returns CONSENT_DENIED on missing consent', async () => {
    vi.mocked(requireConsent).mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'test-agent' does not have read access to vectors/general"),
    );

    const result = await searchMemory(
      { collection: 'general', query: 'test' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
      expect(result.message).toBe(
        "CONSENT_DENIED: Agent 'test-agent' does not have read access to vectors/general",
      );
      expect(result.retryable).toBe(false);
    }
  });

  it('returns INTERNAL_ERROR on service failure', async () => {
    vi.mocked(searchVectors).mockRejectedValue(new Error('embedding service unavailable'));

    const result = await searchMemory(
      { collection: 'general', query: 'test' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
      expect(result.message).toBe('embedding service unavailable');
      expect(result.retryable).toBe(true);
    }
  });
});
