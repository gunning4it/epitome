import { sql } from '@/db/client';
import { extractEntitiesFromRecord } from '@/services/entityExtraction';
import { logWritePipelineStage } from '@/services/audit.service';
import { addVector } from '@/services/vector.service';
import { logger } from '@/utils/logger';

export type EnrichmentSourceType = 'profile' | 'table' | 'vector';
export type QueueStatus = 'pending' | 'processing' | 'retry' | 'done' | 'failed';

export interface EnrichmentPipelineMeta {
  writeId: string;
  agentId: string;
  resource: string;
  sourceRef?: string;
  metaId?: number;
  vectorId?: number;
  writeStatus?: string;
  startedAt?: number;
}

interface EnrichmentJobRow {
  id: number;
  user_id: string;
  source_type: EnrichmentSourceType;
  source_ref: string;
  payload: Record<string, unknown> | string | null;
  status: QueueStatus;
  attempt_count: number;
}

interface PendingVectorRow {
  id: number;
  user_id: string;
  collection: string;
  text: string;
  metadata: Record<string, unknown> | string | null;
  changed_by: string | null;
  origin: string | null;
  source_ref: string | null;
  status: QueueStatus;
  attempt_count: number;
}

interface EnrichmentPayload {
  tableName?: unknown;
  record?: unknown;
  pipeline?: unknown;
}

const DEFAULT_MAX_ATTEMPTS = Number(process.env.ENRICHMENT_MAX_ATTEMPTS || 10);
const DEFAULT_BATCH_SIZE = Number(process.env.ENRICHMENT_BATCH_SIZE || 25);
const DEFAULT_INTERVAL_MS = Number(process.env.ENRICHMENT_POLL_MS || 5000);

let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerActive = false;
let workerBootstrapping = false;
const missingTableWarnings = new Set<string>();

function isMissingQueueTableError(error: unknown, table: 'enrichment_jobs' | 'pending_vectors'): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const code = (error as { code?: string } | undefined)?.code;
  return (
    code === '42P01' ||
    (message.includes(`public.${table}`) && message.includes('does not exist')) ||
    (message.includes(`relation "${table}"`) && message.includes('does not exist'))
  );
}

function warnMissingQueueTable(table: 'enrichment_jobs' | 'pending_vectors'): void {
  if (missingTableWarnings.has(table)) return;
  missingTableWarnings.add(table);
  logger.warn(`Queue table missing; background enrichment disabled for ${table}`, { table });
}

async function queueTablesExist(): Promise<boolean> {
  const rows = await sql.unsafe<Array<{ jobs_exists: boolean; pending_exists: boolean }>>(
    `
    SELECT
      to_regclass('public.enrichment_jobs') IS NOT NULL AS jobs_exists,
      to_regclass('public.pending_vectors') IS NOT NULL AS pending_exists
  `
  );
  return Boolean(rows[0]?.jobs_exists && rows[0]?.pending_exists);
}

function parsePayload(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value;
}

function parsePipelineMeta(
  value: unknown,
  fallbackSourceRef: string
): EnrichmentPipelineMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const meta = value as Record<string, unknown>;
  const writeId = typeof meta.writeId === 'string' ? meta.writeId : null;
  const agentId = typeof meta.agentId === 'string' ? meta.agentId : null;
  const resource = typeof meta.resource === 'string' ? meta.resource : null;
  if (!writeId || !agentId || !resource) return null;

  return {
    writeId,
    agentId,
    resource,
    sourceRef: typeof meta.sourceRef === 'string' ? meta.sourceRef : fallbackSourceRef,
    metaId: typeof meta.metaId === 'number' ? meta.metaId : undefined,
    vectorId: typeof meta.vectorId === 'number' ? meta.vectorId : undefined,
    writeStatus: typeof meta.writeStatus === 'string' ? meta.writeStatus : undefined,
    startedAt: typeof meta.startedAt === 'number' ? meta.startedAt : undefined,
  };
}

async function safeLogWritePipelineStage(
  userId: string,
  entry: Parameters<typeof logWritePipelineStage>[1]
): Promise<void> {
  try {
    await logWritePipelineStage(userId, entry);
  } catch (error) {
    logger.warn('Write pipeline log failed in enrichment worker', {
      userId,
      writeId: entry.writeId,
      stage: entry.stage,
      error: String(error),
    });
  }
}

function computeBackoffSeconds(attempt: number): number {
  // 5s, 10s, 20s ... up to 10m
  return Math.min(600, Math.max(5, 2 ** attempt * 5));
}

function shouldRetryError(message: string): boolean {
  const lower = message.toLowerCase();

  // Keep retries for transient/provider/config errors.
  if (lower.includes('openai') || lower.includes('embedding')) {
    return true;
  }

  // SQL sandbox / contract errors are not retryable by worker.
  if (lower.includes('sql_sandbox_error') || lower.includes('invalid_args')) {
    return false;
  }

  return true;
}

export async function enqueueEnrichmentJob(
  userId: string,
  sourceType: EnrichmentSourceType,
  sourceRef: string,
  tableName: string,
  record: Record<string, unknown>,
  pipeline?: EnrichmentPipelineMeta
): Promise<number> {
  const payload = {
    tableName,
    record,
    pipeline: pipeline || null,
  };

  const rows = await sql.unsafe<Array<{ id: number }>>(
    `
    INSERT INTO public.enrichment_jobs (
      user_id,
      source_type,
      source_ref,
      payload,
      status,
      attempt_count,
      next_run_at,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4::jsonb, 'pending', 0, NOW(), NOW(), NOW()
    )
    RETURNING id
  `,
    [userId, sourceType, sourceRef, JSON.stringify(payload)]
  );

  return rows[0].id;
}

export async function enqueuePendingVector(
  userId: string,
  collection: string,
  text: string,
  metadata: Record<string, unknown>,
  changedBy: string,
  origin: string,
  sourceRef?: string
): Promise<number> {
  const rows = await sql.unsafe<Array<{ id: number }>>(
    `
    INSERT INTO public.pending_vectors (
      user_id,
      collection,
      text,
      metadata,
      changed_by,
      origin,
      source_ref,
      status,
      attempt_count,
      next_run_at,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4::jsonb, $5, $6, $7, 'pending', 0, NOW(), NOW(), NOW()
    )
    RETURNING id
  `,
    [
      userId,
      collection,
      text,
      JSON.stringify(metadata),
      changedBy,
      origin,
      sourceRef || null,
    ]
  );

  return rows[0].id;
}

async function claimNextEnrichmentJobs(limit: number): Promise<EnrichmentJobRow[]> {
  return await sql.unsafe<EnrichmentJobRow[]>(
    `
    WITH picked AS (
      SELECT id
      FROM public.enrichment_jobs
      WHERE status IN ('pending', 'retry')
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC, created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.enrichment_jobs j
    SET status = 'processing',
        updated_at = NOW()
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.id, j.user_id::text, j.source_type, j.source_ref, j.payload, j.status, j.attempt_count
  `,
    [limit]
  );
}

async function claimNextPendingVectors(limit: number): Promise<PendingVectorRow[]> {
  return await sql.unsafe<PendingVectorRow[]>(
    `
    WITH picked AS (
      SELECT id
      FROM public.pending_vectors
      WHERE status IN ('pending', 'retry')
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC, created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.pending_vectors v
    SET status = 'processing',
        updated_at = NOW()
    FROM picked
    WHERE v.id = picked.id
    RETURNING v.id, v.user_id::text, v.collection, v.text, v.metadata, v.changed_by, v.origin, v.source_ref, v.status, v.attempt_count
  `,
    [limit]
  );
}

async function markEnrichmentJobDone(id: number): Promise<void> {
  await sql.unsafe(
    `
    UPDATE public.enrichment_jobs
    SET status = 'done',
        processed_at = NOW(),
        updated_at = NOW(),
        last_error = NULL
    WHERE id = $1
  `,
    [id]
  );
}

async function markPendingVectorDone(id: number, vectorId: number): Promise<void> {
  await sql.unsafe(
    `
    UPDATE public.pending_vectors
    SET status = 'done',
        vector_id = $2,
        processed_at = NOW(),
        updated_at = NOW(),
        last_error = NULL
    WHERE id = $1
  `,
    [id, vectorId]
  );
}

async function markJobFailure(
  table: 'enrichment_jobs' | 'pending_vectors',
  id: number,
  attemptCount: number,
  errorMessage: string
): Promise<QueueStatus> {
  const nextAttempt = attemptCount + 1;
  const retryable = shouldRetryError(errorMessage);
  const exhausted = nextAttempt >= DEFAULT_MAX_ATTEMPTS;
  const status: QueueStatus = retryable && !exhausted ? 'retry' : 'failed';

  const tableName = table === 'pending_vectors'
    ? 'public.pending_vectors'
    : 'public.enrichment_jobs';

  if (status === 'retry') {
    const backoff = computeBackoffSeconds(nextAttempt);
    await sql.unsafe(
      `
      UPDATE ${tableName}
      SET status = 'retry',
          attempt_count = $2,
          last_error = $3,
          next_run_at = NOW() + ($4 * INTERVAL '1 second'),
          updated_at = NOW()
      WHERE id = $1
    `,
      [id, nextAttempt, errorMessage.slice(0, 2000), backoff]
    );
    return status;
  }

  await sql.unsafe(
    `
    UPDATE ${tableName}
    SET status = 'failed',
        attempt_count = $2,
        last_error = $3,
        updated_at = NOW()
    WHERE id = $1
  `,
    [id, nextAttempt, errorMessage.slice(0, 2000)]
  );
  return status;
}

export async function processEnrichmentJobsBatch(
  limit: number = DEFAULT_BATCH_SIZE
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  let jobs: EnrichmentJobRow[] = [];

  try {
    jobs = await claimNextEnrichmentJobs(limit);
  } catch (error) {
    if (isMissingQueueTableError(error, 'enrichment_jobs')) {
      warnMissingQueueTable('enrichment_jobs');
      return { processed: 0, failed: 0 };
    }
    throw error;
  }

  for (const job of jobs) {
    let pipelineMeta: EnrichmentPipelineMeta | null = null;
    try {
      const payload = parsePayload(job.payload) as EnrichmentPayload;
      const tableName = String(payload.tableName || '').trim();
      const record = (payload.record || {}) as Record<string, unknown>;
      pipelineMeta = parsePipelineMeta(payload.pipeline, job.source_ref);

      if (!tableName) {
        throw new Error('INVALID_ARGS: enrichment payload missing tableName');
      }

      await extractEntitiesFromRecord(
        job.user_id,
        tableName,
        record,
        'llm_first'
      );

      await markEnrichmentJobDone(job.id);
      if (pipelineMeta) {
        await safeLogWritePipelineStage(job.user_id, {
          agentId: pipelineMeta.agentId,
          resource: pipelineMeta.resource,
          writeId: pipelineMeta.writeId,
          stage: 'enrichment_done',
          sourceRef: pipelineMeta.sourceRef || job.source_ref,
          jobId: job.id,
          metaId: pipelineMeta.metaId,
          vectorId: pipelineMeta.vectorId,
          writeStatus: pipelineMeta.writeStatus,
          latencyMs: pipelineMeta.startedAt
            ? Date.now() - pipelineMeta.startedAt
            : undefined,
        });
      }
      processed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Enrichment job failed', {
        jobId: job.id,
        userId: job.user_id,
        sourceType: job.source_type,
        sourceRef: job.source_ref,
        error: message,
      });
      const status = await markJobFailure('enrichment_jobs', job.id, job.attempt_count, message);
      if (status === 'failed' && pipelineMeta) {
        await safeLogWritePipelineStage(job.user_id, {
          agentId: pipelineMeta.agentId,
          resource: pipelineMeta.resource,
          writeId: pipelineMeta.writeId,
          stage: 'enrichment_failed',
          sourceRef: pipelineMeta.sourceRef || job.source_ref,
          jobId: job.id,
          metaId: pipelineMeta.metaId,
          vectorId: pipelineMeta.vectorId,
          writeStatus: pipelineMeta.writeStatus,
          latencyMs: pipelineMeta.startedAt
            ? Date.now() - pipelineMeta.startedAt
            : undefined,
          error: message,
        });
      }
    }
  }

  return { processed, failed };
}

export async function processPendingVectorsBatch(
  limit: number = DEFAULT_BATCH_SIZE
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  let pendingRows: PendingVectorRow[] = [];

  try {
    pendingRows = await claimNextPendingVectors(limit);
  } catch (error) {
    if (isMissingQueueTableError(error, 'pending_vectors')) {
      warnMissingQueueTable('pending_vectors');
      return { processed: 0, failed: 0 };
    }
    throw error;
  }

  for (const row of pendingRows) {
    try {
      const metadata = parsePayload(row.metadata);
      const changedBy = row.changed_by || 'system';
      const origin = row.origin || 'ai_stated';

      const vectorId = await addVector(
        row.user_id,
        row.collection,
        row.text,
        metadata,
        changedBy,
        origin
      );

      await markPendingVectorDone(row.id, vectorId);

      // Queue extraction for the newly persisted vector record.
      const sourceRef = `${row.collection}:${vectorId}`;
      await enqueueEnrichmentJob(
        row.user_id,
        'vector',
        sourceRef,
        row.collection,
        {
          id: vectorId,
          text: row.text,
          collection: row.collection,
          metadata,
        }
      );

      processed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Pending vector processing failed', {
        pendingVectorId: row.id,
        userId: row.user_id,
        collection: row.collection,
        error: message,
      });
      await markJobFailure('pending_vectors', row.id, row.attempt_count, message);
    }
  }

  return { processed, failed };
}

export async function runEnrichmentCycle(): Promise<void> {
  if (workerActive) return;
  workerActive = true;

  try {
    const vectors = await processPendingVectorsBatch();
    const jobs = await processEnrichmentJobsBatch();

    if (vectors.processed || vectors.failed || jobs.processed || jobs.failed) {
      logger.info('Enrichment cycle completed', {
        pendingVectorsProcessed: vectors.processed,
        pendingVectorsFailed: vectors.failed,
        jobsProcessed: jobs.processed,
        jobsFailed: jobs.failed,
      });
    }
  } finally {
    workerActive = false;
  }
}

export function startEnrichmentWorkers(): void {
  if (process.env.ENRICHMENT_WORKER_ENABLED === 'false') {
    logger.info('Enrichment worker disabled via ENRICHMENT_WORKER_ENABLED=false');
    return;
  }

  if (workerTimer || workerBootstrapping) return;
  workerBootstrapping = true;

  void (async () => {
    try {
      const tablesReady = await queueTablesExist();
      if (!tablesReady) {
        logger.warn('Enrichment worker not started: queue tables are missing', {
          expectedTables: ['public.enrichment_jobs', 'public.pending_vectors'],
        });
        return;
      }

      workerTimer = setInterval(() => {
        runEnrichmentCycle().catch((error) => {
          logger.error('Enrichment worker cycle failed', { error: String(error) });
        });
      }, DEFAULT_INTERVAL_MS);

      // Kick once on startup.
      runEnrichmentCycle().catch((error) => {
        logger.error('Initial enrichment worker cycle failed', { error: String(error) });
      });

      logger.info('Enrichment worker started', {
        intervalMs: DEFAULT_INTERVAL_MS,
        batchSize: DEFAULT_BATCH_SIZE,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
      });
    } catch (error) {
      logger.error('Failed to bootstrap enrichment worker', { error: String(error) });
    } finally {
      workerBootstrapping = false;
    }
  })();
}

export function stopEnrichmentWorkers(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    logger.info('Enrichment worker stopped');
  }
}
