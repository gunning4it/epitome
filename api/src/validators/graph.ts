/**
 * Graph API Validation Schemas
 *
 * Zod schemas for knowledge graph endpoints
 */

import { z } from 'zod';
import { ENTITY_TYPES } from '@/services/graphService';

/**
 * Entity ID path parameter
 */
export const entityIdSchema = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

/**
 * Entity creation body
 */
export const createEntitySchema = z.object({
  body: z.object({
    type: z.enum(ENTITY_TYPES),
    name: z.string().min(1).max(500),
    properties: z.record(z.string(), z.unknown()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    origin: z
      .enum(['user_stated', 'ai_inferred', 'ai_pattern', 'imported', 'system'])
      .optional(),
  }).strict(),
}).strict();

/**
 * Entity update body
 */
export const updateEntitySchema = z.object({
  body: z.object({
    name: z.string().min(1).max(500).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  }).strict(),
}).strict().or(
  z.object({
    name: z.string().min(1).max(500).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  }).strict()
);

/**
 * Entity merge body
 */
export const mergeEntitySchema = z.object({
  body: z.object({
    targetId: z.number().int().positive().optional(),
    target_id: z.number().int().positive().optional(),
  }).strict().refine((value) => value.targetId || value.target_id, {
    message: 'targetId (or target_id) is required',
  }),
}).strict().or(
  z.object({
    targetId: z.number().int().positive().optional(),
    target_id: z.number().int().positive().optional(),
  }).strict().refine((value) => value.targetId || value.target_id, {
    message: 'targetId (or target_id) is required',
  })
);

/**
 * Entity list query parameters
 */
export const entityListQuerySchema = z.object({
  type: z.enum(ENTITY_TYPES).optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  confidenceMax: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  includeSynthetic: z.coerce.boolean().default(false),
  edgeLimit: z.coerce.number().int().positive().max(2000).default(200),
  edgeOffset: z.coerce.number().int().min(0).default(0),
  stableMode: z.coerce.boolean().default(false),
  stableConfidenceMin: z.coerce.number().min(0).max(1).default(0.75),
}).strict();

/**
 * Entity neighbors query parameters
 */
export const entityNeighborsQuerySchema = z.object({
  direction: z.enum(['outbound', 'inbound', 'both']).default('both'),
  relation: z.string().optional(),
  confidenceMin: z.coerce.number().min(0).max(1).default(0),
  limit: z.coerce.number().int().positive().max(500).default(50),
}).strict();

/**
 * Edge creation body
 */
export const createEdgeSchema = z.object({
  body: z.object({
    sourceId: z.number().int().positive(),
    targetId: z.number().int().positive(),
    relation: z.string().min(1).max(100),
    weight: z.number().min(0).optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.array(z.record(z.string(), z.unknown())).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    origin: z
      .enum(['user_stated', 'ai_inferred', 'ai_pattern', 'imported', 'system'])
      .optional(),
  }).strict(),
}).strict();

/**
 * Graph query body (structured params OR SQL over graph)
 */
export const graphQuerySchema = z.object({
  // Semantic search mode
  query: z.string().min(1).max(500).optional(),
  type: z.enum(ENTITY_TYPES).optional(),

  // SQL mode
  sql: z.string().min(1).max(10000).optional(),
  timeout: z.number().int().min(1).max(60).optional(),

  // Common
  limit: z.number().int().positive().max(1000).optional(),
}).strict().refine((data) => data.query || data.sql, {
  message: 'Must provide either query or sql parameter',
});

/**
 * Multi-hop traversal body
 */
export const traverseSchema = z.object({
  startId: z.number().int().positive(),
  maxDepth: z.number().int().min(1).max(4).default(3),
  relationFilter: z
    .union([z.string(), z.array(z.string())])
    .optional(),
  entityTypeFilter: z
    .union([z.enum(ENTITY_TYPES), z.array(z.enum(ENTITY_TYPES))])
    .optional(),
  confidenceMin: z.number().min(0).max(1).default(0.3),
  limit: z.number().int().positive().max(1000).default(500),
}).strict();

/**
 * Path query body
 */
export const pathQuerySchema = z.object({
  body: z.object({
    sourceId: z.number().int().positive(),
    targetId: z.number().int().positive(),
    maxDepth: z.number().int().min(1).max(4).default(3),
  }).strict(),
}).strict();

/**
 * Pattern query body
 */
export const patternQuerySchema = z.object({
  pattern: z.string().min(1).max(500),
  limit: z.number().int().positive().max(100).default(20),
}).strict();

// Type exports
export type EntityIdParam = z.infer<typeof entityIdSchema>;
export type CreateEntityBody = z.infer<typeof createEntitySchema>;
export type UpdateEntityBody = z.infer<typeof updateEntitySchema>;
export type MergeEntityBody = z.infer<typeof mergeEntitySchema>;
export type EntityListQuery = z.infer<typeof entityListQuerySchema>;
export type EntityNeighborsQuery = z.infer<typeof entityNeighborsQuerySchema>;
export type CreateEdgeBody = z.infer<typeof createEdgeSchema>;
export type GraphQueryBody = z.infer<typeof graphQuerySchema>;
export type TraverseBody = z.infer<typeof traverseSchema>;
export type PathQueryBody = z.infer<typeof pathQuerySchema>;
export type PatternQueryBody = z.infer<typeof patternQuerySchema>;
