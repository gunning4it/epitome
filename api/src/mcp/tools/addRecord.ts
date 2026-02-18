/**
 * MCP Tool: add_record
 *
 * Insert a record into a table (auto-creates table/columns if needed)
 * Triggers async entity extraction (non-blocking)
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { createWriteId, ingestTableRecord, ingestMemoryText } from '@/services/writeIngestion.service';
import type { McpContext } from '../server.js';

interface AddRecordArgs {
  table?: string;
  tableName?: string; // deprecated alias (backward compatibility)
  data: Record<string, any>;
  tableDescription?: string;
}

export async function addRecord(args: AddRecordArgs, context: McpContext) {
  const { userId, agentId } = context;
  const table = args.table || args.tableName;
  if (!table) {
    throw new Error('INVALID_ARGS: add_record requires "table" (or legacy "tableName").');
  }
  const resource = `tables/${table}`;

  // Consent check
  await requireConsent(userId, agentId, resource, 'write');

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
  });

  // Auto-save record as searchable memory (best effort, non-blocking semantics)
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
  });

  return {
    success: true,
    table,
    recordId: ingested.recordId,
    sourceRef: ingested.sourceRef,
    writeId: ingested.writeId,
    writeStatus: ingested.writeStatus,
    jobId: ingested.jobId,
    message: 'Record added successfully',
  };
}
