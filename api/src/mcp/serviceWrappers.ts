/**
 * MCP Service Wrappers
 *
 * Convenience wrappers around existing services for MCP tools
 * Maps MCP-friendly function names to actual service implementations
 */

import {
  insertRecord,
  queryRecords,
  TableRecord,
} from '@/services/table.service';
import { traverse, queryPattern, queryPatternStructured } from '@/services/graphService';
import {
  getMemoriesNeedingReview,
  resolveReview,
} from '@/services/memoryQuality.service';

/**
 * Add a record to a table (wrapper for insertRecord)
 */
export async function addTableRecord(
  userId: string,
  tableName: string,
  data: Record<string, any>,
  meta?: {
    origin?: 'user_typed' | 'user_stated' | 'ai_stated' | 'ai_inferred' | 'ai_pattern' | 'imported';
    agentSource?: string;
  },
  tableDescription?: string
): Promise<number> {
  return insertRecord(
    userId,
    tableName,
    data,
    meta?.agentSource || 'user',
    meta?.origin || 'user_typed',
    tableDescription
  );
}

/**
 * Query table records (wrapper for queryRecords)
 */
export async function queryTableRecords(
  userId: string,
  tableName: string,
  options?: {
    filters?: Record<string, any>;
    limit?: number;
    offset?: number;
  }
): Promise<TableRecord[]> {
  return queryRecords(
    userId,
    tableName,
    options?.filters || {},
    options?.limit,
    options?.offset
  );
}

/**
 * Traverse graph from an entity (wrapper for traverse)
 */
export async function traverseGraph(
  userId: string,
  entityId: number,
  options?: {
    relation?: string;
    maxHops?: number;
  }
) {
  return traverse(userId, entityId, {
    relationFilter: options?.relation,
    maxDepth: options?.maxHops || 2,
  });
}

/**
 * Pattern-based graph query (wrapper for queryPattern)
 */
export async function patternQuery(
  userId: string,
  pattern:
    | string
    | {
        entityType?: string;
        entityName?: string;
        relation?: string;
        targetType?: string;
      }
) {
  if (typeof pattern === 'string') {
    return queryPattern(userId, {
      pattern,
      limit: 20,
    });
  }

  return queryPatternStructured(userId, {
    entityType: pattern.entityType,
    entityName: pattern.entityName,
    relation: pattern.relation,
    targetType: pattern.targetType,
    limit: 20,
  });
}

/**
 * Get memory contradictions (wrapper for getMemoriesNeedingReview)
 */
export async function getContradictions(
  userId: string,
  _options?: {
    limit?: number;
  }
) {
  return getMemoriesNeedingReview(userId);
}

/**
 * Resolve a contradiction (wrapper for resolveReview)
 */
export async function resolveContradiction(
  userId: string,
  metaId: number,
  resolution: 'confirm' | 'reject' | 'keep_both',
  _meta?: {
    resolvedBy?: string;
  }
) {
  return resolveReview(userId, metaId, resolution);
}
