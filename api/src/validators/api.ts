/**
 * API Validation Schemas
 *
 * Zod schemas for all API endpoints
 */

import { z } from 'zod';

/**
 * Profile PATCH body
 */
const rawProfilePatchSchema = z.record(z.string(), z.unknown());
const wrappedProfilePatchSchema = z.object({
  body: rawProfilePatchSchema,
}).strict();

export const patchProfileSchema = z.union([
  wrappedProfilePatchSchema,
  rawProfilePatchSchema,
]);

/**
 * Profile history query params
 */
export const profileHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
}).strict();

/**
 * Table name path parameter
 */
export const tableNameSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
}).strict();

/**
 * Table record body (flexible)
 */
export const tableRecordSchema = z.object({
  body: z.record(z.string(), z.unknown()),
}).strict();

/**
 * Table query body
 */
export const tableQuerySchema = z.object({
  body: z.object({
    filters: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().min(0).optional(),
    sql: z.string().max(10000).optional(), // Alternative: raw SQL
  }).strict(),
}).strict();

/**
 * Table record ID path parameter
 */
export const tableRecordIdSchema = z.object({
  name: z.string().min(1).max(63),
  id: z.coerce.number().int().positive(),
}).strict();

/**
 * Vector collection path parameter
 */
export const vectorCollectionSchema = z.object({
  collection: z.string().min(1).max(100),
}).strict();

/**
 * Vector add body
 */
export const vectorAddSchema = z.object({
  body: z.object({
    text: z.string().min(1).max(50000),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
}).strict();

/**
 * Vector search body
 */
export const vectorSearchSchema = z.object({
  body: z.object({
    query: z.string().min(1).max(1000),
    limit: z.number().int().positive().max(100).default(10),
    minSimilarity: z.number().min(0).max(1).default(0.7),
  }).strict(),
}).strict();

/**
 * Memory review ID path parameter
 */
export const memoryReviewIdSchema = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

/**
 * Memory resolve action body
 */
export const memoryResolveSchema = z.object({
  body: z.object({
    action: z.enum(['confirm', 'reject', 'keep_both']),
  }).strict(),
}).strict();

/**
 * Activity query parameters
 */
export const activityQuerySchema = z.object({
  agentId: z.string().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

/**
 * Agent ID path parameter
 */
export const agentIdSchema = z.object({
  id: z.string().min(1).max(100),
}).strict();

/**
 * Memory Router OpenAI chat completions body
 */
export const memoryRouterOpenAiSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'tool']),
      content: z.union([z.string(), z.array(z.unknown())]),
    }).passthrough()
  ).min(1),
  stream: z.boolean().optional(),
}).passthrough();

/**
 * Memory Router Anthropic messages body
 */
export const memoryRouterAnthropicSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.union([z.string(), z.array(z.unknown())]),
    }).passthrough()
  ).min(1),
  system: z.union([z.string(), z.array(z.unknown())]).optional(),
  stream: z.boolean().optional(),
}).passthrough();

/**
 * Memory Router settings PATCH body
 */
export const memoryRouterSettingsPatchSchema = z.object({
  body: z.object({
    enabled: z.boolean().optional(),
    defaultCollection: z.string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._-]{1,100}$/)
      .optional(),
  }).strict().refine(
    (payload) => payload.enabled !== undefined || payload.defaultCollection !== undefined,
    { message: 'At least one setting must be provided' }
  ),
}).strict();

// Type exports
export type PatchProfileBody = z.infer<typeof patchProfileSchema>;
export type ProfileHistoryQuery = z.infer<typeof profileHistoryQuerySchema>;
export type TableNameParam = z.infer<typeof tableNameSchema>;
export type TableRecordBody = z.infer<typeof tableRecordSchema>;
export type TableQueryBody = z.infer<typeof tableQuerySchema>;
export type TableRecordIdParam = z.infer<typeof tableRecordIdSchema>;
export type VectorCollectionParam = z.infer<typeof vectorCollectionSchema>;
export type VectorAddBody = z.infer<typeof vectorAddSchema>;
export type VectorSearchBody = z.infer<typeof vectorSearchSchema>;
export type MemoryReviewIdParam = z.infer<typeof memoryReviewIdSchema>;
export type MemoryResolveBody = z.infer<typeof memoryResolveSchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export type AgentIdParam = z.infer<typeof agentIdSchema>;
export type MemoryRouterOpenAiBody = z.infer<typeof memoryRouterOpenAiSchema>;
export type MemoryRouterAnthropicBody = z.infer<typeof memoryRouterAnthropicSchema>;
export type MemoryRouterSettingsPatchBody = z.infer<typeof memoryRouterSettingsPatchSchema>;
