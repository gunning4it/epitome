// api/src/services/tools/reviewMemories.ts

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { getContradictions, resolveContradiction } from '@/mcp/serviceWrappers.js';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';
import type { ToolContext, ToolResult } from './types.js';

interface ReviewMemoriesArgs {
  action: 'list' | 'resolve';
  metaId?: number;
  resolution?: 'confirm' | 'reject' | 'keep_both';
}

interface ListContradictionsData {
  contradictionCount: number;
  contradictions: unknown[];
}

interface ResolveContradictionData {
  success: true;
  metaId: number;
  resolution: string;
  message: string;
}

type ReviewMemoriesData = ListContradictionsData | ResolveContradictionData;

export async function reviewMemories(args: ReviewMemoriesArgs, context: ToolContext): Promise<ToolResult<ReviewMemoriesData>> {
  const { userId, agentId } = context;

  // Read consent always required
  try {
    await requireConsent(userId, agentId, 'memory', 'read');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolFailure(
      message.startsWith('CONSENT_DENIED') ? ToolErrorCode.CONSENT_DENIED : ToolErrorCode.INTERNAL_ERROR,
      message,
      false,
    );
  }

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

  try {
    if (args.action === 'list') {
      const contradictions = await getContradictions(userId, {
        limit: 5,
      });

      return toolSuccess(
        {
          contradictionCount: contradictions.length,
          contradictions,
        } as ListContradictionsData,
        `Found ${contradictions.length} contradiction(s)`,
      );
    } else if (args.action === 'resolve') {
      if (!args.metaId || !args.resolution) {
        return toolFailure(
          ToolErrorCode.INVALID_ARGS,
          'INVALID_ARGS: metaId and resolution are required for resolve action',
          false,
        );
      }

      // Write consent required for resolve
      try {
        await requireConsent(userId, agentId, 'memory', 'write');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolFailure(
          message.startsWith('CONSENT_DENIED') ? ToolErrorCode.CONSENT_DENIED : ToolErrorCode.INTERNAL_ERROR,
          message,
          false,
        );
      }

      await resolveContradiction(userId, args.metaId, args.resolution, {
        resolvedBy: agentId,
      });

      return toolSuccess(
        {
          success: true as const,
          metaId: args.metaId,
          resolution: args.resolution,
          message: 'Contradiction resolved successfully',
        } as ResolveContradictionData,
        'Contradiction resolved successfully',
      );
    } else {
      return toolFailure(
        ToolErrorCode.INVALID_ARGS,
        `INVALID_ARGS: Invalid action: ${args.action}`,
        false,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, message, true);
  }
}
