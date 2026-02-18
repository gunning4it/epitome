/**
 * Authentication Validation Schemas
 *
 * Zod schemas for request validation on auth endpoints
 */

import { z } from 'zod';

/**
 * OAuth provider enumeration
 */
export const oauthProviderSchema = z.enum(['google', 'github']);

/**
 * Login query parameters
 * GET /v1/auth/login?provider=google|github
 */
export const loginQuerySchema = z.object({
  provider: oauthProviderSchema,
  redirect_uri: z.string().url().optional(),
}).strict();

/**
 * OAuth callback query parameters
 * GET /v1/auth/callback?code=...&state=...
 */
export const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  provider: oauthProviderSchema.optional(), // Can also come from state
}).passthrough(); // Google sends extra params: scope, authuser, prompt

/**
 * API key creation request body
 * POST /v1/auth/api-keys
 */
export const createApiKeySchema = z.object({
  label: z.string().min(1).max(100),
  agent_id: z.string().min(1).max(100).optional(),
  scopes: z.array(z.enum(['read', 'write'])).default(['read', 'write']),
  expires_in_days: z.number().int().positive().max(365).optional(),
}).strict();

/**
 * Refresh token request body
 * POST /v1/auth/refresh
 */
export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1).optional(),
}).strict();

/**
 * API key ID path parameter
 * DELETE /v1/auth/api-keys/:id
 */
export const apiKeyIdSchema = z.object({
  id: z.string().uuid(),
}).strict();

// Type exports for use in handlers
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;
export type LoginQuery = z.infer<typeof loginQuerySchema>;
export type CallbackQuery = z.infer<typeof callbackQuerySchema>;
export type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenSchema>;
export type ApiKeyIdParam = z.infer<typeof apiKeyIdSchema>;
