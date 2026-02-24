import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/table.service', () => ({
  insertRecord: vi.fn(),
}));

vi.mock('@/services/profile.service', () => ({
  updateProfile: vi.fn(),
}));

vi.mock('@/services/vector.service', () => ({
  addVector: vi.fn(),
}));

vi.mock('@/services/enrichmentQueue.service', () => ({
  enqueueEnrichmentJob: vi.fn(),
  enqueuePendingVector: vi.fn(),
}));

vi.mock('@/services/audit.service', () => ({
  logWritePipelineStage: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { ingestMemoryText, ingestProfileUpdate, ingestTableRecord } from '@/services/writeIngestion.service';
import { insertRecord } from '@/services/table.service';
import { updateProfile } from '@/services/profile.service';
import { addVector } from '@/services/vector.service';
import { enqueueEnrichmentJob, enqueuePendingVector } from '@/services/enrichmentQueue.service';
import { logWritePipelineStage } from '@/services/audit.service';

const insertRecordMock = vi.mocked(insertRecord);
const updateProfileMock = vi.mocked(updateProfile);
const addVectorMock = vi.mocked(addVector);
const enqueueEnrichmentJobMock = vi.mocked(enqueueEnrichmentJob);
const enqueuePendingVectorMock = vi.mocked(enqueuePendingVector);
const logWritePipelineStageMock = vi.mocked(logWritePipelineStage);

describe('write ingestion service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logWritePipelineStageMock.mockResolvedValue();
  });

  it('keeps profile writes accepted when enrichment enqueue fails', async () => {
    updateProfileMock.mockResolvedValue({
      id: 2,
      data: { name: 'Josh' },
      version: 2,
      changedBy: 'agent',
      changedFields: ['name'],
      changedAt: new Date('2026-02-16T00:00:00.000Z'),
    });
    enqueueEnrichmentJobMock.mockRejectedValue(new Error('relation "public.enrichment_jobs" does not exist'));

    const result = await ingestProfileUpdate({
      userId: 'u1',
      patch: { name: 'Josh' },
      changedBy: 'agent',
      origin: 'ai_stated',
    });

    expect(result.writeStatus).toBe('accepted');
    expect(result.sourceRef).toBe('profile:v2');
    expect(result.writeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(result.jobId).toBeUndefined();
  });

  it('passes tableDescription through to dynamic table creation path', async () => {
    insertRecordMock.mockResolvedValue(123);
    enqueueEnrichmentJobMock.mockResolvedValue(45);

    const result = await ingestTableRecord({
      userId: 'u1',
      tableName: 'meals',
      data: { food: 'burrito' },
      changedBy: 'agent',
      origin: 'ai_stated',
      tableDescription: 'Meal tracking',
    });

    expect(insertRecordMock).toHaveBeenCalledWith(
      'u1',
      'meals',
      { food: 'burrito' },
      'agent',
      'ai_stated',
      'Meal tracking',
      'free'
    );
    expect(result.recordId).toBe(123);
    expect(result.writeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(result.jobId).toBe(45);
    expect(result.writeStatus).toBe('accepted');
  });

  it('falls back to pending_vectors when embedding generation fails', async () => {
    addVectorMock.mockRejectedValue(new Error('Failed to generate embedding: OpenAI API error'));
    enqueuePendingVectorMock.mockResolvedValue(9);

    const result = await ingestMemoryText({
      userId: 'u1',
      collection: 'journal',
      text: 'family walk',
      metadata: { mood: 'good' },
      changedBy: 'agent',
      origin: 'ai_stated',
    });

    expect(result.writeStatus).toBe('pending_enrichment');
    expect(result.pendingVectorId).toBe(9);
    expect(result.writeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(result.sourceRef).toBe('journal:pending:9');
  });

  it('does not enqueue enrichment for graph_edges collection', async () => {
    addVectorMock.mockResolvedValue(55);

    const result = await ingestMemoryText({
      userId: 'u1',
      collection: 'graph_edges',
      text: 'Josh related_to Brianna',
      metadata: {},
      changedBy: 'system',
      origin: 'ai_stated',
    });

    expect(result.writeStatus).toBe('accepted');
    expect(result.vectorId).toBe(55);
    // Enrichment should NOT be enqueued for derived collections
    expect(enqueueEnrichmentJobMock).not.toHaveBeenCalled();
  });

  it('does not enqueue enrichment for graph_edges in memory_backlog fallback', async () => {
    addVectorMock.mockRejectedValue(new Error('Failed to generate embedding: OpenAI API error'));
    enqueuePendingVectorMock.mockRejectedValue(new Error('relation "public.pending_vectors" does not exist'));
    insertRecordMock.mockResolvedValue(88);

    const result = await ingestMemoryText({
      userId: 'u1',
      collection: 'graph_edges',
      text: 'Josh related_to Brianna',
      metadata: {},
      changedBy: 'system',
      origin: 'ai_stated',
    });

    expect(result.writeStatus).toBe('pending_enrichment');
    expect(result.sourceRef).toBe('memory_backlog:88');
    // Enrichment should NOT be enqueued even in the backlog path
    expect(enqueueEnrichmentJobMock).not.toHaveBeenCalled();
  });

  it('stores memory in memory_backlog when pending queue is unavailable', async () => {
    addVectorMock.mockRejectedValue(new Error('Failed to generate embedding: OpenAI API error'));
    enqueuePendingVectorMock.mockRejectedValue(new Error('relation "public.pending_vectors" does not exist'));
    insertRecordMock.mockResolvedValue(88);
    enqueueEnrichmentJobMock.mockResolvedValue(77);

    const result = await ingestMemoryText({
      userId: 'u1',
      collection: 'journal',
      text: 'Family walk to canyon crest',
      metadata: { people: ['Josh', 'Brianna'] },
      changedBy: 'agent',
      origin: 'ai_stated',
    });

    expect(insertRecordMock).toHaveBeenCalledWith(
      'u1',
      'memory_backlog',
      expect.objectContaining({
        collection: 'journal',
        text: 'Family walk to canyon crest',
        pending_reason: 'embedding_unavailable',
      }),
      'agent',
      'ai_stated',
      'Fallback storage for memories while embedding/pending queue is unavailable',
      'free'
    );
    expect(result.writeStatus).toBe('pending_enrichment');
    expect(result.sourceRef).toBe('memory_backlog:88');
    expect(result.writeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(result.jobId).toBe(77);
  });
});
