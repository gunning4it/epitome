/**
 * MCP Tool: retrieve_user_knowledge (legacy handler)
 *
 * Delegates to the service layer's retrieveUserKnowledge.
 * This handler exists for the legacy MCP code path; the service-layer
 * path (MCP_USE_SERVICE_LAYER=true) routes directly via SERVICE_MAP.
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { retrieveUserKnowledge as retrieveService } from '@/services/tools/retrieveUserKnowledge.js';
import { buildToolContext } from '@/services/tools/context.js';
import type { McpContext } from '../server.js';

interface RetrieveUserKnowledgeArgs {
  topic: string;
  budget?: 'small' | 'medium' | 'deep';
}

export async function retrieveUserKnowledge(args: RetrieveUserKnowledgeArgs, context: McpContext) {
  const { userId, agentId, tier } = context;

  // Consent check
  await requireConsent(userId, agentId, 'profile', 'read');

  // Audit log
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_retrieve_user_knowledge',
    resource: 'knowledge',
    details: { topic: args.topic, budget: args.budget },
  });

  // Delegate to the service layer
  const ctx = buildToolContext({
    userId,
    agentId,
    tier: tier || 'free',
    authType: 'api_key',
  });

  const result = await retrieveService(args, ctx);

  if (result.success) {
    return result.data;
  }

  throw new Error(result.message);
}
