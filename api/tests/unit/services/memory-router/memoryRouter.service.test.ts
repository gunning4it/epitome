import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/services/tools/types';
import { openAiAdapter } from '@/services/memory-router/providers/openai';
import {
  MemoryRouterServiceError,
  ensureMemoryRouterEnabled,
  loadMemoryRouterSettings,
  parseMemoryRouterControlHeaders,
  prepareRoutedPayload,
  saveMemoryRouterSettings,
} from '@/services/memory-router/memoryRouter.service';

vi.mock('@/services/profile.service', () => ({
  getLatestProfile: vi.fn(),
}));
vi.mock('@/services/writeIngestion.service', () => ({
  ingestProfileUpdate: vi.fn(),
}));
vi.mock('@/services/tools/getUserContext', () => ({
  getUserContext: vi.fn(),
}));
vi.mock('@/services/tools/searchMemory', () => ({
  searchMemory: vi.fn(),
}));
vi.mock('@/services/tools/saveMemory', () => ({
  saveMemory: vi.fn(),
}));

import { getLatestProfile } from '@/services/profile.service';
import { ingestProfileUpdate } from '@/services/writeIngestion.service';
import { getUserContext } from '@/services/tools/getUserContext';
import { searchMemory } from '@/services/tools/searchMemory';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'agent-123',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('memoryRouter.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads default settings when profile has no memory_router flags', async () => {
    vi.mocked(getLatestProfile).mockResolvedValue({
      data: {},
      version: 1,
      updated_at: new Date().toISOString(),
    });

    const settings = await loadMemoryRouterSettings('user-123');

    expect(settings).toEqual({
      enabled: false,
      defaultCollection: 'memories',
    });
  });

  it('parses control headers with defaults', () => {
    const headers = new Headers();
    const controls = parseMemoryRouterControlHeaders(headers, {
      enabled: true,
      defaultCollection: 'journal',
    });

    expect(controls).toEqual({
      mode: 'auto',
      collection: 'journal',
      idempotencyKey: undefined,
    });
  });

  it('rejects invalid collection override header', () => {
    const headers = new Headers({
      'x-epitome-memory-collection': 'invalid collection with spaces',
    });

    expect(() => parseMemoryRouterControlHeaders(headers, {
      enabled: true,
      defaultCollection: 'memories',
    })).toThrowError(MemoryRouterServiceError);
  });

  it('throws FEATURE_DISABLED when router is off', () => {
    expect(() => ensureMemoryRouterEnabled({ enabled: false, defaultCollection: 'memories' }))
      .toThrowError(MemoryRouterServiceError);
  });

  it('prepareRoutedPayload bypasses retrieval when mode is off', async () => {
    const requestBody = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const result = await prepareRoutedPayload({
      adapter: openAiAdapter,
      requestBody,
      toolContext: mockContext,
      controlHeaders: {
        mode: 'off',
        collection: 'memories',
      },
    });

    expect(result.usedMemoryContext).toBe(false);
    expect(result.requestBody).toBe(requestBody);
    expect(vi.mocked(getUserContext)).not.toHaveBeenCalled();
    expect(vi.mocked(searchMemory)).not.toHaveBeenCalled();
  });

  it('prepareRoutedPayload injects context when retrieval succeeds', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        profile: { name: 'Bruce Wayne' },
        tables: [],
        collections: [],
        topEntities: [],
        recentMemories: [],
        hints: {
          hasStructuredData: false,
          hasMemories: true,
          hasGraphData: false,
          suggestedTools: [],
        },
      },
    });
    vi.mocked(searchMemory).mockResolvedValue({
      success: true,
      message: 'ok',
      data: {
        collection: 'memories',
        query: 'What do you know about me?',
        resultCount: 1,
        results: [
          {
            text: 'User likes black coffee.',
            similarity: 0.9,
            metadata: {},
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    const result = await prepareRoutedPayload({
      adapter: openAiAdapter,
      requestBody: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'What do you know about me?' }],
      },
      toolContext: mockContext,
      controlHeaders: {
        mode: 'auto',
        collection: 'memories',
      },
    });

    expect(result.usedMemoryContext).toBe(true);
    const messages = result.requestBody.messages as Array<Record<string, unknown>>;
    expect(messages[0].role).toBe('system');
    expect(String(messages[0].content)).toContain('Epitome Memory Context');
    expect(vi.mocked(getUserContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchMemory)).toHaveBeenCalledTimes(1);
  });

  it('prepareRoutedPayload throws on consent denied from retrieval', async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      success: false,
      code: 'CONSENT_DENIED',
      message: 'CONSENT_DENIED',
      retryable: false,
    });

    await expect(
      prepareRoutedPayload({
        adapter: openAiAdapter,
        requestBody: {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hello' }],
        },
        toolContext: mockContext,
        controlHeaders: {
          mode: 'auto',
          collection: 'memories',
        },
      }),
    ).rejects.toThrowError(MemoryRouterServiceError);
  });

  it('saveMemoryRouterSettings writes profile feature flags', async () => {
    vi.mocked(getLatestProfile).mockResolvedValue({
      data: {},
      version: 1,
      updated_at: new Date().toISOString(),
    });
    vi.mocked(ingestProfileUpdate).mockResolvedValue({
      profile: {
        id: 1,
        data: {},
        version: 2,
        changedBy: 'user',
        changedFields: ['feature_flags'],
        changedAt: new Date(),
      },
      sourceRef: 'profile:v2',
      writeId: 'w1',
      jobId: 1,
      writeStatus: 'accepted',
    } as any);

    const result = await saveMemoryRouterSettings('user-123', 'user', { enabled: true });

    expect(result.enabled).toBe(true);
    expect(result.defaultCollection).toBe('memories');
    expect(vi.mocked(ingestProfileUpdate)).toHaveBeenCalledTimes(1);
  });
});
