// api/src/services/tools/recall.ts

/**
 * Facade: recall — retrieve information from all data sources.
 *
 * No topic → delegates to getUserContext (profile, tables, collections, entities, hints)
 * With topic → delegates to retrieveUserKnowledge (federated search with fusion)
 * mode:'memory' → delegates to searchMemory (collection-specific vector search)
 * mode:'graph' → delegates to queryGraph (graph traversal/pattern)
 * mode:'table' → delegates to queryTable (sandboxed SQL/filters)
 */

import { getUserContext } from './getUserContext.js';
import { retrieveUserKnowledge } from './retrieveUserKnowledge.js';
import { searchMemory } from './searchMemory.js';
import { queryGraph } from './queryGraph.js';
import { queryTable } from './queryTable.js';
import type { ToolContext, ToolResult } from './types.js';
import { toolFailure, ToolErrorCode } from './types.js';

export interface RecallArgs {
  topic?: string;
  budget?: 'small' | 'medium' | 'deep';
  mode?: 'context' | 'knowledge' | 'memory' | 'graph' | 'table';
  memory?: { collection: string; query: string; minSimilarity?: number; limit?: number };
  graph?: { queryType: 'traverse' | 'pattern'; entityId?: number; relation?: string; maxHops?: number; pattern?: string | { entityType?: string; entityName?: string; relation?: string; targetType?: string } };
  table?: { table?: string; tableName?: string; filters?: Record<string, unknown>; sql?: string; limit?: number; offset?: number };
}

export async function recall(
  args: RecallArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Explicit mode routing
  if (args.mode) {
    switch (args.mode) {
      case 'context':
        return getUserContext({ topic: args.topic }, ctx);

      case 'knowledge':
        if (!args.topic) {
          return toolFailure(
            ToolErrorCode.INVALID_ARGS,
            'INVALID_ARGS: mode "knowledge" requires a "topic".',
            false,
          );
        }
        return retrieveUserKnowledge(
          { topic: args.topic, budget: args.budget },
          ctx,
        );

      case 'memory':
        if (!args.memory) {
          return toolFailure(
            ToolErrorCode.INVALID_ARGS,
            'INVALID_ARGS: mode "memory" requires a "memory" object with collection and query.',
            false,
          );
        }
        if (!args.memory.collection || !args.memory.query) {
          return toolFailure(
            ToolErrorCode.INVALID_ARGS,
            'INVALID_ARGS: memory object requires "collection" and "query" fields.',
            false,
          );
        }
        return searchMemory(args.memory, ctx);

      case 'graph':
        if (!args.graph) {
          return toolFailure(
            ToolErrorCode.INVALID_ARGS,
            'INVALID_ARGS: mode "graph" requires a "graph" object with queryType.',
            false,
          );
        }
        if (!args.graph.queryType) {
          return toolFailure(
            ToolErrorCode.INVALID_ARGS,
            'INVALID_ARGS: graph object requires "queryType" ("traverse" or "pattern").',
            false,
          );
        }
        return queryGraph(args.graph, ctx);

      case 'table':
        if (!args.table) {
          return toolFailure(
            ToolErrorCode.INVALID_ARGS,
            'INVALID_ARGS: mode "table" requires a "table" object.',
            false,
          );
        }
        return queryTable(args.table, ctx);

      default:
        return toolFailure(
          ToolErrorCode.INVALID_ARGS,
          `INVALID_ARGS: unknown mode "${args.mode}".`,
          false,
        );
    }
  }

  // Default behavior (no mode): no topic → context, with topic → knowledge
  if (!args.topic) {
    return getUserContext({}, ctx);
  }

  return retrieveUserKnowledge(
    { topic: args.topic, budget: args.budget },
    ctx,
  );
}
