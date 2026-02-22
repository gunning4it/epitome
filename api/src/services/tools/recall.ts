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
import { listTables } from './listTables.js';
import type { ToolContext, ToolResult } from './types.js';
import { toolFailure, ToolErrorCode } from './types.js';

export interface RecallArgs {
  topic?: string;
  budget?: 'small' | 'medium' | 'deep';
  mode?: 'context' | 'knowledge' | 'memory' | 'graph' | 'table';
  memory?: { collection: string; query: string; minSimilarity?: number; limit?: number };
  graph?: { queryType: 'traverse' | 'pattern'; entityId?: number; relation?: string; maxHops?: number; pattern?: string | { entityType?: string; entityName?: string; relation?: string; targetType?: string } };
  table?: string | { table?: string; tableName?: string; filters?: Record<string, unknown>; sql?: string; limit?: number; offset?: number };
  tableName?: string;
  filters?: Record<string, unknown>;
  sql?: string;
  limit?: number;
  offset?: number;
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
          const hasTopLevelTableQuery =
            typeof args.tableName === 'string' ||
            typeof args.sql === 'string' ||
            (args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters));

          if (!hasTopLevelTableQuery) {
            return listTables({}, ctx);
          }

          return queryTable(
            {
              table: args.tableName,
              sql: args.sql,
              filters: args.filters,
              limit: args.limit,
              offset: args.offset,
            },
            ctx,
          );
        }

        if (typeof args.table === 'string') {
          const table = args.table.trim();
          if (!table) {
            return listTables({}, ctx);
          }
          return queryTable({ table }, ctx);
        }

        if (typeof args.table !== 'object' || Array.isArray(args.table)) {
          return toolFailure(
            ToolErrorCode.INVALID_ARGS,
            'INVALID_ARGS: mode "table" requires a table query object.',
            false,
          );
        }

        const tableArgs = args.table as {
          table?: string;
          tableName?: string;
          sql?: string;
          filters?: Record<string, unknown>;
          limit?: number;
          offset?: number;
        };
        const normalizedTableName =
          (typeof tableArgs.table === 'string' && tableArgs.table.trim()) ||
          (typeof tableArgs.tableName === 'string' && tableArgs.tableName.trim()) ||
          (typeof args.tableName === 'string' && args.tableName.trim()) ||
          undefined;

        const normalizedArgs = {
          table: normalizedTableName,
          sql: tableArgs.sql ?? args.sql,
          filters: tableArgs.filters ?? args.filters,
          limit: tableArgs.limit ?? args.limit,
          offset: tableArgs.offset ?? args.offset,
        };

        const hasFilters =
          normalizedArgs.filters &&
          typeof normalizedArgs.filters === 'object' &&
          !Array.isArray(normalizedArgs.filters) &&
          Object.keys(normalizedArgs.filters).length > 0;
        const hasQuery = Boolean(normalizedArgs.table || normalizedArgs.sql || hasFilters);

        if (!hasQuery) {
          return listTables({}, ctx);
        }

        return queryTable(normalizedArgs, ctx);

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
