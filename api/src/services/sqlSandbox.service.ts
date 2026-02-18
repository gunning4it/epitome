/**
 * SQL Sandbox Service
 *
 * Validates and executes user-provided SQL queries safely
 *
 * Security Features:
 * - SELECT only (blocks INSERT, UPDATE, DELETE, DDL)
 * - No system catalog access (pg_catalog, information_schema)
 * - 30-second statement timeout
 * - 10,000 row limit
 * - Schema isolation enforcement
 *
 * H-5 SECURITY FIX: AST-based validation (replaced regex)
 */

import { withUserSchema } from '@/db/client';
import { parseSync as parseSql } from 'pgsql-parser';
import { logger } from '@/utils/logger';

/**
 * SQL query result
 */
export interface SqlQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionTime: number; // milliseconds
}

/**
 * Blocked schema/table patterns
 */
const BLOCKED_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'pg_temp',
];

/**
 * Validate SQL query using AST parsing
 *
 * H-5 SECURITY FIX: Replaced regex-based validation with AST parser
 * to prevent bypass attacks (comment injection, UNION, encoding).
 *
 * @param sql - SQL query to validate
 * @throws Error if query is unsafe
 */
export function validateSqlQuery(sql: string): void {
  // Trim and normalize SQL
  const normalizedSql = sql.trim();

  // Check query length first (prevent DoS via parsing)
  if (normalizedSql.length === 0) {
    throw new Error('SQL_SANDBOX_ERROR: Empty SQL query');
  }

  if (normalizedSql.length > 10000) {
    throw new Error(
      'SQL_SANDBOX_ERROR: Query exceeds maximum length (10,000 characters)'
    );
  }

  // H-5 SECURITY FIX: Parse SQL into Abstract Syntax Tree
  let parsed: unknown;
  try {
    parsed = parseSql(normalizedSql);
    logger.debug('Parsed SQL AST', { isArray: Array.isArray(parsed), hasStmts: parsed && typeof parsed === 'object' && parsed !== null && 'stmts' in parsed });
  } catch (error) {
    throw new Error(
      `SQL_SANDBOX_ERROR: Invalid SQL syntax: ${error instanceof Error ? error.message : 'parse error'}`
    );
  }

  // pgsql-parser returns { stmts: [...] } or array
  const stmts = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && parsed !== null && 'stmts' in parsed
        ? (parsed as { stmts: unknown[] }).stmts
        : []);

  // Ensure exactly one statement
  if (stmts.length === 0) {
    throw new Error('SQL_SANDBOX_ERROR: No SQL statement found');
  }

  if (stmts.length > 1) {
    throw new Error(
      'SQL_SANDBOX_ERROR: Multiple statements not allowed (prevents SQL injection)'
    );
  }

  const statement = stmts[0];
  if (!statement || !statement.stmt) {
    throw new Error('SQL_SANDBOX_ERROR: Invalid statement structure');
  }

  // H-5 SECURITY FIX: Only allow SelectStmt at AST level
  if (!statement.stmt.SelectStmt) {
    const stmtType = Object.keys(statement.stmt)[0];
    throw new Error(
      `SQL_SANDBOX_ERROR: Only SELECT queries allowed (found: ${stmtType})`
    );
  }

  // Recursively validate the AST to block dangerous constructs
  validateAstNode(statement.stmt.SelectStmt, sql);
}

/**
 * Recursively validate AST nodes
 *
 * H-5 SECURITY FIX: Deep validation of AST to prevent:
 * - System catalog access (pg_catalog, information_schema)
 * - Dangerous functions (pg_read_file, etc.)
 * - Subqueries with non-SELECT statements
 *
 * @param node - AST node to validate
 * @param originalSql - Original SQL for error messages
 */
function validateAstNode(node: unknown, originalSql: string): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  const nodeObj = node as Record<string, unknown>;

  // Check for table references
  if (nodeObj.RangeVar && typeof nodeObj.RangeVar === 'object' && nodeObj.RangeVar !== null) {
    const rangeVar = nodeObj.RangeVar as Record<string, unknown>;
    const schemaname = rangeVar.schemaname;
    const relname = rangeVar.relname;

    // Block system schema access
    if (typeof schemaname === 'string' && BLOCKED_SCHEMAS.includes(schemaname.toLowerCase())) {
      throw new Error(
        `SQL_SANDBOX_ERROR: Access to system schema '${schemaname}' is blocked`
      );
    }

    // H-5 SECURITY FIX: Block ALL explicit schema references — queries must use search_path
    if (typeof schemaname === 'string' && schemaname.length > 0) {
      throw new Error(
        'SQL_SANDBOX_ERROR: Explicit schema references are not allowed. Use unqualified table names only.'
      );
    }

    // Block system catalogs even without explicit schema
    if (typeof relname === 'string') {
      const lowerRelname = relname.toLowerCase();
      if (
        lowerRelname.startsWith('pg_') ||
        lowerRelname === 'information_schema'
      ) {
        throw new Error(
          `SQL_SANDBOX_ERROR: Access to system table '${relname}' is blocked`
        );
      }
    }
  }

  // Check for function calls
  if (nodeObj.FuncCall && typeof nodeObj.FuncCall === 'object' && nodeObj.FuncCall !== null) {
    const funcCall = nodeObj.FuncCall as Record<string, unknown>;
    const funcname = funcCall.funcname;
    if (Array.isArray(funcname)) {
      const funcStr = funcname
        .map((n: unknown) => {
          if (n && typeof n === 'object' && 'String' in n) {
            const strObj = (n as { String: unknown }).String;
            if (strObj && typeof strObj === 'object' && 'str' in strObj) {
              return (strObj as { str: unknown }).str;
            }
          }
          return '';
        })
        .join('.');
      const lowerFunc = funcStr.toLowerCase();

      // Block dangerous PostgreSQL functions
      const blockedFunctions = [
        'pg_read_file',
        'pg_write_file',
        'pg_ls_dir',
        'pg_read_binary_file',
        'pg_execute',
        'pg_exec',
        'pg_sleep',
        'pg_terminate_backend',
        'pg_cancel_backend',
        'current_setting',
        'set_config',
        'pg_advisory_lock',
      ];

      if (blockedFunctions.some((f) => lowerFunc.includes(f))) {
        throw new Error(
          `SQL_SANDBOX_ERROR: Function '${funcStr}' is blocked for security`
        );
      }
    }
  }

  // Check for subqueries (ensure they're also SELECT only)
  if (nodeObj.SelectStmt) {
    validateAstNode(nodeObj.SelectStmt, originalSql);
  }

  // Check for UNION queries (data exfiltration vector)
  if (nodeObj.op && typeof nodeObj.op === 'number') {
    // UNION operations in AST
    // We allow UNION but validate both sides
    if (nodeObj.larg) validateAstNode(nodeObj.larg, originalSql);
    if (nodeObj.rarg) validateAstNode(nodeObj.rarg, originalSql);
  }

  // Recursively validate arrays
  if (Array.isArray(node)) {
    (node as unknown[]).forEach((item) => validateAstNode(item, originalSql));
  }

  // Recursively validate object properties
  for (const key in nodeObj) {
    if (typeof nodeObj[key] === 'object') {
      validateAstNode(nodeObj[key], originalSql);
    }
  }
}

/**
 * Execute SQL query in sandbox
 *
 * Runs a validated SELECT query with safety limits
 *
 * @param userId - User ID for schema isolation
 * @param sql - SQL query to execute
 * @param timeout - Query timeout in seconds (default 30)
 * @param rowLimit - Maximum rows to return (default 10,000)
 * @returns Query result
 */
export async function executeSandboxedQuery(
  userId: string,
  sql: string,
  timeout: number = 30,
  rowLimit: number = 10000,
  options: {
    excludeSoftDeleted?: boolean;
  } = {}
): Promise<SqlQueryResult> {
  // Validate query before execution
  await validateSqlQuery(sql);

  const startTime = Date.now();

  const result = await withUserSchema(userId, async (tx) => {
    try {
      // Set statement timeout with runtime numeric coercion + bounds clamping
      const safeTimeout = Math.min(Math.max(Math.floor(Number(timeout)), 1), 60);
      await tx.unsafe('SET LOCAL statement_timeout = \'' + safeTimeout + 's\'');

      // Execute query with row limit
      // Remove trailing semicolon if present
      const cleanSql = sql.trim().replace(/;$/, '');

      // Use string concatenation to avoid template literal issues with % signs
      const safeRowLimit = Math.min(Math.max(Math.floor(Number(rowLimit)), 1), 10000);
      const limitedSql =
        'WITH limited_query AS (' +
        cleanSql +
        ') SELECT * FROM limited_query LIMIT ' + safeRowLimit;

      const rows = await tx.unsafe<Array<Record<string, unknown>>>(limitedSql);
      const filteredRows = options.excludeSoftDeleted
        ? rows.filter((row) => {
            if (!('_deleted_at' in row)) return true;
            const deletedValue = row._deleted_at as unknown;
            return deletedValue === null || deletedValue === undefined;
          })
        : rows;

      return {
        rows: filteredRows,
        rowCount: filteredRows.length,
      };
    } catch (error) {
      // Check for specific error types
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(
            `SQL_SANDBOX_ERROR: Query exceeded timeout of ${timeout} seconds`
          );
        }
        if (error.message.includes('permission denied')) {
          throw new Error(
            'SQL_SANDBOX_ERROR: Query attempted to access unauthorized resources'
          );
        }
      }
      throw error;
    }
  });

  const executionTime = Date.now() - startTime;

  return {
    rows: result.rows,
    rowCount: result.rowCount,
    executionTime,
  };
}

/**
 * Explain SQL query
 *
 * Returns query execution plan without executing the query
 *
 * @param userId - User ID for schema isolation
 * @param sql - SQL query to explain
 * @returns Query execution plan
 */
export async function explainQuery(
  userId: string,
  sql: string
): Promise<Array<Record<string, unknown>>> {
  // Validate query
  await validateSqlQuery(sql);

  return await withUserSchema(userId, async (tx) => {
    const cleanSql = sql.trim().replace(/;$/, '');
    const explainSql = `EXPLAIN (FORMAT JSON) ${cleanSql}`;
    const result = await tx.unsafe(explainSql);
    return result as Array<Record<string, unknown>>;
  });
}

/**
 * Validate table name
 *
 * Ensures table name doesn't contain SQL injection attempts
 *
 * @param tableName - Table name to validate
 * @returns Sanitized table name
 * @throws Error if table name is invalid
 */
export function validateTableName(tableName: string): string {
  // Allow only alphanumeric characters and underscores
  const validPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

  if (!validPattern.test(tableName)) {
    throw new Error(
      'SQL_SANDBOX_ERROR: Invalid table name. Must start with a letter and contain only alphanumeric characters and underscores (max 63 chars)'
    );
  }

  // Check for SQL keywords
  const upperName = tableName.toUpperCase();
  const reservedKeywords = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TABLE',
    'FROM',
    'WHERE',
    'GRANT',
    'REVOKE',
    'EXECUTE',
    'TRUNCATE',
    'COPY',
    'VACUUM',
    'ANALYZE',
  ];

  if (reservedKeywords.includes(upperName)) {
    throw new Error(
      `SQL_SANDBOX_ERROR: Table name cannot be a reserved SQL keyword: ${tableName}`
    );
  }

  return tableName;
}

/**
 * Validate column name
 *
 * Ensures column name doesn't contain SQL injection attempts
 *
 * @param columnName - Column name to validate
 * @returns Sanitized column name
 * @throws Error if column name is invalid
 */
export function validateColumnName(columnName: string): string {
  // Allow alphanumeric characters and underscores only (no hyphens — not valid SQL identifiers)
  const validPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

  if (!validPattern.test(columnName)) {
    throw new Error(
      'SQL_SANDBOX_ERROR: Invalid column name. Must start with a letter and contain only alphanumeric characters and underscores (max 63 chars)'
    );
  }

  return columnName;
}

/**
 * Escape SQL identifier
 *
 * Wraps identifier in double quotes to prevent SQL injection
 *
 * @param identifier - Identifier to escape
 * @returns Escaped identifier
 */
export function escapeIdentifier(identifier: string): string {
  // Remove existing quotes and escape internal quotes
  const cleaned = identifier.replace(/"/g, '""');
  return `"${cleaned}"`;
}

/**
 * Build safe WHERE clause
 *
 * Constructs a WHERE clause from filter object safely
 *
 * @param filters - Key-value filter object
 * @returns Parameterized WHERE clause
 */
export function buildWhereClause(filters: Record<string, unknown>): {
  clause: string;
  params: unknown[];
} {
  if (Object.keys(filters).length === 0) {
    return { clause: '1=1', params: [] };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(filters)) {
    // Validate column name
    validateColumnName(key);

    if (value === null) {
      conditions.push(`${escapeIdentifier(key)} IS NULL`);
    } else if (Array.isArray(value)) {
      conditions.push(`${escapeIdentifier(key)} = ANY($${paramIndex})`);
      params.push(value);
      paramIndex++;
    } else {
      conditions.push(`${escapeIdentifier(key)} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  return {
    clause: conditions.join(' AND '),
    params,
  };
}
