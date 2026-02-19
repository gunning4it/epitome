// api/src/services/tools/listTables.ts
import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { listTables as listTablesService } from '@/services/table.service';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';
import type { ToolContext, ToolResult } from './types.js';

interface ListTablesData {
  tables: Array<{
    name: string;
    description: string | undefined;
    columns: unknown[];
    recordCount: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export async function listTables(_args: unknown, context: ToolContext): Promise<ToolResult<ListTablesData>> {
  const { userId, agentId } = context;

  try {
    await requireConsent(userId, agentId, 'tables/*', 'read');
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
    action: 'mcp_list_tables',
    resource: 'tables/*',
    details: {},
  });

  try {
    const tables = await listTablesService(userId);

    return toolSuccess(
      {
        tables: tables.map((t) => ({
          name: t.tableName,
          description: t.description,
          columns: t.columns,
          recordCount: t.recordCount,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      },
      `Found ${tables.length} table(s)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, message, true);
  }
}
