import { describe, it, expect, vi, beforeEach } from 'vitest';
import { review } from '@/services/tools/review';
import type { ToolContext } from '@/services/tools/types';

// Mock reviewMemories
vi.mock('@/services/tools/reviewMemories', () => ({
  reviewMemories: vi.fn(),
}));

import { reviewMemories } from '@/services/tools/reviewMemories';

const mockContext: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'pro',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

describe('review facade service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('delegates list action to reviewMemories', async () => {
    const mockResult = {
      success: true as const,
      data: { contradictionCount: 2, contradictions: [{}, {}] },
      message: 'Found 2 contradiction(s)',
    };
    vi.mocked(reviewMemories).mockResolvedValue(mockResult);

    const result = await review({ action: 'list' }, mockContext);

    expect(result).toBe(mockResult);
    expect(reviewMemories).toHaveBeenCalledWith({ action: 'list' }, mockContext);
  });

  it('delegates resolve action to reviewMemories', async () => {
    const mockResult = {
      success: true as const,
      data: { success: true, metaId: 42, resolution: 'confirm', message: 'Contradiction resolved successfully' },
      message: 'Contradiction resolved successfully',
    };
    vi.mocked(reviewMemories).mockResolvedValue(mockResult);

    const result = await review(
      { action: 'resolve', metaId: 42, resolution: 'confirm' },
      mockContext,
    );

    expect(result).toBe(mockResult);
    expect(reviewMemories).toHaveBeenCalledWith(
      { action: 'resolve', metaId: 42, resolution: 'confirm' },
      mockContext,
    );
  });

  it('passes through failure results from reviewMemories', async () => {
    const failureResult = {
      success: false as const,
      code: 'CONSENT_DENIED' as const,
      message: 'CONSENT_DENIED: no access',
      retryable: false,
    };
    vi.mocked(reviewMemories).mockResolvedValue(failureResult as any);

    const result = await review({ action: 'list' }, mockContext);

    expect(result.success).toBe(false);
  });
});
