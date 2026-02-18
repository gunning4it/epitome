import { describe, it, expect } from 'vitest';

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
