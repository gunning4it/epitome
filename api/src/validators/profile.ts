/**
 * Profile Validation Schemas
 *
 * Zod schemas for profile endpoint request validation
 */

import { z } from 'zod';

/**
 * Profile update request body
 * PATCH /v1/profile
 *
 * Flexible JSONB structure with RFC 7396 merge semantics
 */
export const updateProfileSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
  ])
);

/**
 * Profile history query parameters
 * GET /v1/profile/history?limit=50
 */
export const profileHistoryQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .refine((val) => val > 0 && val <= 500, {
      message: 'Limit must be between 1 and 500',
    }),
}).strict();

// Type exports
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type ProfileHistoryQuery = z.infer<typeof profileHistoryQuerySchema>;
