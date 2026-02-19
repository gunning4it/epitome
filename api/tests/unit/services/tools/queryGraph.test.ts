import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryGraph } from '@/services/tools/queryGraph';
import { ToolErrorCode } from '@/services/tools/types';
import type { ToolContext } from '@/services/tools/types';

vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));
vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));
vi.mock('@/mcp/serviceWrappers.js', () => ({
  traverseGraph: vi.fn(),
  patternQuery: vi.fn(),
}));

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { traverseGraph, patternQuery } from '@/mcp/serviceWrappers.js';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('queryGraph service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns success for traverse query', async () => {
    const mockResult = { entities: [{ id: 1, name: 'User' }], relations: [] };
    vi.mocked(traverseGraph).mockResolvedValue(mockResult);

    const result = await queryGraph(
      { queryType: 'traverse', entityId: 1, maxHops: 2 },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.queryType).toBe('traverse');
      expect(result.data.result).toEqual(mockResult);
    }
    expect(requireConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'graph', 'read');
    expect(traverseGraph).toHaveBeenCalledWith('user-123', 1, { relation: undefined, maxHops: 2 });
  });

  it('caps maxHops at 3', async () => {
    vi.mocked(traverseGraph).mockResolvedValue({});

    await queryGraph(
      { queryType: 'traverse', entityId: 1, maxHops: 10 },
      mockContext,
    );

    expect(traverseGraph).toHaveBeenCalledWith('user-123', 1, { relation: undefined, maxHops: 3 });
  });

  it('defaults maxHops to 2', async () => {
    vi.mocked(traverseGraph).mockResolvedValue({});

    await queryGraph(
      { queryType: 'traverse', entityId: 1 },
      mockContext,
    );

    expect(traverseGraph).toHaveBeenCalledWith('user-123', 1, { relation: undefined, maxHops: 2 });
  });

  it('passes relation filter for traverse', async () => {
    vi.mocked(traverseGraph).mockResolvedValue({});

    await queryGraph(
      { queryType: 'traverse', entityId: 1, relation: 'likes' },
      mockContext,
    );

    expect(traverseGraph).toHaveBeenCalledWith('user-123', 1, { relation: 'likes', maxHops: 2 });
  });

  it('returns success for string pattern query', async () => {
    const mockResult = [{ entity: 'User', relation: 'likes', target: 'Chocolate' }];
    vi.mocked(patternQuery).mockResolvedValue(mockResult);

    const result = await queryGraph(
      { queryType: 'pattern', pattern: 'User likes *' },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.queryType).toBe('pattern');
      expect(result.data.result).toEqual(mockResult);
    }
    expect(patternQuery).toHaveBeenCalledWith('user-123', 'User likes *');
  });

  it('returns success for structured pattern query', async () => {
    const pattern = { entityType: 'person', relation: 'likes' };
    vi.mocked(patternQuery).mockResolvedValue([]);

    const result = await queryGraph(
      { queryType: 'pattern', pattern },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(patternQuery).toHaveBeenCalledWith('user-123', pattern);
  });

  it('returns INVALID_ARGS when entityId missing for traverse', async () => {
    const result = await queryGraph(
      { queryType: 'traverse' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toBe('INVALID_ARGS: entityId is required for traverse queries');
    }
  });

  it('returns INVALID_ARGS when pattern missing for pattern query', async () => {
    const result = await queryGraph(
      { queryType: 'pattern' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toBe('INVALID_ARGS: pattern is required for pattern queries');
    }
  });

  it('returns INVALID_ARGS for invalid queryType', async () => {
    const result = await queryGraph(
      { queryType: 'invalid' as any },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toBe('INVALID_ARGS: Invalid queryType: invalid');
    }
  });

  it('returns CONSENT_DENIED on missing consent', async () => {
    vi.mocked(requireConsent).mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'test-agent' does not have read access to graph"),
    );

    const result = await queryGraph(
      { queryType: 'traverse', entityId: 1 },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
      expect(result.retryable).toBe(false);
    }
  });

  it('returns INTERNAL_ERROR on service failure', async () => {
    vi.mocked(traverseGraph).mockRejectedValue(new Error('graph query failed'));

    const result = await queryGraph(
      { queryType: 'traverse', entityId: 1 },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
      expect(result.message).toBe('graph query failed');
      expect(result.retryable).toBe(true);
    }
  });
});
