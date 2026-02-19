// api/tests/unit/services/tools/getUserContext.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/services/tools/types';

// --- Mocks ---

vi.mock('@/services/consent.service', () => ({
  requireConsent: vi.fn(),
}));

vi.mock('@/services/audit.service', () => ({
  logAuditEntry: vi.fn(),
}));

vi.mock('@/services/profile.service', () => ({
  getLatestProfile: vi.fn(),
}));

vi.mock('@/services/table.service', () => ({
  listTables: vi.fn(),
}));

vi.mock('@/services/vector.service', () => ({
  listCollections: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  withUserSchema: vi.fn(),
}));

import { getUserContext } from '@/services/tools/getUserContext';
import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { getLatestProfile } from '@/services/profile.service';
import { listTables } from '@/services/table.service';
import { listCollections } from '@/services/vector.service';
import { withUserSchema } from '@/db/client';

// --- Fixtures ---

const baseCtx: ToolContext = {
  userId: 'user-123',
  agentId: 'test-agent',
  tier: 'free',
  authType: 'api_key',
  schemaName: 'user_user123',
  requestId: 'req-1',
};

const mockProfile = {
  data: { name: 'Alice', timezone: 'America/Los_Angeles' },
  version: 3,
  updated_at: '2026-02-19T00:00:00Z',
};

const mockTables = [
  { tableName: 'meals', description: 'Daily meals', recordCount: 42, columns: [], createdAt: new Date(), updatedAt: new Date() },
  { tableName: 'workouts', description: 'Exercise log', recordCount: 10, columns: [], createdAt: new Date(), updatedAt: new Date() },
];

const mockCollections = [
  { collection: 'journal', description: 'Journal entries', entryCount: 100, embeddingDim: 1536, createdAt: new Date() },
];

const mockEntities = [
  { type: 'person', name: 'Bob', properties: { role: 'friend' }, confidence: 0.95, mention_count: 12 },
];

const mockVectors = [
  { id: 1, collection: 'journal', text: 'Had coffee today', metadata: {}, created_at: new Date('2026-02-19'), confidence: 0.8, status: 'active' },
];

function consentAllowed() {
  (requireConsent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
}

function consentDenied(resource: string) {
  (requireConsent as ReturnType<typeof vi.fn>).mockImplementation(
    async (_userId: string, _agentId: string, res: string) => {
      if (res === resource) {
        throw new Error(`CONSENT_DENIED: Agent does not have read access to ${res}`);
      }
    },
  );
}

function consentDeniedAll() {
  (requireConsent as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error('CONSENT_DENIED: No access'),
  );
}

function setupFullMocks() {
  (logAuditEntry as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getLatestProfile as ReturnType<typeof vi.fn>).mockResolvedValue(mockProfile);
  (listTables as ReturnType<typeof vi.fn>).mockResolvedValue(mockTables);
  (listCollections as ReturnType<typeof vi.fn>).mockResolvedValue(mockCollections);
  (withUserSchema as ReturnType<typeof vi.fn>).mockImplementation(
    async (_userId: string, cb: (tx: unknown) => Promise<unknown>) => {
      // The callback receives a tx object. We need to determine which call this is
      // (entities or vectors) based on call order.
      const callCount = (withUserSchema as ReturnType<typeof vi.fn>).mock.calls.length;
      const mockTx = {
        unsafe: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM entities')) {
            return mockEntities;
          }
          if (sql.includes('FROM vectors')) {
            return mockVectors;
          }
          return [];
        }),
      };
      return cb(mockTx);
    },
  );
}

// --- Tests ---

describe('getUserContext service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all sections when full consent is granted', async () => {
    consentAllowed();
    setupFullMocks();

    const result = await getUserContext({}, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.profile).toEqual({ name: 'Alice', timezone: 'America/Los_Angeles' });
    expect(result.data.tables).toEqual([
      { name: 'meals', description: 'Daily meals', recordCount: 42 },
      { name: 'workouts', description: 'Exercise log', recordCount: 10 },
    ]);
    expect(result.data.collections).toEqual([
      { name: 'journal', description: 'Journal entries', entryCount: 100 },
    ]);
    expect(result.data.topEntities).toEqual([
      { type: 'person', name: 'Bob', properties: { role: 'friend' }, confidence: 0.95, mentionCount: 12 },
    ]);
    expect(result.data.recentMemories).toHaveLength(1);
    expect(result.data.recentMemories[0].text).toBe('Had coffee today');
    expect(result.meta?.warnings).toBeUndefined();
  });

  it('returns empty profile when profile consent is denied (top-level)', async () => {
    // When profile consent is denied, the top-level check fails and all sections are empty
    consentDenied('profile');
    setupFullMocks();

    const result = await getUserContext({}, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.profile).toBeNull();
    expect(result.data.tables).toEqual([]);
    expect(result.data.collections).toEqual([]);
    expect(result.data.topEntities).toEqual([]);
    expect(result.data.recentMemories).toEqual([]);
    expect(result.meta?.warnings).toContain('No profile read consent — all sections empty.');
  });

  it('returns empty topEntities when graph consent is denied', async () => {
    // Profile consent passes, graph consent fails
    (requireConsent as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId: string, _agentId: string, res: string) => {
        if (res === 'graph') {
          throw new Error('CONSENT_DENIED: No graph access');
        }
      },
    );
    setupFullMocks();

    const result = await getUserContext({}, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.profile).toEqual({ name: 'Alice', timezone: 'America/Los_Angeles' });
    expect(result.data.tables).toHaveLength(2);
    expect(result.data.collections).toHaveLength(1);
    expect(result.data.topEntities).toEqual([]);
    // recentMemories still populated (vectors consent is separate from graph)
    expect(result.data.recentMemories).toHaveLength(1);
    expect(result.meta?.warnings).toEqual(
      expect.arrayContaining(['No graph read consent — topEntities section empty.']),
    );
  });

  it('returns empty tables when tables consent is denied', async () => {
    (requireConsent as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId: string, _agentId: string, res: string) => {
        if (res === 'tables') {
          throw new Error('CONSENT_DENIED: No tables access');
        }
      },
    );
    setupFullMocks();

    const result = await getUserContext({}, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.profile).toEqual({ name: 'Alice', timezone: 'America/Los_Angeles' });
    expect(result.data.tables).toEqual([]);
    expect(result.data.collections).toHaveLength(1);
    expect(result.data.topEntities).toHaveLength(1);
    expect(result.data.recentMemories).toHaveLength(1);
    expect(result.meta?.warnings).toEqual(
      expect.arrayContaining(['No tables read consent — tables section empty.']),
    );
  });

  it('returns empty vectors sections when vectors consent is denied', async () => {
    (requireConsent as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId: string, _agentId: string, res: string) => {
        if (res === 'vectors') {
          throw new Error('CONSENT_DENIED: No vectors access');
        }
      },
    );
    setupFullMocks();

    const result = await getUserContext({}, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.profile).toEqual({ name: 'Alice', timezone: 'America/Los_Angeles' });
    expect(result.data.tables).toHaveLength(2);
    expect(result.data.collections).toEqual([]);
    expect(result.data.topEntities).toHaveLength(1);
    expect(result.data.recentMemories).toEqual([]);
    expect(result.meta?.warnings).toEqual(
      expect.arrayContaining([
        'No vectors read consent — collections section empty.',
        'No vectors read consent — recentMemories section empty.',
      ]),
    );
  });

  it('returns all sections empty but still ToolSuccess when all consent denied', async () => {
    consentDeniedAll();
    setupFullMocks();

    const result = await getUserContext({}, baseCtx);

    // Must be success, NOT failure
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.profile).toBeNull();
    expect(result.data.tables).toEqual([]);
    expect(result.data.collections).toEqual([]);
    expect(result.data.topEntities).toEqual([]);
    expect(result.data.recentMemories).toEqual([]);
  });

  it('passes topic to audit log', async () => {
    consentAllowed();
    setupFullMocks();

    await getUserContext({ topic: 'nutrition' }, baseCtx);

    expect(logAuditEntry).toHaveBeenCalledWith('user-123', {
      agentId: 'test-agent',
      action: 'mcp_get_user_context',
      resource: 'profile',
      details: { topic: 'nutrition' },
    });
  });

  it('does not audit when profile consent is denied', async () => {
    consentDenied('profile');
    setupFullMocks();

    await getUserContext({}, baseCtx);

    expect(logAuditEntry).not.toHaveBeenCalled();
  });

  it('returns null profile when getLatestProfile returns null', async () => {
    consentAllowed();
    setupFullMocks();
    (getLatestProfile as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await getUserContext({}, baseCtx);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.profile).toBeNull();
  });
});
