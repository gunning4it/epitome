/**
 * MCP Tool: save_memory
 *
 * Save a memory vector with embedding generation
 * Triggers async entity extraction and thread linking (non-blocking)
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { createWriteId, ingestMemoryText } from '@/services/writeIngestion.service';
import { linkRelatedRecords } from '@/services/threadLinking';
import { logger } from '@/utils/logger';
import type { McpContext } from '../server.js';

interface SaveMemoryArgs {
  collection: string;
  text: string;
  metadata?: Record<string, any>;
}

export async function saveMemory(args: SaveMemoryArgs, context: McpContext) {
  const { userId, agentId } = context;
  const resource = `vectors/${args.collection}`;

  // Consent check
  await requireConsent(userId, agentId, resource, 'write');

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
  });

  // Trigger async thread linking (non-blocking)
  if (ingested.vectorId) {
    linkRelatedRecords(userId, ingested.vectorId, 'vectors').catch((error: unknown) => {
      logger.error('save_memory thread linking failed', { error: String(error) });
    });
  }

  return {
    success: true,
    collection: args.collection,
    vectorId: ingested.vectorId,
    pendingVectorId: ingested.pendingVectorId,
    sourceRef: ingested.sourceRef,
    writeId: ingested.writeId,
    writeStatus: ingested.writeStatus,
    jobId: ingested.jobId,
    message: 'Memory saved successfully',
  };
}
