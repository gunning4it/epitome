/**
 * MCP Tool: query_graph
 *
 * Graph traversal and pattern-based queries
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { traverseGraph, patternQuery } from '../serviceWrappers.js';
import type { McpContext } from '../server.js';

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

export async function queryGraph(args: QueryGraphArgs, context: McpContext) {
  const { userId, agentId } = context;

  // Consent check
  await requireConsent(userId, agentId, 'graph', 'read');

  // Audit log
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

  let result;

  if (args.queryType === 'traverse') {
    if (!args.entityId) {
      throw new Error('INVALID_ARGS: entityId is required for traverse queries');
    }

    result = await traverseGraph(userId, args.entityId, {
      relation: args.relation,
      maxHops: Math.min(args.maxHops || 2, 3), // Max 3 hops
    });
  } else if (args.queryType === 'pattern') {
    if (!args.pattern) {
      throw new Error('INVALID_ARGS: pattern is required for pattern queries');
    }

    result = await patternQuery(userId, args.pattern);
  } else {
    throw new Error(`INVALID_ARGS: Invalid queryType: ${args.queryType}`);
  }

  return {
    queryType: args.queryType,
    result,
  };
}
