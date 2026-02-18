/**
 * MCP Tool: review_memories
 *
 * Get and resolve memory contradictions
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { getContradictions, resolveContradiction } from '../serviceWrappers.js';
import type { McpContext } from '../server.js';

interface ReviewMemoriesArgs {
  action: 'list' | 'resolve';
  metaId?: number;
  resolution?: 'confirm' | 'reject' | 'keep_both';
}

export async function reviewMemories(args: ReviewMemoriesArgs, context: McpContext) {
  const { userId, agentId } = context;

  // Consent check
  await requireConsent(userId, agentId, 'memory', 'read');

  // Audit log
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_review_memories',
    resource: 'memory',
    details: {
      action: args.action,
      metaId: args.metaId,
      resolution: args.resolution,
    },
  });

  if (args.action === 'list') {
    // Get contradictions
    const contradictions = await getContradictions(userId, {
      limit: 5, // Max 5 items in review tray
    });

    return {
      contradictionCount: contradictions.length,
      contradictions,
    };
  } else if (args.action === 'resolve') {
    if (!args.metaId || !args.resolution) {
      throw new Error('INVALID_ARGS: metaId and resolution are required for resolve action');
    }

    // Require write access for resolution
    await requireConsent(userId, agentId, 'memory', 'write');

    // Resolve contradiction
    await resolveContradiction(userId, args.metaId, args.resolution, {
      resolvedBy: agentId,
    });

    return {
      success: true,
      metaId: args.metaId,
      resolution: args.resolution,
      message: 'Contradiction resolved successfully',
    };
  } else {
    throw new Error(`INVALID_ARGS: Invalid action: ${args.action}`);
  }
}
