// api/src/services/tools/addRecord.ts

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { createWriteId, ingestTableRecord, ingestMemoryText } from '@/services/writeIngestion.service';
import { logger } from '@/utils/logger';
import type { ToolContext, ToolResult } from './types.js';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';

interface AddRecordArgs {
  table?: string;
  tableName?: string;
  data: Record<string, any>;
  tableDescription?: string;
}

export async function addRecord(
  args: AddRecordArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { userId, agentId } = ctx;
  const table = args.table || args.tableName;

  if (!table) {
    return toolFailure(
      ToolErrorCode.INVALID_ARGS,
      'INVALID_ARGS: add_record requires "table" (or legacy "tableName").',
      false,
    );
  }

  const resource = `tables/${table}`;

  // Consent check
  try {
    await requireConsent(userId, agentId, resource, 'write');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('CONSENT_DENIED')) {
      return toolFailure(ToolErrorCode.CONSENT_DENIED, msg, false);
    }
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
  }

  try {
    // Audit log
    await logAuditEntry(userId, {
      agentId,
      action: 'mcp_add_record',
      resource,
      details: {
        tableDescription: args.tableDescription,
        fields: Object.keys(args.data),
      },
    });

    // Add record
    const writeId = createWriteId();
    const ingested = await ingestTableRecord({
      userId,
      tableName: table,
      data: args.data,
      changedBy: agentId,
      origin: 'ai_stated',
      tableDescription: args.tableDescription,
      writeId,
      tier: ctx.tier,
    });

    // Auto-save record as searchable memory (best effort, non-blocking)
    const recordText = Object.entries(args.data)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');
    const memoryText = `${table}: ${recordText}`;

    void ingestMemoryText({
      userId,
      collection: table,
      text: memoryText,
      metadata: {
        source: 'add_record',
        agent: agentId,
        table,
        record_id: ingested.recordId,
      },
      changedBy: agentId,
      origin: 'ai_stated',
      sourceRefHint: `${table}:${ingested.recordId}:summary`,
      writeId,
      tier: ctx.tier,
    }).catch((err) =>
      logger.warn('Record auto-vectorize failed', { error: String(err) })
    );

    return toolSuccess(
      {
        success: true,
        table,
        recordId: ingested.recordId,
        sourceRef: ingested.sourceRef,
        writeId: ingested.writeId,
        writeStatus: ingested.writeStatus,
        jobId: ingested.jobId,
        message: 'Record added successfully',
      },
      'Record added successfully',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('addRecord service error', { error: msg, userId });
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
  }
}
