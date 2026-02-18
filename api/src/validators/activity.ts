/**
 * Activity/Audit Validation Schemas
 *
 * Zod schemas for activity endpoint request validation
 */

import { z } from 'zod';

/**
 * Activity query parameters
 * GET /v1/activity?agent_id=claude&action=read&limit=100
 */
export const activityQuerySchema = z.object({
  agent_id: z.string().optional(),
  action: z.enum(['read', 'write', 'query', 'delete', 'consent_check']).optional(),
  resource: z.string().optional(),
  start_date: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  end_date: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 100))
    .refine((val) => val > 0 && val <= 1000, {
      message: 'Limit must be between 1 and 1000',
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .refine((val) => val >= 0, {
      message: 'Offset must be non-negative',
    }),
}).strict();

/**
 * Agent ID path parameter
 * DELETE /v1/agents/:id
 */
export const agentIdSchema = z.object({
  id: z.string().min(1).max(100),
}).strict();

// Type exports
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export type AgentIdParam = z.infer<typeof agentIdSchema>;
