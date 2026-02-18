/**
 * Database Connection Pool
 *
 * Manages PostgreSQL connections using the `postgres` driver
 * with Drizzle ORM for type-safe queries.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

// postgres.TransactionSql uses Omit<Sql, ...> which strips call signatures per TS spec.
// At runtime, TransactionSql DOES support tagged template calls and helper calls.
// We restore those signatures here.
export type TransactionSql = postgres.TransactionSql<Record<string, unknown>> & {
  // Tagged template query: tx`SELECT ...`
  <T extends readonly (object | undefined)[] = postgres.Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): postgres.PendingQuery<T>;
  // Identifier helper: tx('table_name')
  (first: string, ...rest: string[]): postgres.Helper<string, string[]>;
  // Array helper: tx([1, 2, 3])
  (first: number[]): postgres.Helper<number[], number[]>;
};

// Get database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create postgres connection pool
// Single pool for all connections with connection pooling
export const sql = postgres(DATABASE_URL, {
  max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE) : 20, // Maximum number of connections in pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Timeout for establishing connection
  ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
});

// Create Drizzle instance with schema
export const db = drizzle(sql, { schema });

/**
 * Execute a query with a specific search_path for user schema isolation
 *
 * Uses sql.begin() transaction to guarantee all operations run on the same connection,
 * preventing race conditions where SET search_path runs on one connection and the
 * callback runs on another.
 *
 * @param userId - User ID to set search_path to user_{id}
 * @param callback - Function to execute with user schema access (receives transaction)
 * @returns Result from callback
 */
export async function withUserSchema<T>(
  userId: string,
  callback: (tx: TransactionSql) => Promise<T>
): Promise<T> {
  // Strict UUID validation to prevent SQL injection via search_path
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Invalid userId format: must be a UUID');
  }

  // Remove hyphens from UUID for schema name
  const schemaName = `user_${userId.replace(/-/g, '')}`;

  // Use transaction to guarantee single connection
  // SET LOCAL ensures search_path is automatically reset after transaction
  const result = await sql.begin(async (rawTx) => {
    const tx = rawTx as TransactionSql;
    await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public`);
    return await callback(tx);
  });

  return result as T;
}

/**
 * Close the database connection pool
 * Used during graceful shutdown
 */
export async function closeDatabase(): Promise<void> {
  await sql.end();
}
