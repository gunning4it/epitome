// api/tests/unit/services/tools/retrieveUserKnowledge.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/services/tools/types';

// --- Mocks ---

vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
  checkConsent: vi.fn(),
  checkDomainConsent: vi.fn(),
}));

vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));

vi.mock('@/services/table.service', () => ({
  listTables: vi.fn(),
}));

vi.mock('@/services/vector.service', () => ({
  listCollections: vi.fn(),
}));

vi.mock('@/services/profile.service', () => ({
  getLatestProfile: vi.fn(),
}));

vi.mock('@/services/retrieval.service', () => ({
  retrieveKnowledge: vi.fn(),
}));

import { retrieveUserKnowledge } from '@/services/tools/retrieveUserKnowledge';
import { requireConsent, checkConsent, checkDomainConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { listTables } from '@/services/table.service';
import { listCollections } from '@/services/vector.service';
import { getLatestProfile } from '@/services/profile.service';
import { retrieveKnowledge } from '@/services/retrieval.service';
import { ToolErrorCode } from '@/services/tools/types';

// --- Fixtures ---

const baseCtx: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'free',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

const mockTables = [
  {
    tableName: 'meals',
    description: 'Daily meals',
    recordCount: 42,
    columns: [{ name: 'food', type: 'text' }, { name: 'calories', type: 'integer' }],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockCollections = [
  {
    collection: 'journal',
    description: 'Journal entries',
    entryCount: 100,
    embeddingDim: 1536,
    createdAt: new Date(),
  },
];

const mockProfile = {
  data: { name: 'Alice', timezone: 'America/Los_Angeles' },
  version: 3,
  updated_at: '2026-02-19T00:00:00Z',
};

const mockRetrievalResult = {
  topic: 'sushi',
  intent: { primary: 'general', expandedTerms: [], entityTypeHints: [], relationHints: [] },
  budget: 'medium' as const,
  facts: [{ fact: 'User likes sushi', sourceType: 'vector', sourceRef: 'vectors/general#1', confidence: 0.85 }],
  sourcesQueried: ['vector', 'graph'],
  coverage: 0.5,
  coverageDetails: {
    score: 0.5,
    plannedSources: ['vector', 'graph'],
    queriedSources: ['vector', 'graph'],
    missingSources: [],
  },
  warnings: [] as string[],
  timingMs: 150,
};

// --- Helpers ---

function consentAllowed() {
  (requireConsent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (checkConsent as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (checkDomainConsent as ReturnType<typeof vi.fn>).mockResolvedValue(true);
}

function consentDeniedProfile() {
  (requireConsent as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error('CONSENT_DENIED: Agent does not have read access to profile'),
  );
}

function setupFullMocks() {
  (logAuditEntry as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (listTables as ReturnType<typeof vi.fn>).mockResolvedValue(mockTables);
  (listCollections as ReturnType<typeof vi.fn>).mockResolvedValue(mockCollections);
  (getLatestProfile as ReturnType<typeof vi.fn>).mockResolvedValue(mockProfile);
  // Return a fresh copy so mutations (push) in the implementation don't leak between tests
  (retrieveKnowledge as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...mockRetrievalResult,
    warnings: [],
  });
}

// --- Tests ---

describe('retrieveUserKnowledge service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Happy path
  it('returns facts on success with full consent', async () => {
    consentAllowed();
    setupFullMocks();

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.facts).toHaveLength(1);
    expect(result.data.facts[0].fact).toBe('User likes sushi');
    expect(result.data.facts[0].confidence).toBe(0.85);
    expect(result.data.sourcesQueried).toEqual(['vector', 'graph']);
    expect(result.data.coverage).toBe(0.5);
    expect(result.data.timingMs).toBe(150);
    expect(result.message).toBe('Retrieved 1 facts about "sushi"');
  });

  // 2. CONSENT_DENIED on profile
  it('returns toolFailure with CONSENT_DENIED when profile consent is denied', async () => {
    consentDeniedProfile();
    setupFullMocks();

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe(ToolErrorCode.CONSENT_DENIED);
    expect(result.message).toContain('CONSENT_DENIED');
    expect(result.retryable).toBe(false);
  });

  // 3. Default budget
  it('defaults budget to medium when not specified', async () => {
    consentAllowed();
    setupFullMocks();

    await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(retrieveKnowledge).toHaveBeenCalledWith(
      'user-123',
      'sushi',
      'medium',
      expect.any(Function),
      expect.any(Array),
      expect.any(Array),
      expect.any(Object),
    );
  });

  // 4. Custom budget
  it('passes custom budget through to retrieveKnowledge', async () => {
    consentAllowed();
    setupFullMocks();

    await retrieveUserKnowledge({ topic: 'sushi', budget: 'deep' }, baseCtx);

    expect(retrieveKnowledge).toHaveBeenCalledWith(
      'user-123',
      'sushi',
      'deep',
      expect.any(Function),
      expect.any(Array),
      expect.any(Array),
      expect.any(Object),
    );
  });

  // 5. Audit logged
  it('logs audit entry with correct action, resource, and details', async () => {
    consentAllowed();
    setupFullMocks();

    await retrieveUserKnowledge({ topic: 'sushi', budget: 'small' }, baseCtx);

    expect(logAuditEntry).toHaveBeenCalledWith('user-123', {
      agentId: 'test-agent',
      action: 'mcp_recall',
      resource: 'profile',
      details: { topic: 'sushi', budget: 'small' },
    });
  });

  it('does not log audit when consent is denied', async () => {
    consentDeniedProfile();
    setupFullMocks();

    await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(logAuditEntry).not.toHaveBeenCalled();
  });

  // 6. Table metadata failure
  it('adds warning when table metadata fails to load', async () => {
    consentAllowed();
    setupFullMocks();
    (listTables as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.warnings).toContain('Could not load table metadata');

    // Should still pass empty array for tables metadata to retrieveKnowledge
    expect(retrieveKnowledge).toHaveBeenCalledWith(
      'user-123',
      'sushi',
      'medium',
      expect.any(Function),
      [], // empty tables metadata
      expect.any(Array),
      expect.any(Object),
    );
  });

  // 7. Collection metadata failure
  it('adds warning when collection metadata fails to load', async () => {
    consentAllowed();
    setupFullMocks();
    (listCollections as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.warnings).toContain('Could not load collection metadata');

    // Should still pass empty array for collections metadata
    expect(retrieveKnowledge).toHaveBeenCalledWith(
      'user-123',
      'sushi',
      'medium',
      expect.any(Function),
      expect.any(Array),
      [], // empty collections metadata
      expect.any(Object),
    );
  });

  // 8. Profile load failure
  it('adds warning when profile fails to load and passes null profile', async () => {
    consentAllowed();
    setupFullMocks();
    (getLatestProfile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.warnings).toContain('Could not load profile');

    // Should pass null profile to retrieveKnowledge
    expect(retrieveKnowledge).toHaveBeenCalledWith(
      'user-123',
      'sushi',
      'medium',
      expect.any(Function),
      expect.any(Array),
      expect.any(Array),
      null,
    );
  });

  // 9. retrieveKnowledge throws
  it('returns toolFailure with INTERNAL_ERROR when retrieveKnowledge throws', async () => {
    consentAllowed();
    setupFullMocks();
    (retrieveKnowledge as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('LLM timeout'),
    );

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
    expect(result.message).toContain('LLM timeout');
    expect(result.retryable).toBe(true);
  });

  // 10. Empty topic
  it('passes through empty topic without validation (classifyIntent handles it)', async () => {
    consentAllowed();
    setupFullMocks();

    const result = await retrieveUserKnowledge({ topic: '' }, baseCtx);

    expect(result.success).toBe(true);
    expect(retrieveKnowledge).toHaveBeenCalledWith(
      'user-123',
      '',
      'medium',
      expect.any(Function),
      expect.any(Array),
      expect.any(Array),
      expect.any(Object),
    );
  });

  // Additional edge cases

  it('maps table metadata correctly with columns', async () => {
    consentAllowed();
    setupFullMocks();

    await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    const call = (retrieveKnowledge as ReturnType<typeof vi.fn>).mock.calls[0];
    const tablesMeta = call[4]; // 5th argument
    expect(tablesMeta).toEqual([
      {
        tableName: 'meals',
        description: 'Daily meals',
        columns: [{ name: 'food', type: 'text' }, { name: 'calories', type: 'integer' }],
        recordCount: 42,
      },
    ]);
  });

  it('maps collection metadata correctly', async () => {
    consentAllowed();
    setupFullMocks();

    await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    const call = (retrieveKnowledge as ReturnType<typeof vi.fn>).mock.calls[0];
    const collectionsMeta = call[5]; // 6th argument
    expect(collectionsMeta).toEqual([
      { collection: 'journal', description: 'Journal entries', entryCount: 100 },
    ]);
  });

  it('does not include warnings in meta when there are none', async () => {
    consentAllowed();
    setupFullMocks();

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // No warnings from metadata loading, no warnings from retrieveKnowledge
    expect(result.meta?.warnings).toBeUndefined();
  });

  it('includes warnings in meta when warnings exist', async () => {
    consentAllowed();
    setupFullMocks();
    (retrieveKnowledge as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockRetrievalResult,
      warnings: ['Some retrieval warning'],
    });

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.meta?.warnings).toEqual(['Some retrieval warning']);
  });

  it('merges metadata warnings with retrieval warnings', async () => {
    consentAllowed();
    setupFullMocks();
    (listTables as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
    (retrieveKnowledge as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockRetrievalResult,
      warnings: ['Partial coverage'],
    });

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.warnings).toContain('Partial coverage');
    expect(result.data.warnings).toContain('Could not load table metadata');
    expect(result.meta?.warnings).toEqual(
      expect.arrayContaining(['Partial coverage', 'Could not load table metadata']),
    );
  });

  it('passes a consent checker function that handles domain scopes consistently', async () => {
    consentAllowed();
    setupFullMocks();

    await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    // Extract the consentChecker function passed to retrieveKnowledge
    const call = (retrieveKnowledge as ReturnType<typeof vi.fn>).mock.calls[0];
    const consentChecker = call[3]; // 4th argument

    // Domain scopes should delegate to checkDomainConsent
    await consentChecker('vectors', 'read');
    expect(checkDomainConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'vectors', 'read');

    // Non-domain scopes should still use checkConsent
    await consentChecker('profile', 'read');
    expect(checkConsent).not.toHaveBeenCalledWith('user-123', 'test-agent', 'vectors', 'read');
    expect(checkConsent).toHaveBeenCalledWith('user-123', 'test-agent', 'profile', 'read');
  });

  it('re-throws non-consent errors from requireConsent', async () => {
    (requireConsent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Database connection lost'),
    );
    setupFullMocks();

    await expect(
      retrieveUserKnowledge({ topic: 'sushi' }, baseCtx),
    ).rejects.toThrow('Database connection lost');
  });

  it('handles all three metadata failures simultaneously', async () => {
    consentAllowed();
    setupFullMocks();
    (listTables as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    (listCollections as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    (getLatestProfile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.warnings).toContain('Could not load table metadata');
    expect(result.data.warnings).toContain('Could not load collection metadata');
    expect(result.data.warnings).toContain('Could not load profile');

    // retrieveKnowledge should still be called with empty/null metadata
    expect(retrieveKnowledge).toHaveBeenCalledWith(
      'user-123',
      'sushi',
      'medium',
      expect.any(Function),
      [], // empty tables
      [], // empty collections
      null, // null profile
    );
  });

  it('returns INTERNAL_ERROR with stringified non-Error thrown from retrieveKnowledge', async () => {
    consentAllowed();
    setupFullMocks();
    (retrieveKnowledge as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

    const result = await retrieveUserKnowledge({ topic: 'sushi' }, baseCtx);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe(ToolErrorCode.INTERNAL_ERROR);
    expect(result.message).toContain('string error');
    expect(result.retryable).toBe(true);
  });
});
