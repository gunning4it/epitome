import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateProfile } from '@/services/tools/updateProfile';
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
  createWriteId: vi.fn(() => 'write-123'),
  ingestProfileUpdate: vi.fn(),
  ingestMemoryText: vi.fn(),
}));
vi.mock('@/db/client', () => ({
  withUserSchema: vi.fn(),
}));
vi.mock('@/services/profile.service', () => ({
  getLatestProfile: vi.fn(),
  checkIdentityInvariants: vi.fn(() => []),
}));
vi.mock('@/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { ingestProfileUpdate, ingestMemoryText } from '@/services/writeIngestion.service';
import { withUserSchema } from '@/db/client';

const mockRequireConsent = vi.mocked(requireConsent);
const mockLogAuditEntry = vi.mocked(logAuditEntry);
const mockIngestProfileUpdate = vi.mocked(ingestProfileUpdate);
const mockIngestMemoryText = vi.mocked(ingestMemoryText);
const mockWithUserSchema = vi.mocked(withUserSchema);

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

const profileResult = {
  profile: {
    id: 1,
    version: 3,
    data: { name: 'Bruce Wayne', timezone: 'US/Pacific' },
    changedFields: ['name', 'timezone'],
    metaId: 42,
  },
  sourceRef: 'profile:v3',
  writeId: 'write-123',
  writeStatus: 'accepted' as const,
  jobId: 7,
};

describe('updateProfile service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireConsent.mockResolvedValue(undefined);
    mockLogAuditEntry.mockResolvedValue(undefined);
    mockIngestProfileUpdate.mockResolvedValue(profileResult);
    mockIngestMemoryText.mockResolvedValue({
      vectorId: 10,
      sourceRef: 'profile:10',
      writeId: 'write-123',
      writeStatus: 'accepted',
    });
    mockWithUserSchema.mockResolvedValue(undefined);
  });

  it('returns success with correct data shape', async () => {
    const result = await updateProfile(
      { data: { name: 'Bruce Wayne', timezone: 'US/Pacific' }, reason: 'User told me' },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      success: true,
      profile: profileResult.profile,
      sourceRef: 'profile:v3',
      writeId: 'write-123',
      writeStatus: 'accepted',
      jobId: 7,
      message: 'User told me',
    });
    expect(result.message).toBe('User told me');
  });

  it('uses default message when no reason provided', async () => {
    const result = await updateProfile(
      { data: { timezone: 'US/Eastern' } },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.message).toBe('Profile updated successfully');
    expect(result.message).toBe('Profile updated successfully');
  });

  it('checks consent for profile write', async () => {
    await updateProfile({ data: { name: 'Test' } }, makeCtx());

    expect(mockRequireConsent).toHaveBeenCalledWith('user-1', 'agent-1', 'profile', 'write');
  });

  it('returns CONSENT_DENIED on consent failure', async () => {
    mockRequireConsent.mockRejectedValue(
      new Error("CONSENT_DENIED: Agent 'agent-1' does not have write access to profile"),
    );

    const result = await updateProfile({ data: { name: 'Test' } }, makeCtx());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
    expect(result.message).toContain('CONSENT_DENIED');
  });

  it('logs audit entry', async () => {
    await updateProfile(
      { data: { name: 'Bruce' }, reason: 'name change' },
      makeCtx(),
    );

    expect(mockLogAuditEntry).toHaveBeenCalledWith('user-1', {
      agentId: 'agent-1',
      action: 'mcp_update_profile',
      resource: 'profile',
      details: {
        reason: 'name change',
        changedFields: ['name'],
      },
    });
  });

  it('fires ingestMemoryText as side effect', async () => {
    await updateProfile(
      { data: { name: 'Bruce Wayne' }, reason: 'told me' },
      makeCtx(),
    );

    expect(mockIngestMemoryText).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        collection: 'profile',
        text: 'Profile updated: name: Bruce Wayne',
        metadata: expect.objectContaining({
          source: 'update_profile',
          agent: 'agent-1',
        }),
      }),
    );
  });

  it('fires entity name update when profile has name', async () => {
    await updateProfile(
      { data: { name: 'Bruce Wayne' } },
      makeCtx(),
    );

    expect(mockWithUserSchema).toHaveBeenCalledWith('user-1', expect.any(Function));
  });

  it('does not fire entity name update when profile has no name', async () => {
    mockIngestProfileUpdate.mockResolvedValue({
      ...profileResult,
      profile: { ...profileResult.profile, data: { timezone: 'US/Pacific' } },
    });

    await updateProfile(
      { data: { timezone: 'US/Pacific' } },
      makeCtx(),
    );

    expect(mockWithUserSchema).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when ingestProfileUpdate throws', async () => {
    mockIngestProfileUpdate.mockRejectedValue(new Error('DB connection lost'));

    const result = await updateProfile({ data: { name: 'Test' } }, makeCtx());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe('DB connection lost');
    expect(result.retryable).toBe(true);
  });
});
