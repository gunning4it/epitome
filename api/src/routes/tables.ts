/**
 * Table Routes
 *
 * Endpoints for dynamic table management
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import { requireAuth } from '@/middleware/auth';
import { expensiveOperationRateLimit } from '@/middleware/rateLimit';
import {
  listTables,
  queryRecords,
  updateRecord,
  deleteRecord,
} from '@/services/table.service';
import { ingestTableRecord } from '@/services/writeIngestion.service';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';
import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { recordAccess } from '@/services/memoryQuality.service';
import {
  tableNameSchema,
  tableRecordSchema,
  tableQuerySchema,
  tableRecordIdSchema,
} from '@/validators/api';

const tables = new Hono<HonoEnv>();

function extractDistinctMetaIds(rows: unknown[]): number[] {
  const ids = new Set<number>();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value = (row as Record<string, unknown>)._meta_id;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      ids.add(value);
      continue;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      ids.add(Number(value));
    }
  }

  return Array.from(ids);
}

/**
 * GET /v1/tables
 *
 * List all user tables
 */
tables.get('/', requireAuth, async (c) => {
  const userId = c.get('userId') as string;
  const agentId = c.get('agentId');
  const authType = c.get('authType');

  // Check consent for agent requests
  if (authType === 'api_key' && agentId) {
    await requireConsent(userId, agentId, 'tables', 'read');
  }

  // Get all tables
  const allTables = await listTables(userId);

  // Log audit entry
  await logAuditEntry(userId, {
    agentId: agentId || 'user',
    action: 'read',
    resource: 'tables',
    details: { count: allTables.length },
  });

  return c.json({
    data: allTables.map((t) => ({
      table_name: t.tableName,
      description: t.description,
      columns: t.columns,
      record_count: t.recordCount,
      created_at: t.createdAt.toISOString(),
      updated_at: t.updatedAt.toISOString(),
    })),
    meta: {
      total: allTables.length,
    },
  });
});

/**
 * POST /v1/tables/:name/records
 *
 * Insert record into table (auto-creates table/columns)
 */
tables.post(
  '/:name/records',
  requireAuth,
  zValidator('param', tableNameSchema),
  zValidator('json', tableRecordSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { name } = c.req.valid('param');
    const { body } = c.req.valid('json');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, `tables/${name}`, 'write');
    }

    // Determine origin
    const origin = authType === 'session' ? 'user_typed' : 'ai_inferred';
    const changedBy = authType === 'api_key' && agentId ? agentId : 'user';

    // Insert record
    const ingested = await ingestTableRecord({
      userId,
      tableName: name,
      data: body,
      changedBy,
      origin,
    });

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'write',
      resource: `tables/${name}`,
      details: {
        recordId: ingested.recordId,
        sourceRef: ingested.sourceRef,
        writeId: ingested.writeId,
        writeStatus: ingested.writeStatus,
        jobId: ingested.jobId,
        fields: Object.keys(body),
      },
    });

    return c.json(
      {
        data: {
          id: ingested.recordId,
          tableName: name,
          sourceRef: ingested.sourceRef,
          writeId: ingested.writeId,
          writeStatus: ingested.writeStatus,
          jobId: ingested.jobId,
        },
        meta: {},
      },
      201
    );
  }
);

/**
 * POST /v1/tables/:name/query
 *
 * Query table records (structured filters or SQL)
 * H-3 SECURITY: Expensive operation rate limited to 100 req/min
 */
tables.post(
  '/:name/query',
  requireAuth,
  expensiveOperationRateLimit, // H-3 Security Fix
  zValidator('param', tableNameSchema),
  zValidator('json', tableQuerySchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { name } = c.req.valid('param');
    const { body } = c.req.valid('json');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, `tables/${name}`, 'read');
    }

    let records;
    let executionTime = 0;

    if (body.sql) {
      // Execute SQL query via sandbox
      const result = await executeSandboxedQuery(userId, body.sql, 30, 10000, {
        excludeSoftDeleted: true,
      });
      records = result.rows;
      executionTime = result.executionTime;

      const metaIds = extractDistinctMetaIds(records);
      if (metaIds.length > 0) {
        await Promise.allSettled(metaIds.map((metaId) => recordAccess(userId, metaId)));
      }
    } else {
      // Use structured filters
      records = await queryRecords(
        userId,
        name,
        body.filters || {},
        body.limit || 100,
        body.offset || 0
      );
    }

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'query',
      resource: `tables/${name}`,
      details: {
        sql: !!body.sql,
        resultCount: records.length,
        executionTime,
      },
    });

    return c.json({
      data: records,
      meta: {
        total: records.length,
        executionTime,
      },
    });
  }
);

/**
 * PATCH /v1/tables/:name/records/:id
 *
 * Update table record
 */
tables.patch(
  '/:name/records/:id',
  requireAuth,
  zValidator('param', tableRecordIdSchema),
  zValidator('json', tableRecordSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { name, id } = c.req.valid('param');
    const { body } = c.req.valid('json');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, `tables/${name}`, 'write');
    }

    const origin = authType === 'session' ? 'user_typed' : 'ai_inferred';
    const changedBy = authType === 'api_key' && agentId ? agentId : 'user';

    // Update record
    const updated = await updateRecord(userId, name, id, body, changedBy, origin);

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'write',
      resource: `tables/${name}`,
      details: { recordId: id, updatedFields: Object.keys(body), origin },
    });

    return c.json({
      data: updated,
      meta: {},
    });
  }
);

/**
 * DELETE /v1/tables/:name/records/:id
 *
 * Soft delete table record
 */
tables.delete(
  '/:name/records/:id',
  requireAuth,
  zValidator('param', tableRecordIdSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const agentId = c.get('agentId');
    const authType = c.get('authType');
    const { name, id } = c.req.valid('param');

    // Check consent for agent requests
    if (authType === 'api_key' && agentId) {
      await requireConsent(userId, agentId, `tables/${name}`, 'write');
    }

    // Delete record
    await deleteRecord(userId, name, id);

    // Log audit entry
    await logAuditEntry(userId, {
      agentId: agentId || 'user',
      action: 'delete',
      resource: `tables/${name}`,
      details: { recordId: id },
    });

    return c.json({
      data: { success: true },
      meta: {},
    });
  }
);

export default tables;
