// api/src/services/tools/memorize.ts

/**
 * Facade: memorize — save or delete a fact, experience, or event.
 *
 * Routing logic:
 *   1. Validate text (empty → INVALID_ARGS)
 *   2. action === 'delete'    → semantic search + soft-delete matches
 *   3. storage === 'memory'   → saveMemory (vector-only, unstructured)
 *   4. category === 'profile' → updateProfile
 *   5. default                → addRecord (dual-writes table + auto-vectorized memory)
 *
 * After a save, checks for pending contradictions and attaches a warning
 * so the LLM can immediately prompt the user to resolve.
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { searchAllVectors, deleteVector } from '@/services/vector.service';
import { getContradictions } from '@/mcp/serviceWrappers.js';
import { updateProfile } from './updateProfile.js';
import { addRecord } from './addRecord.js';
import { saveMemory } from './saveMemory.js';
import { logger } from '@/utils/logger';
import type { ToolContext, ToolResult } from './types.js';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';

export interface MemorizeArgs {
  text: string;
  category?: string;
  data?: Record<string, unknown>;
  action?: 'save' | 'delete';
  storage?: 'record' | 'memory';
  collection?: string;
  metadata?: Record<string, unknown>;
}

const SIMILARITY_THRESHOLD_FOR_DELETE = 0.8;
const DELETE_SEARCH_LIMIT = 5;

export async function memorize(
  args: MemorizeArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { userId, agentId } = ctx;
  const category = args.category || 'memories';
  const action = args.action || 'save';

  if (!args.text) {
    return toolFailure(
      ToolErrorCode.INVALID_ARGS,
      'INVALID_ARGS: memorize requires "text".',
      false,
    );
  }

  // ── Delete path ──────────────────────────────────────────────────────
  if (action === 'delete') {
    try {
      await requireConsent(userId, agentId, 'vectors', 'write');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('CONSENT_DENIED')) {
        return toolFailure(ToolErrorCode.CONSENT_DENIED, msg, false);
      }
      return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
    }

    await logAuditEntry(userId, {
      agentId,
      action: 'mcp_memorize_delete',
      resource: `vectors/${category}`,
      details: { text: args.text, category },
    });

    try {
      // Semantic search for matching memories
      const results = await searchAllVectors(
        userId,
        args.text,
        DELETE_SEARCH_LIMIT,
        SIMILARITY_THRESHOLD_FOR_DELETE,
      );

      let deletedCount = 0;
      const deletedRefs: string[] = [];

      for (const match of results) {
        try {
          await deleteVector(userId, match.id);
          deletedCount++;
          deletedRefs.push(`vectors/${match.collection}#${match.id}`);
        } catch (err) {
          logger.warn('memorize delete: vector soft-delete failed', {
            vectorId: match.id,
            error: String(err),
          });
        }
      }

      return toolSuccess(
        { deleted: deletedCount, sourceRefs: deletedRefs },
        `Deleted ${deletedCount} matching memory/memories.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('memorize delete error', { error: msg, userId });
      return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
    }
  }

  // ── Vector-only memory path ─────────────────────────────────────────
  if (args.storage === 'memory') {
    const collection = args.collection || category;
    const metadata = args.metadata || args.data;
    return saveMemory(
      { collection, text: args.text, metadata },
      ctx,
    );
  }

  // ── Profile path ─────────────────────────────────────────────────────
  if (category === 'profile') {
    const profileData = args.data || { text: args.text };
    return updateProfile(
      { data: profileData, reason: args.text },
      ctx,
    );
  }

  // ── Default save path (addRecord dual-write) ────────────────────────
  const tableData = args.data || { text: args.text };
  const result = await addRecord(
    { table: category, data: tableData },
    ctx,
  );

  // Non-blocking: check for pending contradictions and attach warning
  if (result.success) {
    try {
      const contradictions = await getContradictions(userId, { limit: 1 });
      if (contradictions.length > 0) {
        result.meta = result.meta || {};
        result.meta.warnings = result.meta.warnings || [];
        result.meta.warnings.push(
          'Contradiction detected. Run review(action: "list") to resolve.',
        );
      }
    } catch {
      // Contradiction check is best-effort — don't fail the save
    }
  }

  return result;
}
