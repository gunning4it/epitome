/**
 * Memory Quality Service
 *
 * Confidence scoring, state machine, contradiction detection,
 * reinforcement mechanisms, and context budget ranking
 *
 * State Machine: UNVETTED → ACTIVE → TRUSTED
 *                             ↕
 *                   DECAYED   REVIEW
 *                             ↓
 *                         REJECTED
 */
import { withUserSchema, TransactionSql, sql } from '@/db/client';
import { logger } from '@/utils/logger';

const DEFAULT_DECAY_STALE_DAYS = Number(process.env.MEMORY_DECAY_STALE_DAYS || 90);
const DEFAULT_DECAY_CONFIDENCE_DELTA = Number(process.env.MEMORY_DECAY_CONFIDENCE_DELTA || 0.1);
const DEFAULT_DECAY_INTERVAL_MS = Number(
  process.env.MEMORY_DECAY_INTERVAL_MS || 24 * 60 * 60 * 1000
);

let decayTimer: ReturnType<typeof setInterval> | null = null;
let decayActive = false;
let decayLastRunAt: string | null = null;
let decayLastRunStatus: 'ok' | 'error' | null = null;
let decayLastRunMessage: string | null = null;



/**
 * Memory origin types with initial confidence scores
 */
export const ORIGIN_CONFIDENCE: Record<string, number> = {
  user_typed: 0.95, // Explicit input in dashboard
  user_stated: 0.85, // Direct statement to AI
  imported: 0.80, // From Google/Apple import
  ai_inferred: 0.40, // AI inferred from conversation
  ai_pattern: 0.30, // Statistical inference
  contradicted: 0.10, // Demoted by contradiction
};

/**
 * Memory lifecycle states
 */
export type MemoryStatus =
  | 'unvetted' // 0.3-0.5: New, low confidence
  | 'active' // 0.5-0.8: Corroborated, in use
  | 'trusted' // 0.8-1.0: User-confirmed or heavily corroborated
  | 'decayed' // 0.2-0.4: Not accessed for 90+ days
  | 'review' // 0.3: Contradicted, needs user review
  | 'rejected'; // 0.0: User rejected, hidden from agents

/**
 * Memory metadata entry
 */
export interface MemoryMeta {
  id: number;
  sourceType: string; // 'profile', 'vector', 'table_row', 'entity'
  sourceRef: string; // Reference to the source record
  origin: string; // Origin type (user_typed, ai_inferred, etc.)
  agentSource?: string; // Which agent created this
  confidence: number; // 0.0-1.0
  status: MemoryStatus;
  accessCount: number;
  lastAccessed?: Date;
  lastReinforced?: Date;
  contradictions: Contradiction[];
  promoteHistory: PromoteHistoryEntry[];
  createdAt: Date;
}

/**
 * Contradiction record
 */
export interface Contradiction {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  oldMetaId: number;
  newMetaId: number;
  agent: string;
  detectedAt: string;
  resolution: 'auto_newer_wins' | 'manual_review' | 'keep_both';
}

export interface ContradictionComparison {
  oldMetaId: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  agent?: string;
}

/**
 * Promote history entry
 */
export interface PromoteHistoryEntry {
  from: MemoryStatus;
  to: MemoryStatus;
  fromConfidence: number;
  toConfidence: number;
  reason: string;
  at: string;
}

/** Raw row from memory_meta queries */
interface MemoryMetaRow {
  id: number;
  source_type: string;
  source_ref: string;
  origin: string;
  agent_source: string | null;
  confidence: number;
  status: string;
  access_count: number;
  last_accessed: string | null;
  last_reinforced: string | null;
  contradictions: Contradiction[] | null;
  promote_history: PromoteHistoryEntry[] | null;
  created_at: string;
}

/** Raw row from memory stats aggregate query */
interface MemoryStatsRow {
  total_memories: number;
  avg_confidence: number;
  unvetted: number;
  active: number;
  trusted: number;
  decayed: number;
  review: number;
  rejected: number;
}

/**
 * Internal helper: Create memory metadata using provided transaction
 * Used by services that are already within a withUserSchema transaction
 */
export async function createMemoryMetaInternal(
  tx: TransactionSql,
  data: {
    sourceType: string;
    sourceRef: string;
    origin: string;
    agentSource?: string;
  }
): Promise<number> {
  // Determine initial confidence based on origin
  const confidence = ORIGIN_CONFIDENCE[data.origin] || 0.30;

  // Determine initial status based on confidence
  let status: MemoryStatus = 'unvetted';
  if (confidence >= 0.8) {
    status = 'trusted';
  } else if (confidence >= 0.5) {
    status = 'active';
  }

  const res: Array<{ id: number }> = await tx.unsafe(
    `
    INSERT INTO memory_meta (
      source_type,
      source_ref,
      origin,
      agent_source,
      confidence,
      status,
      access_count,
      contradictions,
      promote_history,
      created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, 0, '[]', '[]', NOW()
    )
    RETURNING id
  `,
    [
      data.sourceType,
      data.sourceRef,
      data.origin,
      data.agentSource || null,
      confidence,
      status,
    ]
  );

  return res[0].id;
}

/**
 * Create memory metadata entry
 *
 * @param userId - User ID for schema isolation
 * @param data - Memory metadata
 * @returns Created metadata ID
 */
export async function createMemoryMeta(
  userId: string,
  data: {
    sourceType: string;
    sourceRef: string;
    origin: string;
    agentSource?: string;
  }
): Promise<number> {
  const result = await withUserSchema(userId, async (tx) => {
    return createMemoryMetaInternal(tx, data);
  });

  return result;
}

/**
 * Record memory access
 *
 * Increments access count and updates last_accessed
 * Applies access-based reinforcement (+0.02, capped at +0.10 total)
 *
 * @param userId - User ID for schema isolation
 * @param metaId - Memory metadata ID
 */
export async function recordAccess(
  userId: string,
  metaId: number
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    await recordAccessInternal(tx, metaId);
  });
}

/**
 * Record memory access using an existing transaction.
 */
export async function recordAccessInternal(
  tx: TransactionSql,
  metaId: number
): Promise<void> {
  // Reinforcement: +0.02 per access, capped at +0.10 total from access
  await tx.unsafe(
    `
    UPDATE memory_meta
    SET
      access_count = access_count + 1,
      last_accessed = NOW(),
      confidence = LEAST(1.0, confidence + CASE WHEN access_count < 5 THEN 0.02 ELSE 0.0 END),
      status = CASE
        WHEN status IN ('review', 'rejected') THEN status
        WHEN LEAST(1.0, confidence + CASE WHEN access_count < 5 THEN 0.02 ELSE 0.0 END) >= 0.8 THEN 'trusted'
        WHEN LEAST(1.0, confidence + CASE WHEN access_count < 5 THEN 0.02 ELSE 0.0 END) >= 0.5 THEN 'active'
        WHEN LEAST(1.0, confidence + CASE WHEN access_count < 5 THEN 0.02 ELSE 0.0 END) < 0.3 THEN 'decayed'
        WHEN status = 'decayed' THEN 'unvetted'
        ELSE status
      END
    WHERE id = $1
  `,
    [metaId]
  );
}

/**
 * Record memory mention (repetition reinforcement)
 *
 * Applies +0.07 confidence boost per mention
 * Transitions UNVETTED → ACTIVE if mentioned 2+ times
 *
 * @param userId - User ID for schema isolation
 * @param metaId - Memory metadata ID
 */
export async function recordMention(
  userId: string,
  metaId: number
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    await recordMentionInternal(tx, metaId);
  });
}

/**
 * Record memory mention using an existing transaction.
 */
export async function recordMentionInternal(
  tx: TransactionSql,
  metaId: number
): Promise<void> {
  const current = await tx.unsafe<Array<{ confidence: number; status: MemoryStatus }>>(
    `
    SELECT confidence, status
    FROM memory_meta
    WHERE id = $1
  `,
    [metaId]
  );

  if (current.length === 0) return;

  const { confidence, status } = current[0];
  const newConfidence = Math.min(1.0, confidence + 0.07);
  let newStatus = status;

  if (status === 'decayed') {
    if (newConfidence >= 0.5) {
      newStatus = 'active';
    } else if (newConfidence >= 0.3) {
      newStatus = 'unvetted';
    }
  }

  if (status === 'unvetted' && newConfidence >= 0.5) {
    newStatus = 'active';
  }

  if ((status === 'active' || newStatus === 'active') && newConfidence >= 0.8) {
    newStatus = 'trusted';
  }

  await tx.unsafe(
    `
    UPDATE memory_meta
    SET
      confidence = $2::double precision,
      status = $3::text,
      last_reinforced = NOW(),
      promote_history = promote_history || jsonb_build_array(
        jsonb_build_object(
          'from', $4::text,
          'to', $3::text,
          'fromConfidence', $5::double precision,
          'toConfidence', $2::double precision,
          'reason', 'mentioned',
          'at', NOW()::text
        )
      )
    WHERE id = $1
  `,
    [metaId, newConfidence, newStatus, status, confidence]
  );
}

/**
 * Record contradiction between two memory_meta entries.
 * Applies demotion/review transitions and appends contradiction logs.
 */
export async function registerContradictionInternal(
  tx: TransactionSql,
  params: {
    oldMetaId: number;
    newMetaId: number;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    agent?: string;
  }
): Promise<Contradiction> {
  const pair = await tx.unsafe<
    Array<{ id: number; confidence: number; status: MemoryStatus; agent_source: string | null }>
  >(
    `
    SELECT id, confidence, status, agent_source
    FROM memory_meta
    WHERE id = ANY($1)
    ORDER BY id
  `,
    [[params.oldMetaId, params.newMetaId]]
  );

  const old = pair.find((row) => row.id === params.oldMetaId);
  const newer = pair.find((row) => row.id === params.newMetaId);

  if (!old || !newer) {
    throw new Error('NOT_FOUND: memory_meta entry missing for contradiction registration');
  }

  const confidenceGap = newer.confidence - old.confidence;
  let resolution: Contradiction['resolution'] = 'auto_newer_wins';

  if (old.confidence > 0.7 && newer.confidence > 0.7 && Math.abs(confidenceGap) < 0.3) {
    resolution = 'manual_review';
    await flagForReviewInternal(tx, old.id);
    await flagForReviewInternal(tx, newer.id);
  } else {
    await demoteMemoryInternal(tx, old.id, 'contradicted');
  }

  const contradiction: Contradiction = {
    field: params.field,
    oldValue: params.oldValue,
    newValue: params.newValue,
    oldMetaId: old.id,
    newMetaId: newer.id,
    agent: params.agent || newer.agent_source || old.agent_source || 'unknown',
    detectedAt: new Date().toISOString(),
    resolution,
  };

  await tx.unsafe(
    `
    UPDATE memory_meta
    SET contradictions = contradictions || $2::jsonb
    WHERE id = ANY($1)
  `,
    [[old.id, newer.id], JSON.stringify([contradiction])]
  );

  return contradiction;
}

/**
 * Register contradiction by user ID (wrapper).
 */
export async function registerContradiction(
  userId: string,
  params: {
    oldMetaId: number;
    newMetaId: number;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    agent?: string;
  }
): Promise<Contradiction> {
  return withUserSchema(userId, async (tx) => {
    return registerContradictionInternal(tx, params);
  });
}

/**
 * Detect contradictions using explicit field comparisons and register them.
 */
export async function detectContradictionsInternal(
  tx: TransactionSql,
  newMetaId: number,
  comparisons: ContradictionComparison[]
): Promise<Contradiction[]> {
  if (comparisons.length === 0) {
    return [];
  }

  const newMetaRows = await tx.unsafe<Array<{ id: number; agent_source: string | null }>>(
    `
    SELECT id, agent_source
    FROM memory_meta
    WHERE id = $1
    LIMIT 1
  `,
    [newMetaId]
  );

  if (newMetaRows.length === 0) {
    return [];
  }

  const fallbackAgent = newMetaRows[0].agent_source || undefined;
  const seen = new Set<string>();
  const contradictions: Contradiction[] = [];

  for (const comparison of comparisons) {
    if (!comparison.field || comparison.oldMetaId <= 0 || comparison.oldMetaId === newMetaId) {
      continue;
    }
    if (comparison.oldValue === undefined || comparison.newValue === undefined) {
      continue;
    }
    if (JSON.stringify(comparison.oldValue) === JSON.stringify(comparison.newValue)) {
      continue;
    }

    const dedupeKey = `${comparison.oldMetaId}:${newMetaId}:${comparison.field}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const contradiction = await registerContradictionInternal(tx, {
      oldMetaId: comparison.oldMetaId,
      newMetaId,
      field: comparison.field,
      oldValue: comparison.oldValue,
      newValue: comparison.newValue,
      agent: comparison.agent || fallbackAgent,
    });
    contradictions.push(contradiction);
  }

  return contradictions;
}

/**
 * Detect and handle contradictions
 *
 * Checks if new data contradicts existing high-confidence memories
 * Auto-resolves or flags for manual review based on confidence gap
 *
 * @param userId - User ID
 * @param newMetaId - New memory metadata ID
 * @param comparisonsOrField - Comparisons array (preferred) or legacy field string
 * @param newValue - Legacy new value for field mode
 * @returns Array of contradictions found
 */
export async function detectContradictions(
  userId: string,
  newMetaId: number,
  comparisons: ContradictionComparison[]
): Promise<Contradiction[]>;
export async function detectContradictions(
  userId: string,
  newMetaId: number,
  field: string,
  newValue: unknown
): Promise<Contradiction[]>;

export async function detectContradictions(
  userId: string,
  newMetaId: number,
  comparisonsOrField: ContradictionComparison[] | string,
  newValue?: unknown
): Promise<Contradiction[]> {
  return withUserSchema(userId, async (tx) => {
    if (Array.isArray(comparisonsOrField)) {
      return detectContradictionsInternal(tx, newMetaId, comparisonsOrField);
    }

    // Legacy compatibility mode: compare against older high-confidence entries with same source type.
    const field = comparisonsOrField;
    if (newValue === undefined) {
      return [];
    }

    const newMem = await tx.unsafe<Array<{
      source_type: string;
      source_ref: string;
      confidence: number;
      agent_source: string | null;
    }>>(
      `SELECT source_type, source_ref, confidence, agent_source FROM memory_meta WHERE id = $1`,
      [newMetaId]
    );

    if (newMem.length === 0) return [];

    const newSourceType = newMem[0].source_type;

    const existing = await tx.unsafe<Array<{ id: number; source_ref: string }>>(
      `
      SELECT id, source_ref
      FROM memory_meta
      WHERE source_type = $2
        AND status IN ('active', 'trusted')
        AND confidence > 0.5
        AND id != $1
      LIMIT 10
    `,
      [newMetaId, newSourceType]
    );

    const comparisons: ContradictionComparison[] = existing.map((old) => ({
      oldMetaId: old.id,
      field,
      oldValue: old.source_ref,
      newValue,
      agent: newMem[0].agent_source || undefined,
    }));

    return detectContradictionsInternal(tx, newMetaId, comparisons);
  });
}

async function demoteMemoryInternal(
  tx: TransactionSql,
  metaId: number,
  reason: string
): Promise<void> {
  await tx.unsafe(
    `
    UPDATE memory_meta
    SET
      confidence = GREATEST(0.1, confidence - 0.3),
      status = CASE
        WHEN status IN ('review', 'rejected') THEN status
        WHEN GREATEST(0.1, confidence - 0.3) >= 0.8 THEN 'trusted'
        WHEN GREATEST(0.1, confidence - 0.3) >= 0.5 THEN 'active'
        WHEN GREATEST(0.1, confidence - 0.3) < 0.3 THEN 'decayed'
        ELSE 'unvetted'
      END,
      promote_history = promote_history || jsonb_build_array(
        jsonb_build_object(
          'from', status,
          'to', CASE
            WHEN status IN ('review', 'rejected') THEN status
            WHEN GREATEST(0.1, confidence - 0.3) >= 0.8 THEN 'trusted'
            WHEN GREATEST(0.1, confidence - 0.3) >= 0.5 THEN 'active'
            WHEN GREATEST(0.1, confidence - 0.3) < 0.3 THEN 'decayed'
            ELSE 'unvetted'
          END,
          'fromConfidence', confidence,
          'toConfidence', GREATEST(0.1, confidence - 0.3),
          'reason', $2::text,
          'at', NOW()::text
        )
      )
    WHERE id = $1
  `,
    [metaId, reason]
  );
}

async function flagForReviewInternal(
  tx: TransactionSql,
  metaId: number
): Promise<void> {
  await tx.unsafe(
    `
    UPDATE memory_meta
    SET
      status = 'review',
      confidence = 0.3
    WHERE id = $1
  `,
    [metaId]
  );
}

/**
 * Get memories needing review
 *
 * Returns up to 5 contradicted memories flagged for manual review
 *
 * @param userId - User ID
 * @returns Array of memories needing review
 */
export async function getMemoriesNeedingReview(
  userId: string
): Promise<MemoryMeta[]> {
  return await withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe<MemoryMetaRow[]>(
      `
      SELECT
        id,
        source_type,
        source_ref,
        origin,
        agent_source,
        confidence,
        status,
        access_count,
        last_accessed,
        last_reinforced,
        contradictions,
        promote_history,
        created_at
      FROM memory_meta
      WHERE status = 'review'
      ORDER BY created_at DESC
      LIMIT 5
    `
    );

    return result.map((row) => ({
      id: row.id,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      origin: row.origin,
      agentSource: row.agent_source ?? undefined,
      confidence: row.confidence,
      status: row.status as MemoryStatus,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
      lastReinforced: row.last_reinforced ? new Date(row.last_reinforced) : undefined,
      contradictions: row.contradictions || [],
      promoteHistory: row.promote_history || [],
      createdAt: new Date(row.created_at),
    }));
  });
}

/**
 * Resolve reviewed memory
 *
 * User confirms or rejects a memory in review state
 *
 * @param userId - User ID
 * @param metaId - Memory metadata ID
 * @param action - 'confirm' | 'reject' | 'keep_both'
 */
export async function resolveReview(
  userId: string,
  metaId: number,
  action: 'confirm' | 'reject' | 'keep_both'
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    const existing = await tx.unsafe<Array<{ id: number; status: MemoryStatus }>>(
      `
      SELECT id, status
      FROM memory_meta
      WHERE id = $1
      LIMIT 1
    `,
      [metaId]
    );

    if (existing.length === 0 || existing[0].status !== 'review') {
      throw new Error('NOT_FOUND: Memory review item not found');
    }

    let updatedRows: Array<{ id: number }> = [];

    if (action === 'confirm') {
      // Move to TRUSTED with high confidence
      updatedRows = await tx.unsafe<Array<{ id: number }>>(
        `
        UPDATE memory_meta
        SET
          status = 'trusted',
          confidence = 0.95,
          promote_history = promote_history || jsonb_build_array(
            jsonb_build_object(
              'from', 'review',
              'to', 'trusted',
              'fromConfidence', confidence,
              'toConfidence', 0.95,
              'reason', 'user_confirmed',
              'at', NOW()::text
            )
          )
        WHERE id = $1
        RETURNING id
      `,
        [metaId]
      );
    } else if (action === 'reject') {
      // Move to REJECTED (hidden from agents)
      updatedRows = await tx.unsafe<Array<{ id: number }>>(
        `
        UPDATE memory_meta
        SET
          status = 'rejected',
          confidence = 0.0,
          promote_history = promote_history || jsonb_build_array(
            jsonb_build_object(
              'from', 'review',
              'to', 'rejected',
              'fromConfidence', confidence,
              'toConfidence', 0.0,
              'reason', 'user_rejected',
              'at', NOW()::text
            )
          )
        WHERE id = $1
        RETURNING id
      `,
        [metaId]
      );
    } else if (action === 'keep_both') {
      // Move to ACTIVE with moderate confidence
      updatedRows = await tx.unsafe<Array<{ id: number }>>(
        `
        UPDATE memory_meta
        SET
          status = 'active',
          confidence = 0.65,
          promote_history = promote_history || jsonb_build_array(
            jsonb_build_object(
              'from', 'review',
              'to', 'active',
              'fromConfidence', confidence,
              'toConfidence', 0.65,
              'reason', 'user_kept_both',
              'at', NOW()::text
            )
          )
        WHERE id = $1
        RETURNING id
      `,
        [metaId]
      );
    }

    if (updatedRows.length === 0) {
      throw new Error('NOT_FOUND: Memory review item not found');
    }
  });
}

/**
 * Calculate context budget ranking score
 *
 * Used by get_user_context to select most relevant memories
 *
 * score = relevance × confidence × recency_boost × frequency_factor
 *
 * @param relevance - Cosine similarity (0-1)
 * @param confidence - Memory confidence (0-1)
 * @param daysSinceAccess - Days since last access
 * @param accessCount - Total access count
 * @param maxAccessCount - Max access count across all memories
 * @returns Composite ranking score
 */
export function calculateContextScore(
  relevance: number,
  confidence: number,
  daysSinceAccess: number,
  accessCount: number,
  maxAccessCount: number
): number {
  // Recency boost: recent accesses get higher score
  const recencyBoost = 1.0 + 0.5 * Math.exp(-daysSinceAccess / 30);

  // Frequency factor: logarithmic scaling
  const frequencyFactor =
    Math.log(accessCount + 1) / Math.log(maxAccessCount + 1 || 1);

  return relevance * confidence * recencyBoost * frequencyFactor;
}

export interface MemoryDecayResult {
  userId: string;
  decayedCount: number;
}

export interface MemoryDecayStatus {
  enabled: boolean;
  mode: 'app' | 'disabled';
  intervalMs: number;
  active: boolean;
  lastRunAt: string | null;
  lastRunStatus: 'ok' | 'error' | null;
  lastRunMessage: string | null;
}

/**
 * Decay stale memories for a single user.
 *
 * Moves stale low-signal memories toward lower confidence and "decayed" status.
 * Excludes rejected/review memories and explicit user-stated memories.
 */
export async function applyDecay(
  userId: string,
  options: {
    staleDays?: number;
    confidenceDelta?: number;
  } = {}
): Promise<MemoryDecayResult> {
  const staleDays = Math.max(1, options.staleDays ?? DEFAULT_DECAY_STALE_DAYS);
  const confidenceDelta = Math.max(
    0.01,
    Math.min(0.5, options.confidenceDelta ?? DEFAULT_DECAY_CONFIDENCE_DELTA)
  );

  return withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe<Array<{ id: number }>>(
      `
      UPDATE memory_meta
      SET
        confidence = GREATEST(0.1, confidence - $1),
        status = CASE
          WHEN confidence - $1 < 0.3 THEN 'decayed'
          ELSE status
        END,
        promote_history = promote_history || jsonb_build_array(
          jsonb_build_object(
            'from', status,
            'to', CASE WHEN confidence - $1 < 0.3 THEN 'decayed' ELSE status END,
            'fromConfidence', confidence,
            'toConfidence', GREATEST(0.1, confidence - $1),
            'reason', 'stale_decay',
            'at', NOW()::text
          )
        )
      WHERE status IN ('unvetted', 'active', 'trusted', 'decayed')
        AND origin != 'user_stated'
        AND (
          last_accessed IS NULL
          OR last_accessed < NOW() - ($2::text || ' days')::interval
        )
      RETURNING id
    `,
      [confidenceDelta, staleDays]
    );

    return {
      userId,
      decayedCount: result.length,
    };
  });
}

/**
 * Run one memory decay cycle across all users.
 */
export async function runMemoryDecayCycle(): Promise<{
  usersProcessed: number;
  memoriesDecayed: number;
}> {
  if (decayActive) {
    return { usersProcessed: 0, memoriesDecayed: 0 };
  }

  decayActive = true;
  let usersProcessed = 0;
  let memoriesDecayed = 0;

  try {
    const users = await sql.unsafe<Array<{ id: string }>>(
      `SELECT id::text FROM public.users ORDER BY created_at ASC`
    );

    for (const user of users) {
      const res = await applyDecay(user.id);
      usersProcessed++;
      memoriesDecayed += res.decayedCount;
    }

    decayLastRunAt = new Date().toISOString();
    decayLastRunStatus = 'ok';
    decayLastRunMessage = `Processed ${usersProcessed} users, decayed ${memoriesDecayed} memories`;

    if (memoriesDecayed > 0) {
      logger.info('Memory decay cycle completed', {
        usersProcessed,
        memoriesDecayed,
      });
    }

    return { usersProcessed, memoriesDecayed };
  } catch (error) {
    decayLastRunAt = new Date().toISOString();
    decayLastRunStatus = 'error';
    decayLastRunMessage = error instanceof Error ? error.message : String(error);
    logger.error('Memory decay cycle failed', { error: decayLastRunMessage });
    throw error;
  } finally {
    decayActive = false;
  }
}

/**
 * Start periodic memory decay in app process.
 */
export function startMemoryDecayScheduler(): void {
  if (process.env.ENABLE_MEMORY_DECAY !== 'true') {
    return;
  }

  if (decayTimer) return;

  decayTimer = setInterval(() => {
    runMemoryDecayCycle().catch((error) => {
      logger.error('Scheduled memory decay cycle failed', { error: String(error) });
    });
  }, DEFAULT_DECAY_INTERVAL_MS);

  // Kick off one cycle on startup.
  runMemoryDecayCycle().catch((error) => {
    logger.error('Initial memory decay cycle failed', { error: String(error) });
  });

  logger.info('Memory decay scheduler started', {
    intervalMs: DEFAULT_DECAY_INTERVAL_MS,
    staleDays: DEFAULT_DECAY_STALE_DAYS,
    confidenceDelta: DEFAULT_DECAY_CONFIDENCE_DELTA,
  });
}

/**
 * Stop periodic memory decay.
 */
export function stopMemoryDecayScheduler(): void {
  if (!decayTimer) return;
  clearInterval(decayTimer);
  decayTimer = null;
  logger.info('Memory decay scheduler stopped');
}

/**
 * Get current memory decay scheduler status.
 */
export function getMemoryDecayStatus(): MemoryDecayStatus {
  const enabled = process.env.ENABLE_MEMORY_DECAY === 'true';
  return {
    enabled,
    mode: enabled ? 'app' : 'disabled',
    intervalMs: DEFAULT_DECAY_INTERVAL_MS,
    active: decayActive,
    lastRunAt: decayLastRunAt,
    lastRunStatus: decayLastRunStatus,
    lastRunMessage: decayLastRunMessage,
  };
}

/**
 * Get memory quality statistics
 *
 * Returns aggregate statistics about memory quality
 *
 * @param userId - User ID
 * @returns Quality statistics
 */
export async function getMemoryQualityStats(
  userId: string
): Promise<{
  totalMemories: number;
  avgConfidence: number;
  statusBreakdown: Record<MemoryStatus, number>;
  needingReview: number;
}> {
  return await withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe<MemoryStatsRow[]>(
      `
      SELECT
        COUNT(*)::int as total_memories,
        AVG(confidence)::float as avg_confidence,
        COUNT(*) FILTER (WHERE status = 'unvetted')::int as unvetted,
        COUNT(*) FILTER (WHERE status = 'active')::int as active,
        COUNT(*) FILTER (WHERE status = 'trusted')::int as trusted,
        COUNT(*) FILTER (WHERE status = 'decayed')::int as decayed,
        COUNT(*) FILTER (WHERE status = 'review')::int as review,
        COUNT(*) FILTER (WHERE status = 'rejected')::int as rejected
      FROM memory_meta
      WHERE status != 'rejected'
    `
    );

    const row = result[0];

    return {
      totalMemories: row?.total_memories || 0,
      avgConfidence: row?.avg_confidence || 0,
      statusBreakdown: {
        unvetted: row?.unvetted || 0,
        active: row?.active || 0,
        trusted: row?.trusted || 0,
        decayed: row?.decayed || 0,
        review: row?.review || 0,
        rejected: row?.rejected || 0,
      },
      needingReview: row?.review || 0,
    };
  });
}
