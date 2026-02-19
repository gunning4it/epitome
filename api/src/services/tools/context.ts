// api/src/services/tools/context.ts
import { randomUUID } from 'crypto';
import type { ToolContext, Tier, AuthType } from './types.js';

const VALID_TIERS: Set<string> = new Set(['free', 'pro', 'enterprise']);

interface BuildContextInput {
  userId: string;
  agentId: string;
  tier: string;
  authType: AuthType;
  requestId?: string;
}

/**
 * Build a ToolContext from raw auth info.
 * Derives schemaName from userId (matches withUserSchema() pattern).
 */
export function buildToolContext(input: BuildContextInput): ToolContext {
  if (!input.userId) {
    throw new Error('UNAUTHORIZED: Authentication required.');
  }

  const tier: Tier = VALID_TIERS.has(input.tier) ? (input.tier as Tier) : 'free';
  const schemaName = `user_${input.userId.replace(/-/g, '')}`;

  return {
    userId: input.userId,
    agentId: input.agentId,
    tier,
    authType: input.authType,
    schemaName,
    requestId: input.requestId ?? randomUUID(),
  };
}
