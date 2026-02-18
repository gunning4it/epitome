/**
 * MCP Tool: query_table
 *
 * Query table records with structured filters or SQL
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { queryTableRecords } from '../serviceWrappers.js';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';
import { recordAccess } from '@/services/memoryQuality.service';
import type { McpContext } from '../server.js';

interface QueryTableArgs {
  table?: string;
  tableName?: string; // deprecated alias (backward compatibility)
  filters?: Record<string, any>;
  sql?: string;
  limit?: number;
  offset?: number;
}

export async function queryTable(args: QueryTableArgs, context: McpContext) {
  const { userId, agentId } = context;
  const table = args.table || args.tableName;
  if (!table) {
    throw new Error('INVALID_ARGS: query_table requires "table" (or legacy "tableName").');
  }
  const resource = `tables/${table}`;

  // Consent check
  await requireConsent(userId, agentId, resource, 'read');

  // Audit log
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_query_table',
    resource,
    details: {
      filters: args.filters,
      sql: args.sql,
      limit: args.limit,
      offset: args.offset,
    },
  });

  let records;

  const extractDistinctMetaIds = (rows: unknown[]): number[] => {
    const ids = new Set<number>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const value = (row as Record<string, unknown>)._meta_id;
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        ids.add(value);
      } else if (typeof value === 'string' && /^\d+$/.test(value)) {
        ids.add(Number(value));
      }
    }
    return Array.from(ids);
  };

  // Use SQL if provided, otherwise use structured filters
  if (args.sql) {
    const sqlResult = await executeSandboxedQuery(
      userId,
      args.sql,
      30,
      args.limit || 1000,
      { excludeSoftDeleted: true }
    );
    records = sqlResult.rows;

    const metaIds = extractDistinctMetaIds(records);
    if (metaIds.length > 0) {
      await Promise.allSettled(metaIds.map((metaId) => recordAccess(userId, metaId)));
    }
  } else {
    records = await queryTableRecords(userId, table, {
      filters: args.filters,
      limit: args.limit || 50,
      offset: args.offset || 0,
    });
  }

  return {
    table,
    recordCount: Array.isArray(records) ? records.length : 0,
    records: Array.isArray(records) ? records : [],
  };
}
