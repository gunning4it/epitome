/**
 * Table Service
 *
 * Dynamic table management with auto-creation and auto-extension
 *
 * Features:
 * - Auto-create tables on first write
 * - Auto-add columns when new fields detected
 * - Type inference (string→VARCHAR, number→INTEGER/REAL, boolean→BOOLEAN)
 * - Integration with SQL Sandbox
 * - Table registry metadata
 */

import { withUserSchema, TransactionSql } from '@/db/client';
import { validateTableName, validateColumnName, escapeIdentifier } from './sqlSandbox.service';
import {
  createMemoryMetaInternal,
  recordAccessInternal,
  recordMentionInternal,
  detectContradictionsInternal,
} from './memoryQuality.service';

// L-6 SECURITY FIX: Tables protected from write operations via CRUD endpoints
const WRITE_PROTECTED_TABLES = new Set([
  'audit_log',
  '_table_registry',
  '_memory_meta',
]);

/**
 * Check if a table is write-protected (system/audit tables).
 * Throws if the table cannot be modified through CRUD endpoints.
 */
function assertWritable(tableName: string): void {
  if (WRITE_PROTECTED_TABLES.has(tableName)) {
    throw new Error(`FORBIDDEN: Table '${tableName}' is write-protected and cannot be modified through this endpoint`);
  }
}

/**
 * Table metadata
 */
export interface TableMetadata {
  tableName: string;
  description?: string;
  columns: ColumnMetadata[];
  recordCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Column metadata
 */
export interface ColumnMetadata {
  name: string;
  type: string; // 'VARCHAR', 'INTEGER', 'REAL', 'BOOLEAN', 'TIMESTAMPTZ', 'JSONB'
  nullable: boolean;
}

/**
 * Table record
 */
export interface TableRecord {
  id: number;
  [key: string]: unknown;
  created_at?: Date;
  updated_at?: Date;
  _deleted_at?: Date | null;
  _meta_id?: number;
}

/**
 * Infer SQL type from JavaScript value
 *
 * @param value - Value to infer type from
 * @returns SQL type string
 */
function inferSqlType(value: unknown): string {
  if (value === null || value === undefined) {
    return 'VARCHAR(500)'; // Default for null values
  }

  if (typeof value === 'boolean') {
    return 'BOOLEAN';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  }

  if (typeof value === 'string') {
    return 'VARCHAR(500)';
  }

  if (value instanceof Date) {
    return 'TIMESTAMPTZ';
  }

  if (typeof value === 'object') {
    return 'JSONB';
  }

  return 'TEXT'; // Fallback
}

/**
 * Check if table exists
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name to check
 * @returns True if table exists
 */
export async function tableExists(
  userId: string,
  tableName: string
): Promise<boolean> {
  validateTableName(tableName);

  const result = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe(
      `
      SELECT EXISTS (
        SELECT 1
        FROM _table_registry
        WHERE table_name = $1
      ) as exists
    `,
      [tableName]
    );

    return rows[0]?.exists || false;
  });

  return result;
}

/**
 * Create table
 *
 * Creates a new user table with standard columns
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name to create
 * @param description - Optional table description
 * @param initialColumns - Optional initial columns
 */
export async function createTable(
  userId: string,
  tableName: string,
  description?: string,
  initialColumns: ColumnMetadata[] = []
): Promise<void> {
  validateTableName(tableName);

  await withUserSchema(userId, async (tx) => {
    // Build column definitions
    const columnDefs = initialColumns
      .map((col) => {
        validateColumnName(col.name);
        const nullable = col.nullable ? '' : 'NOT NULL';
        return `${escapeIdentifier(col.name)} ${col.type} ${nullable}`;
      })
      .join(',\n  ');

    // Create table with standard columns
    const createTableSql = `
      CREATE TABLE ${escapeIdentifier(tableName)} (
        id SERIAL PRIMARY KEY,
        ${columnDefs ? columnDefs + ',' : ''}
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        _deleted_at TIMESTAMPTZ,
        _meta_id INTEGER REFERENCES memory_meta(id)
      )
    `;

    await tx.unsafe(createTableSql);

    // Create index on _deleted_at for soft delete queries
    await tx.unsafe(
      `CREATE INDEX ${escapeIdentifier(`idx_${tableName}_deleted`)}
       ON ${escapeIdentifier(tableName)}(_deleted_at)
       WHERE _deleted_at IS NULL`
    );

    // Register table in _table_registry
    await tx.unsafe(
      `
      INSERT INTO _table_registry (
        table_name,
        description,
        columns,
        record_count,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, 0, NOW(), NOW()
      )
    `,
      [
        tableName,
        description || null,
        JSON.stringify(
          initialColumns.concat([
            { name: 'id', type: 'SERIAL', nullable: false },
            { name: 'created_at', type: 'TIMESTAMPTZ', nullable: false },
            { name: 'updated_at', type: 'TIMESTAMPTZ', nullable: false },
            { name: '_deleted_at', type: 'TIMESTAMPTZ', nullable: true },
            { name: '_meta_id', type: 'INTEGER', nullable: true },
          ])
        ),
      ]
    );
  });
}

/**
 * Add column to existing table
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name
 * @param columnName - Column name to add
 * @param columnType - SQL type for the column
 */
async function addColumn(
  tableName: string,
  columnName: string,
  columnType: string,
  tx: TransactionSql
): Promise<void> {
  validateTableName(tableName);
  validateColumnName(columnName);

  // Add column to table
  await tx.unsafe(
    `ALTER TABLE ${escapeIdentifier(tableName)}
     ADD COLUMN ${escapeIdentifier(columnName)} ${columnType}`
  );

  // Update _table_registry
  // Note: ::text casts required because jsonb_build_object() is VARIADIC "any"
  // and PostgreSQL can't infer parameter types from variadic functions (error 42P18)
  await tx.unsafe(
    `
    UPDATE _table_registry
    SET
      columns = columns || jsonb_build_array(
        jsonb_build_object(
          'name', $2::text,
          'type', $3::text,
          'nullable', true
        )
      ),
      updated_at = NOW()
    WHERE table_name = $1
  `,
    [tableName, columnName, columnType]
  );
}

/**
 * Insert record into table
 *
 * Auto-creates table and columns if they don't exist
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name
 * @param data - Record data
 * @param changedBy - Who created the record
 * @param origin - Origin for memory quality
 * @returns Inserted record ID
 */
export async function insertRecord(
  userId: string,
  tableName: string,
  data: Record<string, unknown>,
  changedBy: string = 'user',
  origin: string = 'user_typed',
  tableDescription?: string
): Promise<number> {
  validateTableName(tableName);
  assertWritable(tableName);

  return await withUserSchema(userId, async (tx) => {
    // Check if table exists - need to do this check within the transaction
    const rows = await tx.unsafe(
      `
      SELECT EXISTS (
        SELECT 1
        FROM _table_registry
        WHERE table_name = $1
      ) as exists
    `,
      [tableName]
    );
    const exists = rows[0]?.exists || false;

    if (!exists) {
      // Auto-create table with inferred columns
      const columns = Object.entries(data).map(([name, value]) => ({
        name,
        type: inferSqlType(value),
        nullable: true,
      }));

      // Build column definitions
      const columnDefs = columns
        .map((col) => {
          validateColumnName(col.name);
          const nullable = col.nullable ? '' : 'NOT NULL';
          return `${escapeIdentifier(col.name)} ${col.type} ${nullable}`;
        })
        .join(',\n  ');

      // Create table with standard columns
      const createTableSql = `
        CREATE TABLE ${escapeIdentifier(tableName)} (
          id SERIAL PRIMARY KEY,
          ${columnDefs ? columnDefs + ',' : ''}
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          _deleted_at TIMESTAMPTZ,
          _meta_id INTEGER REFERENCES memory_meta(id)
        )
      `;

      await tx.unsafe(createTableSql);

      // Create index on _deleted_at for soft delete queries
      await tx.unsafe(
        `CREATE INDEX ${escapeIdentifier(`idx_${tableName}_deleted`)}
         ON ${escapeIdentifier(tableName)}(_deleted_at)
         WHERE _deleted_at IS NULL`
      );

      // Register table in _table_registry
      await tx.unsafe(
        `
        INSERT INTO _table_registry (
          table_name,
          description,
          columns,
          record_count,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, 0, NOW(), NOW()
        )
      `,
        [
          tableName,
          tableDescription || null,
          JSON.stringify(
            columns.concat([
              { name: 'id', type: 'SERIAL', nullable: false },
              { name: 'created_at', type: 'TIMESTAMPTZ', nullable: false },
              { name: 'updated_at', type: 'TIMESTAMPTZ', nullable: false },
              { name: '_deleted_at', type: 'TIMESTAMPTZ', nullable: true },
              { name: '_meta_id', type: 'INTEGER', nullable: true },
            ])
          ),
        ]
      );
    } else {
      // Check for new columns
      const existingCols = await getTableColumns(tx, tableName);
      const existingNames = existingCols.map((c) => c.name);

      for (const [colName, value] of Object.entries(data)) {
        if (!existingNames.includes(colName)) {
          // Auto-add column
          await addColumn(tableName, colName, inferSqlType(value), tx);
        }
      }
    }

    // Create memory metadata
    const metaId = await createMemoryMetaInternal(tx, {
      sourceType: 'table',
      sourceRef: `${tableName}:pending`,
      origin,
      agentSource: changedBy !== 'user' ? changedBy : undefined,
    });

    // Build INSERT statement
    const columnNames = Object.keys(data);
    const columnsList = columnNames.map((name) => escapeIdentifier(name)).join(', ');
    const valuesList = columnNames.map((_, i) => `$${i + 1}`).join(', ');
    const values = columnNames.map((name) => {
      const v = data[name];
      // tx.unsafe() doesn't auto-serialize JSONB — stringify objects manually
      return (v !== null && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    });

    const insertSql = `
      INSERT INTO ${escapeIdentifier(tableName)} (
        ${columnsList},
        _meta_id,
        created_at,
        updated_at
      ) VALUES (
        ${valuesList},
        $${values.length + 1},
        NOW(),
        NOW()
      )
      RETURNING id
    `;

    const result = await tx.unsafe(insertSql, [...values, metaId]);
    const insertedId = result[0].id as number;

    // Backfill source_ref with stable record reference.
    await tx.unsafe(
      `UPDATE memory_meta SET source_ref = $2 WHERE id = $1`,
      [metaId, `${tableName}:${insertedId}`]
    );

    // Update record count in registry
    await tx.unsafe(
      `
      UPDATE _table_registry
      SET record_count = record_count + 1,
          updated_at = NOW()
      WHERE table_name = $1
    `,
      [tableName]
    );

    return insertedId;
  });
}

/**
 * Get table columns
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name
 * @returns Array of column metadata
 */
async function getTableColumns(
  tx: TransactionSql,
  tableName: string
): Promise<ColumnMetadata[]> {
  const rows = await tx.unsafe(
    `SELECT columns FROM _table_registry WHERE table_name = $1`,
    [tableName]
  );

  return rows[0]?.columns || [];
}

/**
 * Query table records
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name
 * @param filters - Optional filter conditions
 * @param limit - Maximum records to return
 * @param offset - Number of records to skip
 * @returns Array of records
 */
export async function queryRecords(
  userId: string,
  tableName: string,
  filters: Record<string, unknown> = {},
  limit: number = 100,
  offset: number = 0
): Promise<TableRecord[]> {
  validateTableName(tableName);

  return await withUserSchema(userId, async (tx) => {
    // Build WHERE clause
    const conditions: string[] = ['_deleted_at IS NULL'];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(filters)) {
      validateColumnName(key);
      conditions.push(`${escapeIdentifier(key)} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }

    params.push(limit);
    const limitParam = paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex;

    const querySql = `
      SELECT *
      FROM ${escapeIdentifier(tableName)}
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const rows = await tx.unsafe<Record<string, unknown>[]>(querySql, params);

    for (const row of rows) {
      if (row._meta_id) {
        await recordAccessInternal(tx, row._meta_id as number);
      }
    }

    return rows.map((row) => ({
      id: row.id as number,
      ...row,
      created_at: row.created_at ? new Date(row.created_at as string) : undefined,
      updated_at: row.updated_at ? new Date(row.updated_at as string) : undefined,
      _deleted_at: row._deleted_at ? new Date(row._deleted_at as string) : null,
    })) as TableRecord[];
  });
}

/**
 * Update record
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name
 * @param recordId - Record ID to update
 * @param data - Updated data
 * @returns Updated record
 */
export async function updateRecord(
  userId: string,
  tableName: string,
  recordId: number,
  data: Record<string, unknown>,
  changedBy: string = 'user',
  origin: string = 'user_typed'
): Promise<TableRecord> {
  validateTableName(tableName);
  assertWritable(tableName);

  return await withUserSchema(userId, async (tx) => {
    const existingRows = await tx.unsafe<Record<string, unknown>[]>(
      `
      SELECT *
      FROM ${escapeIdentifier(tableName)}
      WHERE id = $1
        AND _deleted_at IS NULL
      LIMIT 1
    `,
      [recordId]
    );

    if (existingRows.length === 0) {
      throw new Error(`Record ${recordId} not found in table ${tableName}`);
    }

    const existing = existingRows[0];
    const previousMetaId = (existing._meta_id as number | undefined) || undefined;

    // Auto-add newly introduced columns to preserve dynamic table behavior.
    const existingCols = await getTableColumns(tx, tableName);
    const existingNames = new Set(existingCols.map((c) => c.name));
    for (const [colName, value] of Object.entries(data)) {
      if (!existingNames.has(colName)) {
        await addColumn(tableName, colName, inferSqlType(value), tx);
      }
    }

    const newMetaId = await createMemoryMetaInternal(tx, {
      sourceType: 'table',
      sourceRef: `${tableName}:${recordId}`,
      origin,
      agentSource: changedBy !== 'user' ? changedBy : undefined,
    });

    // Build SET clause
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
      validateColumnName(key);
      setClauses.push(`${escapeIdentifier(key)} = $${paramIndex}`);
      // tx.unsafe() doesn't auto-serialize JSONB — stringify objects manually
      const serialized = (value !== null && typeof value === 'object' && !(value instanceof Date)) ? JSON.stringify(value) : value;
      params.push(serialized);
      paramIndex++;
    }

    // Add updated_at
    setClauses.push(`updated_at = NOW()`);
    setClauses.push(`_meta_id = $${paramIndex}`);
    params.push(newMetaId);
    paramIndex++;

    // Add record ID
    params.push(recordId);
    const idParam = paramIndex;

    const updateSql = `
      UPDATE ${escapeIdentifier(tableName)}
      SET ${setClauses.join(', ')}
      WHERE id = $${idParam}
        AND _deleted_at IS NULL
      RETURNING *
    `;

    const result = await tx.unsafe(updateSql, params);

    if (result.length === 0) {
      throw new Error(`Record ${recordId} not found in table ${tableName}`);
    }

    if (previousMetaId) {
      let reaffirmed = false;
      const comparisons: Array<{
        oldMetaId: number;
        field: string;
        oldValue: unknown;
        newValue: unknown;
        agent: string;
      }> = [];

      for (const [field, newValue] of Object.entries(data)) {
        const oldValue = existing[field];
        if (oldValue === undefined) continue;
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
          reaffirmed = true;
          continue;
        }

        comparisons.push({
          oldMetaId: previousMetaId,
          field: `${tableName}.${field}`,
          oldValue,
          newValue,
          agent: changedBy,
        });
      }

      await detectContradictionsInternal(tx, newMetaId, comparisons);

      if (reaffirmed) {
        // Conservative reinforcement: one mention bump per reaffirming update request.
        await recordMentionInternal(tx, previousMetaId);
      }
    }

    return result[0] as unknown as TableRecord;
  });
}

/**
 * Delete record (soft delete)
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name
 * @param recordId - Record ID to delete
 */
export async function deleteRecord(
  userId: string,
  tableName: string,
  recordId: number
): Promise<void> {
  validateTableName(tableName);
  assertWritable(tableName);

  await withUserSchema(userId, async (tx) => {
    const deleted = await tx.unsafe<Array<{ id: number }>>(
      `
      UPDATE ${escapeIdentifier(tableName)}
      SET _deleted_at = NOW()
      WHERE id = $1
        AND _deleted_at IS NULL
      RETURNING id
    `,
      [recordId]
    );

    if (deleted.length === 0) {
      throw new Error(`NOT_FOUND: Record ${recordId} not found in table ${tableName}`);
    }

    // Update record count in registry
    await tx.unsafe(
      `
      UPDATE _table_registry
      SET record_count = GREATEST(0, record_count - 1),
          updated_at = NOW()
      WHERE table_name = $1
    `,
      [tableName]
    );
  });
}

/**
 * List all tables
 *
 * @param userId - User ID for schema isolation
 * @returns Array of table metadata
 */
export async function listTables(userId: string): Promise<TableMetadata[]> {
  return await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe<Record<string, unknown>[]>(`
      SELECT
        table_name,
        description,
        columns,
        record_count,
        created_at,
        updated_at
      FROM _table_registry
      ORDER BY created_at DESC
    `);

    return rows.map((row) => ({
      tableName: row.table_name as string,
      description: row.description as string | undefined,
      columns: (row.columns || []) as ColumnMetadata[],
      recordCount: row.record_count as number,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }));
  });
}

/**
 * Get table metadata
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Table name
 * @returns Table metadata or null if not found
 */
export async function getTableMetadata(
  userId: string,
  tableName: string
): Promise<TableMetadata | null> {
  validateTableName(tableName);

  const result = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe<Record<string, unknown>[]>(
      `
      SELECT
        table_name,
        description,
        columns,
        record_count,
        created_at,
        updated_at
      FROM _table_registry
      WHERE table_name = $1
      LIMIT 1
    `,
      [tableName]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      tableName: row.table_name as string,
      description: row.description as string | undefined,
      columns: (row.columns || []) as ColumnMetadata[],
      recordCount: row.record_count as number,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  });

  return result;
}
