import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memorize } from '@/services/tools/memorize';
import { ToolErrorCode } from '@/services/tools/types';
import type { ToolContext } from '@/services/tools/types';

// Mock dependencies
vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
  requireDomainConsent: vi.fn(),
}));
vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));
vi.mock('@/services/vector.service', () => ({
  searchAllVectors: vi.fn(),
  deleteVector: vi.fn(),
}));
vi.mock('@/services/table.service', () => ({
  deleteRecord: vi.fn(),
}));
vi.mock('@/mcp/serviceWrappers.js', () => ({
  getContradictions: vi.fn(),
}));
vi.mock('@/services/tools/updateProfile', () => ({
  updateProfile: vi.fn(),
}));
vi.mock('@/services/tools/addRecord', () => ({
  addRecord: vi.fn(),
}));
vi.mock('@/services/tools/saveMemory', () => ({
  saveMemory: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { requireDomainConsent } from '@/services/consent.service';
import { searchAllVectors, deleteVector } from '@/services/vector.service';
import { getContradictions } from '@/mcp/serviceWrappers.js';
import { updateProfile } from '@/services/tools/updateProfile';
import { addRecord } from '@/services/tools/addRecord';
import { saveMemory } from '@/services/tools/saveMemory';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('memorize facade service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getContradictions).mockResolvedValue([]);
  });

  // ── Validation ─────────────────────────────────────────────────────

  it('returns INVALID_ARGS when text is missing', async () => {
    const result = await memorize({ text: '' }, mockContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.INVALID_ARGS);
      expect(result.message).toMatch(/text/i);
    }
  });

  // ── Default save path (addRecord) ─────────────────────────────────

  it('calls addRecord with correct table and data when saving with structured data', async () => {
    const mockResult = {
      success: true as const,
      data: { success: true, table: 'books', recordId: 1 },
      message: 'Record added successfully',
    };
    vi.mocked(addRecord).mockResolvedValue(mockResult);

    const result = await memorize(
      {
        text: 'I just finished reading Dune',
        category: 'books',
        data: { title: 'Dune', author: 'Frank Herbert', rating: 5 },
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(addRecord).toHaveBeenCalledWith(
      { table: 'books', data: { title: 'Dune', author: 'Frank Herbert', rating: 5 } },
      mockContext,
    );
  });

  it('calls addRecord with text-only data in default "memories" category', async () => {
    const mockResult = {
      success: true as const,
      data: { success: true, table: 'memories', recordId: 1 },
      message: 'Record added successfully',
    };
    vi.mocked(addRecord).mockResolvedValue(mockResult);

    const result = await memorize(
      { text: 'Had a great day at the park' },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(addRecord).toHaveBeenCalledWith(
      { table: 'memories', data: { text: 'Had a great day at the park' } },
      mockContext,
    );
  });

  // ── Profile path ───────────────────────────────────────────────────

  it('calls updateProfile when category is "profile"', async () => {
    const mockResult = {
      success: true as const,
      data: { success: true, profile: { name: 'Alice' } },
      message: 'Profile updated successfully',
    };
    vi.mocked(updateProfile).mockResolvedValue(mockResult);

    const result = await memorize(
      {
        text: 'My name is Alice',
        category: 'profile',
        data: { name: 'Alice' },
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(updateProfile).toHaveBeenCalledWith(
      { data: { name: 'Alice' }, reason: 'My name is Alice' },
      mockContext,
    );
    expect(addRecord).not.toHaveBeenCalled();
  });

  it('uses text as fallback profile data when no data field provided', async () => {
    const mockResult = {
      success: true as const,
      data: { success: true },
      message: 'Profile updated',
    };
    vi.mocked(updateProfile).mockResolvedValue(mockResult);

    await memorize(
      { text: 'I prefer vegetarian food', category: 'profile' },
      mockContext,
    );

    expect(updateProfile).toHaveBeenCalledWith(
      { data: { text: 'I prefer vegetarian food' }, reason: 'I prefer vegetarian food' },
      mockContext,
    );
  });

  // ── Delete path ────────────────────────────────────────────────────

  it('searches and soft-deletes matching vectors on delete action', async () => {
    vi.mocked(searchAllVectors).mockResolvedValue([
      { id: 10, collection: 'memories', text: 'I love coffee', similarity: 0.95, metadata: {}, confidence: 0.8, status: 'active', createdAt: new Date() },
      { id: 11, collection: 'memories', text: 'Coffee is great', similarity: 0.85, metadata: {}, confidence: 0.8, status: 'active', createdAt: new Date() },
    ] as any);
    vi.mocked(deleteVector).mockResolvedValue(undefined);

    const result = await memorize(
      { text: 'I love coffee', action: 'delete' },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        deleted: 2,
        sourceRefs: ['vectors/memories#10', 'vectors/memories#11'],
      });
    }
    expect(searchAllVectors).toHaveBeenCalledWith('user-123', 'I love coffee', 5, 0.8);
    expect(deleteVector).toHaveBeenCalledTimes(2);
  });

  it('returns CONSENT_DENIED when delete lacks vector write consent', async () => {
    vi.mocked(requireDomainConsent).mockRejectedValue(
      new Error('CONSENT_DENIED: no write access to vectors'),
    );

    const result = await memorize(
      { text: 'delete this', action: 'delete' },
      mockContext,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
    }
  });

  // ── Contradiction warning ──────────────────────────────────────────

  it('attaches conflict warning when contradictions are detected after save', async () => {
    const mockResult = {
      success: true as const,
      data: { success: true, table: 'memories', recordId: 1 },
      message: 'Record added successfully',
      meta: undefined as any,
    };
    vi.mocked(addRecord).mockResolvedValue(mockResult);
    vi.mocked(getContradictions).mockResolvedValue([
      { metaId: 1, text: 'contradicting fact' },
    ] as any);

    const result = await memorize(
      { text: 'I hate coffee' },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.meta?.warnings).toContain(
        'Contradiction detected. Run review(action: "list") to resolve.',
      );
    }
  });

  it('does not fail save when contradiction check errors', async () => {
    const mockResult = {
      success: true as const,
      data: { success: true, table: 'meals', recordId: 1 },
      message: 'Record added successfully',
    };
    vi.mocked(addRecord).mockResolvedValue(mockResult);
    vi.mocked(getContradictions).mockRejectedValue(new Error('db error'));

    const result = await memorize(
      { text: 'Had pizza for dinner', category: 'meals' },
      mockContext,
    );

    expect(result.success).toBe(true);
  });

  // ── Vector-only memory path (storage:'memory') ──────────────────────

  it('delegates to saveMemory when storage is "memory"', async () => {
    // Need to mock saveMemory
    const { saveMemory } = await import('@/services/tools/saveMemory');
    const mockResult = {
      success: true as const,
      data: { vectorId: 42, collection: 'journal' },
      message: 'Memory saved successfully',
    };
    vi.mocked(saveMemory).mockResolvedValue(mockResult);

    const result = await memorize(
      {
        text: 'Had a wonderful sunset walk today',
        storage: 'memory',
        collection: 'journal',
        metadata: { mood: 'happy' },
      },
      mockContext,
    );

    expect(result).toBe(mockResult);
    expect(saveMemory).toHaveBeenCalledWith(
      { collection: 'journal', text: 'Had a wonderful sunset walk today', metadata: { mood: 'happy' } },
      mockContext,
    );
    expect(addRecord).not.toHaveBeenCalled();
  });

  it('defaults collection to category when storage is "memory"', async () => {
    const { saveMemory } = await import('@/services/tools/saveMemory');
    const mockResult = {
      success: true as const,
      data: { vectorId: 43 },
      message: 'Memory saved',
    };
    vi.mocked(saveMemory).mockResolvedValue(mockResult);

    await memorize(
      {
        text: 'Quick note about groceries',
        storage: 'memory',
        category: 'notes',
      },
      mockContext,
    );

    expect(saveMemory).toHaveBeenCalledWith(
      { collection: 'notes', text: 'Quick note about groceries', metadata: undefined },
      mockContext,
    );
  });

  it('defaults metadata to data when storage is "memory"', async () => {
    const { saveMemory } = await import('@/services/tools/saveMemory');
    const mockResult = {
      success: true as const,
      data: { vectorId: 44 },
      message: 'ok',
    };
    vi.mocked(saveMemory).mockResolvedValue(mockResult);

    await memorize(
      {
        text: 'I tried a new recipe',
        storage: 'memory',
        data: { topic: 'cooking', rating: 4 },
      },
      mockContext,
    );

    expect(saveMemory).toHaveBeenCalledWith(
      { collection: 'memories', text: 'I tried a new recipe', metadata: { topic: 'cooking', rating: 4 } },
      mockContext,
    );
  });

  it('still deletes when storage is "memory" but action is "delete"', async () => {
    vi.mocked(searchAllVectors).mockResolvedValue([
      { id: 20, collection: 'journal', text: 'old memory', similarity: 0.9, metadata: {}, confidence: 0.8, status: 'active', createdAt: new Date() },
    ] as any);
    vi.mocked(deleteVector).mockResolvedValue(undefined);

    const result = await memorize(
      { text: 'old memory', action: 'delete', storage: 'memory' },
      mockContext,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        deleted: 1,
        sourceRefs: ['vectors/journal#20'],
      });
    }
  });
});
