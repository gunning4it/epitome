/**
 * Hono Type Extensions
 *
 * Custom types for Hono context variables
 */

/**
 * Environment variables for Hono context
 */
export type HonoEnv = {
  Variables: {
    userId?: string;
    agentId?: string;
    authType?: 'session' | 'api_key';
    tier?: 'free' | 'pro';
  };
};
