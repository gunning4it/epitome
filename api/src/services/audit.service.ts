/**
 * Audit Service
 *
 * Immutable append-only logging of all agent actions
 * Records reads, writes, queries, and permission checks
 *
 * Features:
 * - Monthly partitioning for performance
 * - Agent activity tracking
 * - Query history
 * - Immutable audit trail (no updates/deletes)
 */

import { withUserSchema } from '@/db/client';
import { sql as _sql } from 'drizzle-orm';

/**
 * Audit log entry details
 */
export interface AuditLogEntry {
  agentId: string;
  agentName?: string;
  action: string; // 'read', 'write', 'query', 'delete', 'consent_check'
  resource: string; // 'profile', 'tables/meals', 'vectors/journal', 'graph/entities'
  details?: Record<string, unknown>; // Additional context (query text, record IDs, etc.)
}

export type WritePipelineStage =
  | 'profile_written'
  | 'table_written'
  | 'vector_written'
  | 'vector_pending'
  | 'enrichment_queued'
  | 'enrichment_done'
  | 'enrichment_failed';

export interface WritePipelineLogEntry {
  agentId: string;
  resource: string;
  writeId: string;
  stage: WritePipelineStage;
  sourceRef?: string;
  jobId?: number;
  metaId?: number;
  vectorId?: number;
  writeStatus?: string;
  latencyMs?: number;
  error?: string;
  extra?: Record<string, unknown>;
}

/**
 * Audit log query filters
 */
export interface AuditLogFilters {
  agentId?: string;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Audit log result
 */
export interface AuditLogResult {
  id: string;
  agentId: string;
  agentName: string | null;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

/** Raw row from audit_log queries */
interface AuditLogRow {
  id: string;
  agent_id: string;
  agent_name: string | null;
  action: string;
  resource: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** Raw row from resource activity aggregate */
interface ResourceActivityRow {
  resource_type: string;
  count: number;
}

/**
 * Create audit log entry
 *
 * Logs an action to the immutable audit trail
 *
 * @param userId - User ID for schema isolation
 * @param entry - Audit log entry data
 */
export async function logAuditEntry(
  userId: string,
  entry: AuditLogEntry
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    // Insert into audit_log table
    // Note: We use raw SQL here because audit_log is in user schema
    // and not defined in the Drizzle schema (it's dynamic per user)
    await tx.unsafe(
      `
      INSERT INTO audit_log (
        agent_id,
        agent_name,
        action,
        resource,
        details,
        created_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        NOW()
      )
    `,
      [
        entry.agentId,
        entry.agentName || null,
        entry.action,
        entry.resource,
        JSON.stringify(entry.details || {}),
      ]
    );
  });
}

/**
 * Emit a write pipeline lifecycle event.
 *
 * These events allow the dashboard to show async write fan-out progress
 * (profile write -> vector write -> enrichment queue -> enrichment done/failed).
 */
export async function logWritePipelineStage(
  userId: string,
  entry: WritePipelineLogEntry
): Promise<void> {
  await logAuditEntry(userId, {
    agentId: entry.agentId,
    action: 'write_pipeline',
    resource: entry.resource,
    details: {
      pipeline: {
        writeId: entry.writeId,
        stage: entry.stage,
        sourceRef: entry.sourceRef ?? null,
        jobId: entry.jobId ?? null,
        metaId: entry.metaId ?? null,
        vectorId: entry.vectorId ?? null,
        writeStatus: entry.writeStatus ?? null,
        latencyMs: entry.latencyMs ?? null,
        error: entry.error ?? null,
      },
      ...(entry.extra || {}),
    },
  });
}

/**
 * Query audit log
 *
 * Retrieves audit log entries with optional filtering
 *
 * @param userId - User ID for schema isolation
 * @param filters - Optional filters for the query
 * @returns Array of audit log entries
 */
export async function queryAuditLog(
  userId: string,
  filters: AuditLogFilters = {}
): Promise<AuditLogResult[]> {
  return await withUserSchema(userId, async (tx) => {
    const {
      agentId,
      action,
      resource,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
    } = filters;

    // Build WHERE clauses
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (agentId) {
      conditions.push(`agent_id = $${paramIndex}`);
      params.push(agentId);
      paramIndex++;
    }

    if (action) {
      conditions.push(`action = $${paramIndex}`);
      params.push(action);
      paramIndex++;
    }

    if (resource) {
      conditions.push(`resource LIKE $${paramIndex}`);
      params.push(`${resource}%`);
      paramIndex++;
    }

    if (startDate) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(startDate.toISOString());
      paramIndex++;
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(endDate.toISOString());
      paramIndex++;
    }

    // Add limit and offset
    params.push(limit);
    const limitParam = paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex;

    // Execute query
    const result = await tx.unsafe<AuditLogRow[]>(
      `
      SELECT
        id::text,
        agent_id,
        agent_name,
        action,
        resource,
        details,
        created_at
      FROM audit_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `,
      params as unknown[]
    );

    return result.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      action: row.action,
      resource: row.resource,
      details: row.details || {},
      createdAt: new Date(row.created_at),
    }));
  });
}

/**
 * Get agent activity summary
 *
 * Returns aggregated statistics for an agent's activity
 *
 * @param userId - User ID for schema isolation
 * @param agentId - Agent ID to summarize
 * @param days - Number of days to look back (default 30)
 * @returns Activity summary
 */
export async function getAgentActivitySummary(
  userId: string,
  agentId: string,
  days: number = 30
): Promise<{
  totalActions: number;
  readCount: number;
  writeCount: number;
  queryCount: number;
  recentResources: string[];
  firstSeen: Date | null;
  lastSeen: Date | null;
}> {
  return await withUserSchema(userId, async (tx) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await tx.unsafe(
      `
      SELECT
        COUNT(*)::int as total_actions,
        COUNT(*) FILTER (WHERE action = 'read')::int as read_count,
        COUNT(*) FILTER (WHERE action = 'write')::int as write_count,
        COUNT(*) FILTER (WHERE action = 'query')::int as query_count,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen,
        ARRAY(
          SELECT DISTINCT resource
          FROM audit_log
          WHERE agent_id = $1
            AND created_at >= $2
          ORDER BY resource
          LIMIT 10
        ) as recent_resources
      FROM audit_log
      WHERE agent_id = $1
        AND created_at >= $2
    `,
      [agentId, startDate.toISOString()]
    );

    const row = result[0];

    return {
      totalActions: row?.total_actions || 0,
      readCount: row?.read_count || 0,
      writeCount: row?.write_count || 0,
      queryCount: row?.query_count || 0,
      recentResources: row?.recent_resources || [],
      firstSeen: row?.first_seen ? new Date(row.first_seen) : null,
      lastSeen: row?.last_seen ? new Date(row.last_seen) : null,
    };
  });
}

/**
 * Get activity breakdown by resource type
 *
 * Returns counts of actions grouped by resource type
 *
 * @param userId - User ID for schema isolation
 * @param days - Number of days to look back (default 30)
 * @returns Resource activity breakdown
 */
export async function getResourceActivityBreakdown(
  userId: string,
  days: number = 30
): Promise<Array<{ resource: string; count: number }>> {
  return await withUserSchema(userId, async (tx) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await tx.unsafe<ResourceActivityRow[]>(
      `
      SELECT
        SPLIT_PART(resource, '/', 1) as resource_type,
        COUNT(*)::int as count
      FROM audit_log
      WHERE created_at >= $1
      GROUP BY resource_type
      ORDER BY count DESC
      LIMIT 20
    `,
      [startDate.toISOString()]
    );

    return result.map((row) => ({
      resource: row.resource_type,
      count: row.count,
    }));
  });
}

/**
 * Cleanup old audit logs
 *
 * Deletes audit logs older than the retention period
 * (Typically called by a cron job, respects tier limits)
 *
 * @param userId - User ID for schema isolation
 * @param retentionDays - Number of days to retain (default 30 for free tier)
 * @returns Number of deleted rows
 */
export async function cleanupOldAuditLogs(
  userId: string,
  retentionDays: number = 30
): Promise<number> {
  return await withUserSchema(userId, async (tx) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await tx.unsafe(
      `
      DELETE FROM audit_log
      WHERE created_at < $1
      RETURNING id
    `,
      [cutoffDate.toISOString()]
    );

    return result.length;
  });
}
