// api/src/services/tools/searchMemory.ts

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { searchVectors } from '@/services/vector.service';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';
import type { ToolContext, ToolResult } from './types.js';

interface SearchMemoryArgs {
  collection: string;
  query: string;
  minSimilarity?: number;
  limit?: number;
}

interface SearchMemoryData {
  collection: string;
  query: string;
  resultCount: number;
  results: Array<{
    text: string;
    similarity: number;
    metadata: unknown;
    createdAt: unknown;
  }>;
}

export async function searchMemory(args: SearchMemoryArgs, context: ToolContext): Promise<ToolResult<SearchMemoryData>> {
  const { userId, agentId } = context;
  const resource = `vectors/${args.collection}`;

  try {
    await requireConsent(userId, agentId, resource, 'read');
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
    action: 'mcp_search_memory',
    resource,
    details: {
      query: args.query,
      minSimilarity: args.minSimilarity,
      limit: args.limit,
    },
  });

  try {
    const results = await searchVectors(
      userId,
      args.collection,
      args.query,
      args.limit || 10,
      args.minSimilarity || 0.7,
    );

    const data: SearchMemoryData = {
      collection: args.collection,
      query: args.query,
      resultCount: results.length,
      results: results.map((r) => ({
        text: r.text,
        similarity: r.similarity,
        metadata: r.metadata,
        createdAt: r.createdAt,
      })),
    };

    return toolSuccess(data, `Found ${results.length} result(s) in ${args.collection}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, message, true);
  }
}
