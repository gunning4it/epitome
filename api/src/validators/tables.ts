/**
 * Tables Validation Schemas
 *
 * Zod schemas for table endpoint request validation
 */

import { z } from 'zod';

/**
 * Table name path parameter
 */
export const tableNameSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/, {
      message:
        'Table name must start with a letter and contain only lowercase letters, numbers, and underscores',
    }),
}).strict();

/**
 * Record ID path parameter
 */
export const recordIdSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/, { message: 'Record ID must be a positive integer' })
    .transform((val) => parseInt(val, 10)),
}).strict();

/**
 * Insert record request body
 * POST /v1/tables/:name/records
 *
 * Flexible record data - any JSON object
 */
export const insertRecordSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
);

/**
 * Query records request body
 * POST /v1/tables/:name/query
 *
 * Supports both structured filters and raw SQL
 */
export const queryRecordsSchema = z.object({
  // Structured query
  filters: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().positive().max(1000).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),

  // OR raw SQL query (read-only, sandboxed)
  sql: z.string().optional(),
}).strict();

/**
 * Update record request body
 * PATCH /v1/tables/:name/records/:id
 */
export const updateRecordSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
);

// Type exports
export type TableNameParam = z.infer<typeof tableNameSchema>;
export type RecordIdParam = z.infer<typeof recordIdSchema>;
export type InsertRecordBody = z.infer<typeof insertRecordSchema>;
export type QueryRecordsBody = z.infer<typeof queryRecordsSchema>;
export type UpdateRecordBody = z.infer<typeof updateRecordSchema>;
