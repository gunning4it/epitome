/**
 * MCP Tool: list_tables
 *
 * List all user tables with metadata
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { listTables as listTablesService } from '@/services/table.service';
import type { McpContext } from '../server.js';

export async function listTables(_args: unknown, context: McpContext) {
  const { userId, agentId } = context;

  // Consent check
  await requireConsent(userId, agentId, 'tables/*', 'read');

  // Audit log
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_list_tables',
    resource: 'tables/*',
    details: {},
  });

  // Get table list
  const tables = await listTablesService(userId);

  return {
    tables: tables.map((t) => ({
      name: t.tableName,
      description: t.description,
      columns: t.columns,
      recordCount: t.recordCount,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
}
