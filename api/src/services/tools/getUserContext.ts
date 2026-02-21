// api/src/services/tools/getUserContext.ts

/**
 * Transport-agnostic service for get_user_context tool.
 *
 * Returns user profile + top entities + recent vectors within ~2000 token budget.
 * Ranked by composite score: relevance x confidence x recency x frequency.
 *
 * KEY BEHAVIOR: Per-section consent failures are silently swallowed.
 * Each section (profile, tables, collections, topEntities, recentMemories)
 * is independently guarded — on consent failure, that section returns empty
 * data instead of failing the entire request.
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { getLatestProfile } from '@/services/profile.service';
import { listTables } from '@/services/table.service';
import { listCollections } from '@/services/vector.service';
import { withUserSchema } from '@/db/client';
import type { ToolContext, ToolResult } from './types.js';
import { toolSuccess } from './types.js';
import { classifyIntent, scoreSourceRelevance, buildRetrievalPlan, type RetrievalPlan } from '@/services/retrieval.service';

export interface GetUserContextArgs {
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

interface TopEntity {
  type: string;
  name: string;
  properties: Record<string, unknown>;
  confidence: number;
  mentionCount: number;
}

interface RecentMemory {
  collection: string;
  text: string;
  metadata: Record<string, unknown>;
  confidence: number | null;
  status: string | null;
  createdAt: Date;
}

interface TableSummary {
  name: string;
  description: string | undefined;
  recordCount: number;
}

interface CollectionSummary {
  name: string;
  description: string | undefined;
  entryCount: number;
}

interface RoutingHints {
  hasStructuredData: boolean;
  hasMemories: boolean;
  hasGraphData: boolean;
  suggestedTools: string[];
}

export interface GetUserContextData {
  profile: Record<string, unknown> | null;
  tables: TableSummary[];
  collections: CollectionSummary[];
  topEntities: TopEntity[];
  recentMemories: RecentMemory[];
  hints: RoutingHints;
  retrievalPlan?: RetrievalPlan;
}

function buildSuggestedTools(
  tables: TableSummary[],
  collections: CollectionSummary[],
  topEntities: TopEntity[],
): string[] {
  const suggestions: string[] = [];
  if (collections.length > 0) {
    const names = collections.map((c) => c.name).join(', ');
    suggestions.push(`recall — user has ${collections.length} vector collection(s): ${names}`);
  }
  if (topEntities.length > 0) {
    suggestions.push(`recall — user has ${topEntities.length} entities in knowledge graph`);
  }
  if (tables.length > 0) {
    const names = tables.map((t) => t.name).join(', ');
    suggestions.push(`recall — user has ${tables.length} table(s): ${names}`);
  }
  if (collections.length === 0 && topEntities.length === 0 && tables.length === 0) {
    suggestions.push('memorize — no data yet, start by saving information the user shares');
  }
  return suggestions;
}

export async function getUserContext(
  args: GetUserContextArgs,
  ctx: ToolContext,
): Promise<ToolResult<GetUserContextData>> {
  const { userId, agentId } = ctx;

  // Top-level consent check — profile/read is the primary purpose.
  // If this fails, we still return success with empty sections (matches legacy behavior).
  try {
    await requireConsent(userId, agentId, 'profile', 'read');
  } catch {
    // No profile consent — return entirely empty but successful response
    return toolSuccess<GetUserContextData>(
      {
        profile: null,
        tables: [],
        collections: [],
        topEntities: [],
        recentMemories: [],
        hints: {
          hasStructuredData: false,
          hasMemories: false,
          hasGraphData: false,
          suggestedTools: ['memorize — no data yet, start by saving information the user shares'],
        },
      },
      'User context retrieved (limited — no profile consent).',
      { warnings: ['No profile read consent — all sections empty.'] },
    );
  }

  // Audit log
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_get_user_context',
    resource: 'profile',
    details: { topic: args.topic },
  });

  // Profile — guarded by the top-level consent check above
  const profileResponse = await getLatestProfile(userId);
  const profile = profileResponse?.data || null;

  const warnings: string[] = [];

  // Tables — only if agent has tables consent
  let tables: TableSummary[] = [];
  try {
    await requireConsent(userId, agentId, 'tables', 'read');
    const raw = await listTables(userId);
    tables = raw.map((t) => ({
      name: t.tableName,
      description: t.description,
      recordCount: t.recordCount,
    }));
  } catch {
    warnings.push('No tables read consent — tables section empty.');
  }

  // Vector collections — only if agent has vectors consent
  let collections: CollectionSummary[] = [];
  try {
    await requireConsent(userId, agentId, 'vectors', 'read');
    const raw = await listCollections(userId);
    collections = raw.map((c) => ({
      name: c.collection,
      description: c.description,
      entryCount: c.entryCount,
    }));
  } catch {
    warnings.push('No vectors read consent — collections section empty.');
  }

  // Graph entities — only if agent has graph consent
  let topEntities: TopEntity[] = [];
  try {
    await requireConsent(userId, agentId, 'graph', 'read');
    topEntities = await withUserSchema(userId, async (tx) => {
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
  } catch {
    warnings.push('No graph read consent — topEntities section empty.');
  }

  // Recent memories/vectors — only if agent has vectors consent
  let recentMemories: RecentMemory[] = [];
  try {
    await requireConsent(userId, agentId, 'vectors', 'read');
    recentMemories = await withUserSchema(userId, async (tx) => {
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
  } catch {
    warnings.push('No vectors read consent — recentMemories section empty.');
  }

  const hints: RoutingHints = {
    hasStructuredData: tables.length > 0,
    hasMemories: collections.length > 0,
    hasGraphData: topEntities.length > 0,
    suggestedTools: buildSuggestedTools(tables, collections, topEntities),
  };

  // Build retrieval plan when topic is provided
  let retrievalPlan: RetrievalPlan | undefined;
  if (args.topic) {
    const intent = classifyIntent(args.topic);
    const scored = scoreSourceRelevance(
      args.topic,
      intent,
      tables.map(t => ({ tableName: t.name, description: t.description })),
      collections.map(c => ({ collection: c.name, description: c.description })),
      profile,
    );
    retrievalPlan = buildRetrievalPlan(intent, scored);
  }

  return toolSuccess<GetUserContextData>(
    { profile, tables, collections, topEntities, recentMemories, hints, retrievalPlan },
    'User context retrieved successfully.',
    warnings.length > 0 ? { warnings } : undefined,
  );
}
