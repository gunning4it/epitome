import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/services/tools/types';
import { openAiAdapter } from '@/services/memory-router/providers/openai';
import { persistRoutedConversation } from '@/services/memory-router/memoryRouter.service';

vi.mock('@/services/tools/saveMemory', () => ({
  saveMemory: vi.fn(),
}));
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

import { saveMemory } from '@/services/tools/saveMemory';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'agent-123',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('persistRoutedConversation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does nothing when memory mode is off', async () => {
    await persistRoutedConversation({
      provider: 'openai',
      adapter: openAiAdapter,
      requestBody: { model: 'gpt-4o-mini' },
      responseBody: {},
      userQuery: 'hello',
      toolContext: mockContext,
      controlHeaders: {
        mode: 'off',
        collection: 'memories',
      },
    });

    expect(vi.mocked(saveMemory)).not.toHaveBeenCalled();
  });

  it('calls saveMemory for successful routed response', async () => {
    vi.mocked(saveMemory).mockResolvedValue({
      success: true,
      message: 'ok',
      data: {},
    });

    await persistRoutedConversation({
      provider: 'openai',
      adapter: openAiAdapter,
      requestBody: { model: 'gpt-4o-mini' },
      responseBody: {
        choices: [{ message: { role: 'assistant', content: 'Stored answer' } }],
      },
      userQuery: 'Question',
      toolContext: mockContext,
      controlHeaders: {
        mode: 'auto',
        collection: 'memories',
        idempotencyKey: 'idem-1',
      },
    });

    expect(vi.mocked(saveMemory)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveMemory)).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'memories',
        idempotencyKey: 'idem-1',
      }),
      mockContext,
    );
  });

  it('does not throw when saveMemory returns failure', async () => {
    vi.mocked(saveMemory).mockResolvedValue({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'failed',
      retryable: true,
    });

    await expect(
      persistRoutedConversation({
        provider: 'openai',
        adapter: openAiAdapter,
        requestBody: { model: 'gpt-4o-mini' },
        responseBody: {
          choices: [{ message: { role: 'assistant', content: 'answer' } }],
        },
        userQuery: 'Question',
        toolContext: mockContext,
        controlHeaders: {
          mode: 'auto',
          collection: 'memories',
        },
      }),
    ).resolves.toBeUndefined();
  });
});
