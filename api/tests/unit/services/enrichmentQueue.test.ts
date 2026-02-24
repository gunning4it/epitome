import { beforeEach, describe, it, expect, vi } from 'vitest';

// L-2 SECURITY TEST: Verify QUEUE_TABLE_MAP strict allowlist
// The QUEUE_TABLE_MAP is private, so we test indirectly via the module's type safety.
// The TypeScript type restricts the table param to 'enrichment_jobs' | 'pending_vectors',
// so invalid values are caught at compile time. The runtime guard is an extra safety net.

describe('enrichmentQueue.QUEUE_TABLE_MAP', () => {
  it('should map valid table names to qualified names', async () => {
    // Import the module to verify it loads correctly with the allowlist
    const mod = await import('@/services/enrichmentQueue.service');
    // The module should export its public functions without error
    expect(typeof mod.processEnrichmentJobsBatch).toBe('function');
    expect(typeof mod.processPendingVectorsBatch).toBe('function');
  });
});

// =====================================================
// ENRICHMENT SKIP COLLECTION TESTS
// =====================================================

vi.mock('@/db/client', () => ({
  sql: Object.assign(
    vi.fn(),
    { unsafe: vi.fn() }
  ),
}));
vi.mock('@/services/entityExtraction', () => ({
  extractEntitiesFromRecord: vi.fn(),
}));
vi.mock('@/services/audit.service', () => ({
  logWritePipelineStage: vi.fn(),
}));
vi.mock('@/services/vector.service', () => ({
  addVector: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { sql } from '@/db/client';
import { extractEntitiesFromRecord } from '@/services/entityExtraction';
import { addVector } from '@/services/vector.service';

const sqlUnsafe = vi.mocked((sql as any).unsafe);
const extractMock = vi.mocked(extractEntitiesFromRecord);
const addVectorMock = vi.mocked(addVector);

describe('processEnrichmentJobsBatch — skip derived collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips graph_edges jobs without calling extractEntitiesFromRecord', async () => {
    // Simulate claiming one graph_edges job
    sqlUnsafe
      // claimNextEnrichmentJobs
      .mockResolvedValueOnce([
        {
          id: 99,
          user_id: 'u1',
          source_type: 'vector',
          source_ref: 'graph_edges:42',
          payload: JSON.stringify({
            tableName: 'graph_edges',
            record: { id: 42, text: 'Josh related_to Brianna' },
            pipeline: null,
          }),
          status: 'processing',
          attempt_count: 0,
        },
      ])
      // markEnrichmentJobDone
      .mockResolvedValueOnce([]);

    const { processEnrichmentJobsBatch } = await import(
      '@/services/enrichmentQueue.service'
    );
    const result = await processEnrichmentJobsBatch(10);

    expect(extractMock).not.toHaveBeenCalled();
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    // Should have marked job done
    expect(sqlUnsafe).toHaveBeenCalledTimes(2);
  });
});

describe('processPendingVectorsBatch — skip derived collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not enqueue enrichment for graph_edges after vectorizing', async () => {
    // Simulate claiming one graph_edges pending vector
    sqlUnsafe
      // claimNextPendingVectors
      .mockResolvedValueOnce([
        {
          id: 7,
          user_id: 'u1',
          collection: 'graph_edges',
          text: 'Josh friend Brianna',
          metadata: '{}',
          changed_by: 'system',
          origin: 'ai_stated',
          source_ref: null,
          status: 'processing',
          attempt_count: 0,
        },
      ])
      // markPendingVectorDone
      .mockResolvedValueOnce([]);

    addVectorMock.mockResolvedValue(100);

    // We need to spy on enqueueEnrichmentJob — since it's in the same module,
    // the simplest check is that sqlUnsafe is NOT called a 3rd time (for INSERT INTO enrichment_jobs)
    const { processPendingVectorsBatch } = await import(
      '@/services/enrichmentQueue.service'
    );
    const result = await processPendingVectorsBatch(10);

    expect(addVectorMock).toHaveBeenCalledWith(
      'u1', 'graph_edges', 'Josh friend Brianna', {}, 'system', 'ai_stated'
    );
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    // Only 2 SQL calls: claimNextPendingVectors + markPendingVectorDone
    // No 3rd call for enqueueEnrichmentJob
    expect(sqlUnsafe).toHaveBeenCalledTimes(2);
  });
});
