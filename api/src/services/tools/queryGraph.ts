// api/src/services/tools/queryGraph.ts

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { traverseGraph, patternQuery } from '@/mcp/serviceWrappers.js';
import { getFlag } from '@/services/featureFlags';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';
import type { ToolContext, ToolResult } from './types.js';

interface QueryGraphArgs {
  queryType: 'traverse' | 'pattern';
  entityId?: number;
  relation?: string;
  maxHops?: number;
  pattern?:
    | string
    | {
        entityType?: string;
        entityName?: string;
        relation?: string;
        targetType?: string;
      };
}

interface QueryGraphData {
  queryType: string;
  result: unknown;
}

export async function queryGraph(args: QueryGraphArgs, context: ToolContext): Promise<ToolResult<QueryGraphData>> {
  const { userId, agentId } = context;

  try {
    await requireConsent(userId, agentId, 'graph', 'read');
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
    action: 'mcp_query_graph',
    resource: 'graph',
    details: {
      queryType: args.queryType,
      entityId: args.entityId,
      relation: args.relation,
      maxHops: args.maxHops,
      pattern: args.pattern,
    },
  });

  try {
    let result;
    let structuredHint: string | undefined;

    if (args.queryType === 'traverse') {
      if (!args.entityId) {
        return toolFailure(
          ToolErrorCode.INVALID_ARGS,
          'INVALID_ARGS: entityId is required for traverse queries',
          false,
        );
      }

      result = await traverseGraph(userId, args.entityId, {
        relation: args.relation,
        maxHops: Math.min(args.maxHops || 2, 3),
      });
    } else if (args.queryType === 'pattern') {
      if (!args.pattern) {
        return toolFailure(
          ToolErrorCode.INVALID_ARGS,
          'INVALID_ARGS: pattern is required for pattern queries',
          false,
        );
      }

      // When RECALL_STRUCTURED_GRAPH_PREFERRED is enabled and a string pattern
      // is provided, add a hint suggesting structured queries for better results
      if (
        typeof args.pattern === 'string' &&
        getFlag('FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED')
      ) {
        structuredHint = 'Structured graph queries (object pattern with entityType, relation, targetType) are preferred over natural language patterns for more reliable results.';
      }

      result = await patternQuery(userId, args.pattern);
    } else {
      return toolFailure(
        ToolErrorCode.INVALID_ARGS,
        `INVALID_ARGS: Invalid queryType: ${args.queryType}`,
        false,
      );
    }

    const meta = structuredHint
      ? { warnings: [structuredHint] }
      : undefined;

    return toolSuccess(
      { queryType: args.queryType, result },
      `Graph ${args.queryType} query completed`,
      meta,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, message, true);
  }
}
