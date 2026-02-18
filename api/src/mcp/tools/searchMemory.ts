/**
 * MCP Tool: search_memory
 *
 * Semantic search across vector collections
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { searchVectors } from '@/services/vector.service';
import type { McpContext } from '../server.js';

interface SearchMemoryArgs {
  collection: string;
  query: string;
  minSimilarity?: number;
  limit?: number;
}

export async function searchMemory(args: SearchMemoryArgs, context: McpContext) {
  const { userId, agentId } = context;
  const resource = `vectors/${args.collection}`;

  // Consent check
  await requireConsent(userId, agentId, resource, 'read');

  // Audit log
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

  // Search vectors
  const results = await searchVectors(
    userId,
    args.collection,
    args.query,
    args.limit || 10,
    args.minSimilarity || 0.7
  );

  return {
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
}
