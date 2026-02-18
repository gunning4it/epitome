/**
 * MCP Tool: get_user_context
 *
 * Returns user profile + top entities + recent vectors within ~2000 token budget
 * Ranked by composite score: relevance × confidence × recency × frequency
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { getLatestProfile } from '@/services/profile.service';
import { listTables } from '@/services/table.service';
import { listCollections } from '@/services/vector.service';
import { withUserSchema } from '@/db/client';
import type { McpContext } from '../server.js';

interface GetUserContextArgs {
  topic?: string;
}

interface EntityRow {
  type: string;
  name: string;
  properties: Record<string, unknown>;
  confidence: number;
  mention_count: number;
}

interface VectorRow {
  id: number;
  collection: string;
  text: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  confidence: number | null;
  status: string | null;
}

export async function getUserContext(args: GetUserContextArgs, context: McpContext) {
  const { userId, agentId } = context;

  // Consent check
  await requireConsent(userId, agentId, 'profile', 'read');

  // Audit log
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_get_user_context',
    resource: 'profile',
    details: { topic: args.topic },
  });

  // Get profile
  const profile = await getLatestProfile(userId);

  // Get table inventory
  const tables = await listTables(userId);

  // Get vector collections
  const collections = await listCollections(userId);

  // Get top entities by composite score
  const topEntities = await withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe(`
      SELECT
        e.id,
        e.type,
        e.name,
        e.properties,
        e.confidence,
        e.mention_count,
        e.last_seen,
        (
          e.confidence *
          (1.0 + (0.5 * EXP(-EXTRACT(EPOCH FROM (NOW() - e.last_seen)) / (30 * 86400)))) *
          (LOG(e.mention_count + 1) / NULLIF(LOG((SELECT MAX(mention_count) FROM entities WHERE _deleted_at IS NULL) + 1), 0))
        ) AS composite_score
      FROM entities e
      WHERE e._deleted_at IS NULL
      ORDER BY composite_score DESC
      LIMIT 20
    `);

    return (result as unknown as EntityRow[]).map((row) => ({
      type: row.type,
      name: row.name,
      properties: row.properties,
      confidence: row.confidence,
      mentionCount: row.mention_count,
    }));
  });

  // Get recent vectors (last 10 memories)
  const recentMemories = await withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe(`
      SELECT
        v.id,
        v.collection,
        v.text,
        v.metadata,
        v.created_at,
        m.confidence,
        m.status
      FROM vectors v
      LEFT JOIN memory_meta m ON v._meta_id = m.id
      WHERE v._deleted_at IS NULL
      ORDER BY v.created_at DESC
      LIMIT 10
    `);

    return (result as unknown as VectorRow[]).map((row) => ({
      collection: row.collection,
      text: row.text,
      metadata: row.metadata,
      confidence: row.confidence,
      status: row.status,
      createdAt: row.created_at,
    }));
  });

  return {
    profile: profile?.data || null,
    tables: tables.map((t) => ({
      name: t.tableName,
      description: t.description,
      recordCount: t.recordCount,
    })),
    collections: collections.map((c) => ({
      name: c.collection,
      description: c.description,
      entryCount: c.entryCount,
    })),
    topEntities,
    recentMemories,
  };
}
