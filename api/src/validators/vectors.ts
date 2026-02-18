/**
 * Vectors Validation Schemas
 *
 * Zod schemas for vector endpoint request validation
 */

import { z } from 'zod';

/**
 * Collection name path parameter
 */
export const collectionNameSchema = z.object({
  collection: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, {
      message:
        'Collection name must start with a letter and contain only lowercase letters, numbers, and underscores',
    }),
}).strict();

/**
 * Add vector request body
 * POST /v1/vectors/:collection/add
 */
export const addVectorSchema = z.object({
  text: z.string().min(1).max(50000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  embedding: z.array(z.number()).optional(), // Optional pre-computed embedding
}).strict();

/**
 * Search vectors request body
 * POST /v1/vectors/:collection/search
 */
export const searchVectorsSchema = z.object({
  // Either text query (will be embedded) or pre-computed embedding
  query: z.string().min(1).max(50000).optional(),
  embedding: z.array(z.number()).optional(),

  // Search parameters
  limit: z.number().int().positive().max(100).optional().default(10),
  minSimilarity: z.number().min(0).max(1).optional().default(0.5),

  // Metadata filters
  filters: z.record(z.string(), z.unknown()).optional(),
}).strict().refine((data) => data.query || data.embedding, {
  message: 'Either query text or embedding vector must be provided',
});

// Type exports
export type CollectionNameParam = z.infer<typeof collectionNameSchema>;
export type AddVectorBody = z.infer<typeof addVectorSchema>;
export type SearchVectorsBody = z.infer<typeof searchVectorsSchema>;
