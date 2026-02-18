import { randomUUID } from 'crypto';
import { insertRecord } from '@/services/table.service';
import { updateProfile, type ProfileData, type ProfileVersion } from '@/services/profile.service';
import { addVector } from '@/services/vector.service';
import {
  type EnrichmentSourceType,
  type EnrichmentPipelineMeta,
  enqueueEnrichmentJob,
  enqueuePendingVector,
} from '@/services/enrichmentQueue.service';
import { logWritePipelineStage } from '@/services/audit.service';
import { createKnowledgeClaim } from '@/services/claimLedger.service';
import { logger } from '@/utils/logger';

export type WriteStatus = 'accepted' | 'pending_enrichment';

export interface ProfileIngestionResult {
  profile: ProfileVersion;
  sourceRef: string;
  writeId: string;
  jobId?: number;
  writeStatus: WriteStatus;
}

export interface TableIngestionResult {
  recordId: number;
  sourceRef: string;
  writeId: string;
  jobId?: number;
  writeStatus: WriteStatus;
}

export interface MemoryIngestionResult {
  vectorId?: number;
  pendingVectorId?: number;
  sourceRef: string;
  writeId: string;
  jobId?: number;
  writeStatus: WriteStatus;
}

export function createWriteId(): string {
  return randomUUID();
}

const LEDGER_WRITE_ENABLED = process.env.LEDGER_WRITE_ENABLED === 'true';

async function safeCreateKnowledgeClaim(
  userId: string,
  input: Parameters<typeof createKnowledgeClaim>[1]
): Promise<void> {
  if (!LEDGER_WRITE_ENABLED) {
    return;
  }

  try {
    await createKnowledgeClaim(userId, input);
  } catch (error) {
    logger.warn('Knowledge claim write skipped', {
      userId,
      claimType: input.claimType,
      sourceRef: input.sourceRef,
      writeId: input.writeId,
      error: String(error),
    });
  }
}

async function safeLogWritePipelineStage(
  userId: string,
  entry: Parameters<typeof logWritePipelineStage>[1]
): Promise<void> {
  try {
    await logWritePipelineStage(userId, entry);
  } catch (error) {
    logger.warn('Write pipeline audit log failed', {
      userId,
      writeId: entry.writeId,
      stage: entry.stage,
      resource: entry.resource,
      error: String(error),
    });
  }
}

function isEmbeddingFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('embedding') ||
    message.includes('openai') ||
    message.includes('invalid_api_key') ||
    message.includes('incorrect api key') ||
    message.includes('api key') ||
    message.includes('failed to generate embedding')
  );
}

function isMissingQueueTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const code = (error as { code?: string } | undefined)?.code;
  return (
    code === '42P01' ||
    (message.includes('enrichment_jobs') && message.includes('does not exist')) ||
    (message.includes('pending_vectors') && message.includes('does not exist'))
  );
}

async function safeEnqueueEnrichment(params: {
  userId: string;
  sourceType: EnrichmentSourceType;
  sourceRef: string;
  tableName: string;
  record: Record<string, unknown>;
  pipeline?: EnrichmentPipelineMeta;
}): Promise<number | undefined> {
  try {
    const jobId = await enqueueEnrichmentJob(
      params.userId,
      params.sourceType,
      params.sourceRef,
      params.tableName,
      params.record,
      params.pipeline
    );

    if (params.pipeline) {
      await safeLogWritePipelineStage(params.userId, {
        agentId: params.pipeline.agentId,
        resource: params.pipeline.resource,
        writeId: params.pipeline.writeId,
        stage: 'enrichment_queued',
        sourceRef: params.sourceRef,
        jobId,
        metaId: params.pipeline.metaId,
        vectorId: params.pipeline.vectorId,
        writeStatus: params.pipeline.writeStatus,
        latencyMs: params.pipeline.startedAt
          ? Date.now() - params.pipeline.startedAt
          : undefined,
      });
    }

    return jobId;
  } catch (error) {
    logger.warn('Enrichment job enqueue skipped', {
      userId: params.userId,
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
      tableName: params.tableName,
      missingQueueTables: isMissingQueueTableError(error),
      error: String(error),
    });

    if (params.pipeline) {
      await safeLogWritePipelineStage(params.userId, {
        agentId: params.pipeline.agentId,
        resource: params.pipeline.resource,
        writeId: params.pipeline.writeId,
        stage: 'enrichment_failed',
        sourceRef: params.sourceRef,
        metaId: params.pipeline.metaId,
        vectorId: params.pipeline.vectorId,
        writeStatus: params.pipeline.writeStatus,
        latencyMs: params.pipeline.startedAt
          ? Date.now() - params.pipeline.startedAt
          : undefined,
        error: String(error),
      });
    }

    return undefined;
  }
}

export async function ingestProfileUpdate(params: {
  userId: string;
  patch: Partial<ProfileData>;
  changedBy: string;
  origin: string;
  writeId?: string;
}): Promise<ProfileIngestionResult> {
  const writeId = params.writeId || createWriteId();
  const startedAt = Date.now();
  const updated = await updateProfile(
    params.userId,
    params.patch,
    params.changedBy,
    params.origin
  );

  const sourceRef = `profile:v${updated.version}`;
  await safeLogWritePipelineStage(params.userId, {
    agentId: params.changedBy,
    resource: 'profile',
    writeId,
    stage: 'profile_written',
    sourceRef,
    metaId: updated.metaId,
    writeStatus: 'accepted',
    latencyMs: Date.now() - startedAt,
  });

  await safeCreateKnowledgeClaim(params.userId, {
    claimType: 'profile_update',
    subject: {
      kind: 'profile',
      path: '$',
    },
    predicate: 'profile_updated',
    object: {
      patch: params.patch,
      version: updated.version,
    },
    confidence: 0.95,
    status: 'active',
    method: 'deterministic',
    origin: (params.origin as 'user_stated' | 'user_typed' | 'ai_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system'),
    sourceRef,
    writeId,
    agentId: params.changedBy,
    memoryMetaId: updated.metaId,
    metadata: {
      changedFields: updated.changedFields ?? [],
    },
    evidence: [
      {
        evidenceType: 'profile_version',
        sourceRef,
        profileVersion: updated.version,
        confidence: 0.95,
      },
    ],
  });

  const jobId = await safeEnqueueEnrichment({
    userId: params.userId,
    sourceType: 'profile',
    sourceRef,
    tableName: 'profile',
    record: updated.data as Record<string, unknown>,
    pipeline: {
      writeId,
      agentId: params.changedBy,
      resource: 'profile',
      sourceRef,
      metaId: updated.metaId,
      writeStatus: 'accepted',
      startedAt,
    },
  });

  return {
    profile: updated,
    sourceRef,
    writeId,
    jobId,
    writeStatus: 'accepted',
  };
}

export async function ingestTableRecord(params: {
  userId: string;
  tableName: string;
  data: Record<string, unknown>;
  changedBy: string;
  origin: string;
  tableDescription?: string;
  writeId?: string;
}): Promise<TableIngestionResult> {
  const writeId = params.writeId || createWriteId();
  const startedAt = Date.now();
  const recordId = await insertRecord(
    params.userId,
    params.tableName,
    params.data,
    params.changedBy,
    params.origin,
    params.tableDescription
  );

  const sourceRef = `${params.tableName}:${recordId}`;
  await safeLogWritePipelineStage(params.userId, {
    agentId: params.changedBy,
    resource: `tables/${params.tableName}`,
    writeId,
    stage: 'table_written',
    sourceRef,
    writeStatus: 'accepted',
    latencyMs: Date.now() - startedAt,
  });

  await safeCreateKnowledgeClaim(params.userId, {
    claimType: 'table_record_upsert',
    subject: {
      kind: 'table',
      tableName: params.tableName,
      recordId,
    },
    predicate: 'record_upserted',
    object: {
      tableName: params.tableName,
      recordId,
      data: params.data,
    },
    confidence: 0.9,
    status: 'active',
    method: 'deterministic',
    origin: (params.origin as 'user_stated' | 'user_typed' | 'ai_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system'),
    sourceRef,
    writeId,
    agentId: params.changedBy,
    evidence: [
      {
        evidenceType: 'table_row',
        sourceRef,
        tableName: params.tableName,
        recordId,
        confidence: 0.9,
      },
    ],
  });

  const payload = {
    ...params.data,
    id: recordId,
  };
  const jobId = await safeEnqueueEnrichment({
    userId: params.userId,
    sourceType: 'table',
    sourceRef,
    tableName: params.tableName,
    record: payload,
    pipeline: {
      writeId,
      agentId: params.changedBy,
      resource: `tables/${params.tableName}`,
      sourceRef,
      writeStatus: 'accepted',
      startedAt,
    },
  });

  return {
    recordId,
    sourceRef,
    writeId,
    jobId,
    writeStatus: 'accepted',
  };
}

export async function ingestMemoryText(params: {
  userId: string;
  collection: string;
  text: string;
  metadata?: Record<string, unknown>;
  changedBy: string;
  origin: string;
  sourceRefHint?: string;
  writeId?: string;
}): Promise<MemoryIngestionResult> {
  const writeId = params.writeId || createWriteId();
  const startedAt = Date.now();
  const metadata = params.metadata || {};
  const resource = `vectors/${params.collection}`;

  try {
    const vectorId = await addVector(
      params.userId,
      params.collection,
      params.text,
      metadata,
      params.changedBy,
      params.origin
    );

    const sourceRef = `${params.collection}:${vectorId}`;
    await safeLogWritePipelineStage(params.userId, {
      agentId: params.changedBy,
      resource,
      writeId,
      stage: 'vector_written',
      sourceRef,
      vectorId,
      writeStatus: 'accepted',
      latencyMs: Date.now() - startedAt,
    });

    await safeCreateKnowledgeClaim(params.userId, {
      claimType: 'vector_memory_added',
      subject: {
        kind: 'vector',
        collection: params.collection,
        vectorId,
      },
      predicate: 'memory_added',
      object: {
        collection: params.collection,
        text: params.text,
        metadata,
      },
      confidence: 0.9,
      status: 'active',
      method: 'deterministic',
      origin: (params.origin as 'user_stated' | 'user_typed' | 'ai_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system'),
      sourceRef,
      writeId,
      agentId: params.changedBy,
      evidence: [
        {
          evidenceType: 'vector',
          sourceRef,
          vectorId,
          confidence: 0.9,
        },
      ],
    });

    const jobId = await safeEnqueueEnrichment({
      userId: params.userId,
      sourceType: 'vector',
      sourceRef,
      tableName: params.collection,
      record: {
        id: vectorId,
        text: params.text,
        collection: params.collection,
        metadata,
      },
      pipeline: {
        writeId,
        agentId: params.changedBy,
        resource,
        sourceRef,
        vectorId,
        writeStatus: 'accepted',
        startedAt,
      },
    });

    return {
      vectorId,
      sourceRef,
      writeId,
      jobId,
      writeStatus: 'accepted',
    };
  } catch (error) {
    if (!isEmbeddingFailure(error)) {
      throw error;
    }

    try {
      const pendingVectorId = await enqueuePendingVector(
        params.userId,
        params.collection,
        params.text,
        metadata,
        params.changedBy,
        params.origin,
        params.sourceRefHint
      );

      const sourceRef = params.sourceRefHint || `${params.collection}:pending:${pendingVectorId}`;
      await safeLogWritePipelineStage(params.userId, {
        agentId: params.changedBy,
        resource,
        writeId,
        stage: 'vector_pending',
        sourceRef,
        writeStatus: 'pending_enrichment',
        latencyMs: Date.now() - startedAt,
        error: String(error),
      });

      await safeCreateKnowledgeClaim(params.userId, {
        claimType: 'vector_memory_pending',
        subject: {
          kind: 'vector_pending',
          collection: params.collection,
          pendingVectorId,
        },
        predicate: 'memory_pending',
        object: {
          collection: params.collection,
          text: params.text,
          metadata,
          pendingVectorId,
        },
        confidence: 0.6,
        status: 'proposed',
        method: 'deterministic',
        origin: (params.origin as 'user_stated' | 'user_typed' | 'ai_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system'),
        sourceRef,
        writeId,
        agentId: params.changedBy,
        reason: 'embedding_unavailable',
        evidence: [
          {
            evidenceType: 'artifact',
            sourceRef,
            confidence: 0.6,
            metadata: {
              embeddingError: String(error),
            },
          },
        ],
      });
      logger.warn('Memory persisted to pending_vectors after embedding failure', {
        userId: params.userId,
        collection: params.collection,
        pendingVectorId,
        sourceRef,
        error: String(error),
      });

      return {
        pendingVectorId,
        sourceRef,
        writeId,
        writeStatus: 'pending_enrichment',
      };
    } catch (pendingError) {
      logger.warn('pending_vectors enqueue failed; writing fallback memory_backlog row', {
        userId: params.userId,
        collection: params.collection,
        sourceRefHint: params.sourceRefHint,
        missingQueueTables: isMissingQueueTableError(pendingError),
        error: String(pendingError),
      });

      const backlogRecordId = await insertRecord(
        params.userId,
        'memory_backlog',
        {
          collection: params.collection,
          text: params.text,
          metadata,
          pending_reason: 'embedding_unavailable',
          embedding_error: String(error),
          source_ref_hint: params.sourceRefHint || null,
        },
        params.changedBy,
        params.origin,
        'Fallback storage for memories while embedding/pending queue is unavailable'
      );

      const sourceRef = `memory_backlog:${backlogRecordId}`;
      await safeLogWritePipelineStage(params.userId, {
        agentId: params.changedBy,
        resource,
        writeId,
        stage: 'vector_pending',
        sourceRef,
        writeStatus: 'pending_enrichment',
        latencyMs: Date.now() - startedAt,
        error: String(error),
      });
      await safeCreateKnowledgeClaim(params.userId, {
        claimType: 'memory_backlog_fallback',
        subject: {
          kind: 'table',
          tableName: 'memory_backlog',
          recordId: backlogRecordId,
        },
        predicate: 'memory_backlog_recorded',
        object: {
          backlogRecordId,
          collection: params.collection,
          metadata,
        },
        confidence: 0.7,
        status: 'proposed',
        method: 'deterministic',
        origin: (params.origin as 'user_stated' | 'user_typed' | 'ai_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system'),
        sourceRef,
        writeId,
        agentId: params.changedBy,
        reason: 'pending_queue_unavailable',
        evidence: [
          {
            evidenceType: 'table_row',
            sourceRef,
            tableName: 'memory_backlog',
            recordId: backlogRecordId,
            confidence: 0.7,
            metadata: {
              embeddingError: String(error),
            },
          },
        ],
      });

      const jobId = await safeEnqueueEnrichment({
        userId: params.userId,
        sourceType: 'table',
        sourceRef,
        tableName: 'memory_backlog',
        record: {
          id: backlogRecordId,
          collection: params.collection,
          text: params.text,
          metadata,
          source_ref_hint: params.sourceRefHint || null,
        },
        pipeline: {
          writeId,
          agentId: params.changedBy,
          resource,
          sourceRef,
          writeStatus: 'pending_enrichment',
          startedAt,
        },
      });

      return {
        sourceRef,
        writeId,
        jobId,
        writeStatus: 'pending_enrichment',
      };
    }
  }
}
