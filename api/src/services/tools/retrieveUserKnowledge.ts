/**
 * Transport-agnostic service for retrieve_user_knowledge tool.
 *
 * Fans out across all data sources (profile, tables, vectors, graph)
 * in parallel and returns fused, deduplicated facts with provenance.
 *
 * Pattern: consent → audit → load metadata → delegate → return ToolResult
 */

import { requireConsent, checkConsent, checkDomainConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { listTables } from '@/services/table.service';
import { listCollections } from '@/services/vector.service';
import { getLatestProfile } from '@/services/profile.service';
import {
  retrieveKnowledge,
  type RetrievalBudget,
  type RetrievalResult,
  type TableMetadata,
  type CollectionMetadata,
} from '@/services/retrieval.service';
import type { ToolContext, ToolResult } from './types.js';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';

export interface RetrieveUserKnowledgeArgs {
  topic: string;
  budget?: RetrievalBudget;
}

export async function retrieveUserKnowledge(
  args: RetrieveUserKnowledgeArgs,
  ctx: ToolContext,
): Promise<ToolResult<RetrievalResult>> {
  const { userId, agentId } = ctx;
  const topic = args.topic;
  const budget: RetrievalBudget = args.budget || 'medium';

  // Top-level consent check
  try {
    await requireConsent(userId, agentId, 'profile', 'read');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CONSENT_DENIED')) {
      return toolFailure(ToolErrorCode.CONSENT_DENIED, error.message, false);
    }
    throw error;
  }

  // Audit
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_recall',
    resource: 'profile',
    details: { topic, budget },
  });

  // Load metadata (each guarded — failures are non-fatal)
  const warnings: string[] = [];

  let tablesMeta: TableMetadata[] = [];
  try {
    const raw = await listTables(userId);
    tablesMeta = raw.map(t => ({
      tableName: t.tableName,
      description: t.description,
      columns: t.columns?.map(c => ({ name: c.name, type: c.type })),
      recordCount: t.recordCount,
    }));
  } catch {
    warnings.push('Could not load table metadata');
  }

  let collectionsMeta: CollectionMetadata[] = [];
  try {
    const raw = await listCollections(userId);
    collectionsMeta = raw.map(c => ({
      collection: c.collection,
      description: c.description,
      entryCount: c.entryCount,
    }));
  } catch {
    warnings.push('Could not load collection metadata');
  }

  let profile: Record<string, unknown> | null = null;
  try {
    const profileResult = await getLatestProfile(userId);
    profile = profileResult?.data || null;
  } catch {
    warnings.push('Could not load profile');
  }

  // Build consent checker callback
  const consentChecker = async (resource: string, permission: string): Promise<boolean> => {
    const typedPermission = permission as 'read' | 'write';
    if (resource === 'tables' || resource === 'vectors' || resource === 'graph') {
      return checkDomainConsent(userId, agentId, resource, typedPermission);
    }
    return checkConsent(userId, agentId, resource, typedPermission);
  };

  // Execute retrieval
  try {
    const result = await retrieveKnowledge(
      userId, topic, budget, consentChecker, tablesMeta, collectionsMeta, profile,
    );

    // Merge metadata loading warnings
    result.warnings.push(...warnings);

    return toolSuccess(
      result,
      `Retrieved ${result.facts.length} facts about "${topic}"`,
      result.warnings.length > 0 ? { warnings: result.warnings } : undefined,
    );
  } catch (error) {
    return toolFailure(
      ToolErrorCode.INTERNAL_ERROR,
      `Retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}
