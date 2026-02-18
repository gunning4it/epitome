/**
 * Memory Quality Validation Schemas
 *
 * Zod schemas for memory quality endpoint request validation
 */

import { z } from 'zod';

/**
 * Memory review query parameters
 * GET /v1/memory/review?limit=5
 */
export const reviewQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 5))
    .refine((val) => val > 0 && val <= 20, {
      message: 'Limit must be between 1 and 20',
    }),
}).strict();

/**
 * Memory review ID path parameter
 */
export const reviewIdSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/, { message: 'Review ID must be a positive integer' })
    .transform((val) => parseInt(val, 10)),
}).strict();

/**
 * Resolve review request body
 * POST /v1/memory/review/:id/resolve
 */
export const resolveReviewSchema = z.object({
  resolution: z.enum(['confirm', 'reject', 'keep_both']),
  note: z.string().max(500).optional(),
}).strict();

// Type exports
export type ReviewQueryParam = z.infer<typeof reviewQuerySchema>;
export type ReviewIdParam = z.infer<typeof reviewIdSchema>;
export type ResolveReviewBody = z.infer<typeof resolveReviewSchema>;
