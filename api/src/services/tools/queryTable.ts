// api/src/services/tools/queryTable.ts

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { queryTableRecords } from '@/mcp/serviceWrappers.js';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';
import { recordAccess } from '@/services/memoryQuality.service';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';
import type { ToolContext, ToolResult } from './types.js';

interface QueryTableArgs {
  table?: string;
  tableName?: string;
  filters?: Record<string, any>;
  sql?: string;
  limit?: number;
  offset?: number;
}

interface QueryTableData {
  table: string;
  recordCount: number;
  records: unknown[];
}

export async function queryTable(args: QueryTableArgs, context: ToolContext): Promise<ToolResult<QueryTableData>> {
  const { userId, agentId } = context;
  const table = args.table || args.tableName;

  if (!table) {
    return toolFailure(
      ToolErrorCode.INVALID_ARGS,
      'INVALID_ARGS: query_table requires "table" (or legacy "tableName").',
      false,
    );
  }

  const resource = `tables/${table}`;

  try {
    await requireConsent(userId, agentId, resource, 'read');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolFailure(
      message.startsWith('CONSENT_DENIED') ? ToolErrorCode.CONSENT_DENIED : ToolErrorCode.INTERNAL_ERROR,
      message,
      false,
    );
  }

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

  try {
    let records;

    if (args.sql) {
      const sqlResult = await executeSandboxedQuery(
        userId,
        args.sql,
        30,
        args.limit || 1000,
        { excludeSoftDeleted: true },
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

    return toolSuccess(
      {
        table,
        recordCount: Array.isArray(records) ? records.length : 0,
        records: Array.isArray(records) ? records : [],
      },
      `Found ${Array.isArray(records) ? records.length : 0} record(s) in ${table}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, message, true);
  }
}
