// api/src/services/tools/saveMemory.ts

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { createWriteId, ingestMemoryText } from '@/services/writeIngestion.service';
import { linkRelatedRecords } from '@/services/threadLinking';
import { logger } from '@/utils/logger';
import type { ToolContext, ToolResult } from './types.js';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';

interface SaveMemoryArgs {
  collection: string;
  text: string;
  metadata?: Record<string, any>;
}

export async function saveMemory(
  args: SaveMemoryArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { userId, agentId } = ctx;
  const resource = `vectors/${args.collection}`;

  // Consent check
  try {
    await requireConsent(userId, agentId, resource, 'write');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('CONSENT_DENIED')) {
      return toolFailure(ToolErrorCode.CONSENT_DENIED, msg, false);
    }
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
  }

  try {
    // Audit log
    await logAuditEntry(userId, {
      agentId,
      action: 'mcp_save_memory',
      resource,
      details: {
        textLength: args.text.length,
        metadata: args.metadata,
      },
    });

    const writeId = createWriteId();
    const ingested = await ingestMemoryText({
      userId,
      collection: args.collection,
      text: args.text,
      metadata: args.metadata || {},
      changedBy: agentId,
      origin: 'ai_stated',
      writeId,
      tier: ctx.tier,
    });

    // Trigger async thread linking (non-blocking)
    if (ingested.vectorId) {
      linkRelatedRecords(userId, ingested.vectorId, 'vectors').catch((error: unknown) => {
        logger.error('save_memory thread linking failed', { error: String(error) });
      });
    }

    return toolSuccess(
      {
        success: true,
        collection: args.collection,
        vectorId: ingested.vectorId,
        pendingVectorId: ingested.pendingVectorId,
        sourceRef: ingested.sourceRef,
        writeId: ingested.writeId,
        writeStatus: ingested.writeStatus,
        jobId: ingested.jobId,
        message: 'Memory saved successfully',
      },
      'Memory saved successfully',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('saveMemory service error', { error: msg, userId });
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
  }
}
