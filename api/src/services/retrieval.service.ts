/**
 * Retrieval Service — Federated Knowledge Retrieval Engine
 *
 * Fans out across all Epitome data sources (profile, tables, vectors, graph)
 * in parallel and returns fused, deduplicated facts with provenance.
 *
 * Exports:
 *   Pure functions (0ms, no I/O):
 *     - classifyIntent()
 *     - scoreSourceRelevance()
 *     - buildRetrievalPlan()
 *     - fuseFacts()
 *
 *   Async orchestrator:
 *     - retrieveKnowledge()
 *
 * Reference: EPITOME_TECH_SPEC.md §5, §6
 */

import { searchAllVectors } from '@/services/vector.service';
import { getEntityByName, traverse } from '@/services/graphService';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';

// ── Types ──────────────────────────────────────────────────────────────

export type RetrievalBudget = 'small' | 'medium' | 'deep';
export type IntentType = 'factual' | 'timeline' | 'preference' | 'relationship' | 'quantitative' | 'general';
export type SourceType = 'table' | 'vector' | 'graph' | 'profile';

export interface ClassifiedIntent {
  primary: IntentType;
  expandedTerms: string[];
  entityTypeHints: string[];
  relationHints: string[];
}

export interface ScoredSource {
  sourceType: SourceType;
  sourceId: string;
  relevanceScore: number;
  reason: string;
}

export interface RetrievedFact {
  fact: string;
  sourceType: SourceType;
  sourceRef: string;
  confidence: number;
  timestamp?: string;
}

export interface RetrievalResult {
  topic: string;
  intent: ClassifiedIntent;
  budget: RetrievalBudget;
  facts: RetrievedFact[];
  sourcesQueried: string[];
  coverage: number;
  coverageDetails: {
    score: number;
    plannedSources: SourceType[];
    queriedSources: SourceType[];
    missingSources: SourceType[];
  };
  uncertaintyReason?: string;
  warnings: string[];
  timingMs: number;
}

interface RecommendedCall {
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface RetrievalPlan {
  intent: ClassifiedIntent;
  scoredSources: ScoredSource[];
  recommendedCalls: RecommendedCall[];
}

export interface TableMetadata {
  tableName: string;
  description?: string;
  columns?: Array<{ name: string; type: string }>;
  recordCount?: number;
}

export interface CollectionMetadata {
  collection: string;
  description?: string;
  entryCount?: number;
}

interface BudgetConfig {
  maxVectorResults: number;
  vectorMinSimilarity: number;
  maxGraphHops: number;
  maxGraphSeeds: number;
  maxRowsPerTable: number;
  maxTables: number;
  maxTotalFacts: number;
}

// ── Budget Configuration ───────────────────────────────────────────────

export const BUDGET_CONFIG: Record<RetrievalBudget, BudgetConfig> = {
  small:  { maxVectorResults: 5,  vectorMinSimilarity: 0.75, maxGraphHops: 1, maxGraphSeeds: 3,  maxRowsPerTable: 5,  maxTables: 2,  maxTotalFacts: 15 },
  medium: { maxVectorResults: 15, vectorMinSimilarity: 0.7,  maxGraphHops: 2, maxGraphSeeds: 10, maxRowsPerTable: 10, maxTables: 5,  maxTotalFacts: 40 },
  deep:   { maxVectorResults: 30, vectorMinSimilarity: 0.6,  maxGraphHops: 2, maxGraphSeeds: 20, maxRowsPerTable: 20, maxTables: 10, maxTotalFacts: 80 },
};

// ── Synonym Expansion Map ──────────────────────────────────────────────

const SYNONYM_MAP: Record<string, string[]> = {
  food:      ['meal', 'diet', 'restaurant', 'cuisine', 'eating', 'recipe', 'cook', 'dish', 'snack', 'breakfast', 'lunch', 'dinner'],
  book:      ['reading', 'novel', 'author', 'literature', 'read'],
  music:     ['song', 'artist', 'album', 'playlist', 'band', 'genre'],
  work:      ['job', 'career', 'company', 'project', 'meeting', 'colleague', 'office'],
  health:    ['fitness', 'workout', 'exercise', 'medical', 'doctor', 'gym', 'weight'],
  travel:    ['trip', 'vacation', 'destination', 'flight', 'hotel', 'country', 'city'],
  movie:     ['film', 'cinema', 'show', 'series', 'watch', 'tv'],
  hobby:     ['interest', 'pastime', 'activity', 'sport', 'game'],
  family:    ['parent', 'child', 'sibling', 'spouse', 'relative', 'kid', 'mom', 'dad', 'wife', 'husband'],
  friend:    ['buddy', 'pal', 'companion', 'social'],
  pet:       ['dog', 'cat', 'animal'],
  finance:   ['money', 'budget', 'investment', 'savings', 'expense', 'income', 'salary'],
  education: ['school', 'university', 'course', 'degree', 'study', 'learn', 'class'],
};

// ── Intent Classification Patterns ─────────────────────────────────────

const TIMELINE_PATTERNS = /\b(when|last\s+time|history|recently|how\s+long\s+ago|date|ago|latest|previous|first\s+time|ever)\b/i;
const PREFERENCE_PATTERNS = /\b(like|prefer|favorite|enjoy|love|hate|dislike|best|worst|opinion|feel\s+about)\b/i;
const RELATIONSHIP_PATTERNS = /\b(who\s+(does|do|is|are|did)|knows?|friend|family|colleague|connected|relationship|related|together|introduced|met)\b/i;
const QUANTITATIVE_PATTERNS = /\b(how\s+many|how\s+much|count|total|average|frequency|number\s+of|sum|statistics|stats)\b/i;

// ── Pure Functions ─────────────────────────────────────────────────────

/**
 * Classify intent from topic string.
 * Pattern-matches for intent type and expands terms via synonym map.
 */
export function classifyIntent(topic: string): ClassifiedIntent {
  const lower = topic.toLowerCase().trim();

  if (!lower) {
    return { primary: 'general', expandedTerms: [], entityTypeHints: [], relationHints: [] };
  }

  // Determine primary intent (first match wins — order matters)
  let primary: IntentType = 'general';
  if (TIMELINE_PATTERNS.test(lower)) primary = 'timeline';
  else if (PREFERENCE_PATTERNS.test(lower)) primary = 'preference';
  else if (RELATIONSHIP_PATTERNS.test(lower)) primary = 'relationship';
  else if (QUANTITATIVE_PATTERNS.test(lower)) primary = 'quantitative';
  else if (lower.split(/\s+/).length >= 2) primary = 'factual';

  // Expand terms using synonym map
  const expandedTerms: string[] = [];
  const words = lower.split(/\s+/);
  for (const word of words) {
    for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
      if (word === key || synonyms.includes(word)) {
        expandedTerms.push(key, ...synonyms.filter(s => s !== word && !words.includes(s)));
        break;
      }
    }
  }

  // Entity type hints
  const entityTypeHints: string[] = [];
  if (RELATIONSHIP_PATTERNS.test(lower) || /\b(person|people|someone|anyone)\b/i.test(lower)) {
    entityTypeHints.push('person');
  }
  if (/\b(company|organization|team|group)\b/i.test(lower)) {
    entityTypeHints.push('organization');
  }
  if (/\b(place|location|city|country|restaurant)\b/i.test(lower)) {
    entityTypeHints.push('place');
  }

  // Relation hints
  const relationHints: string[] = [];
  if (/\b(work|colleague|employ|hire)\b/i.test(lower)) relationHints.push('works_at', 'works_with');
  if (/\b(friend|know|met)\b/i.test(lower)) relationHints.push('knows', 'friends_with');
  if (/\b(family|parent|child|sibling|married|spouse)\b/i.test(lower)) relationHints.push('family', 'related_to');
  if (/\b(live|reside|located)\b/i.test(lower)) relationHints.push('lives_in', 'located_in');

  return {
    primary,
    expandedTerms: [...new Set(expandedTerms)],
    entityTypeHints: [...new Set(entityTypeHints)],
    relationHints: [...new Set(relationHints)],
  };
}

/**
 * Score how relevant each data source is to the topic.
 * Returns all sources sorted by relevance descending.
 */
export function scoreSourceRelevance(
  topic: string,
  intent: ClassifiedIntent,
  tablesMeta: TableMetadata[],
  collectionsMeta: CollectionMetadata[],
  profile: Record<string, unknown> | null,
): ScoredSource[] {
  const lower = topic.toLowerCase();
  const terms = [lower, ...lower.split(/\s+/), ...intent.expandedTerms].filter(Boolean);
  const uniqueTerms = [...new Set(terms)];
  const sources: ScoredSource[] = [];

  // Score tables
  for (const table of tablesMeta) {
    let score = 0.2;
    let reason = 'default table source';

    const tableLower = table.tableName.toLowerCase();
    const descLower = (table.description || '').toLowerCase();

    if (uniqueTerms.some(t => tableLower === t)) {
      score = Math.max(score, 0.9);
      reason = 'table name matches topic';
    } else if (uniqueTerms.some(t => tableLower.includes(t) || t.includes(tableLower))) {
      score = Math.max(score, 0.7);
      reason = 'table name partially matches topic';
    } else if (uniqueTerms.some(t => descLower.includes(t))) {
      score = Math.max(score, 0.5);
      reason = 'table description matches topic';
    }

    if (intent.primary === 'quantitative') score = Math.min(score + 0.1, 1.0);
    if (intent.primary === 'timeline') score = Math.min(score + 0.05, 1.0);

    sources.push({ sourceType: 'table', sourceId: table.tableName, relevanceScore: score, reason });
  }

  // Score collections
  for (const coll of collectionsMeta) {
    let score = 0.3;
    let reason = 'default vector source';

    const collLower = coll.collection.toLowerCase();
    const descLower = (coll.description || '').toLowerCase();

    if (uniqueTerms.some(t => collLower === t)) {
      score = Math.max(score, 0.85);
      reason = 'collection name matches topic';
    } else if (uniqueTerms.some(t => collLower.includes(t) || t.includes(collLower))) {
      score = Math.max(score, 0.65);
      reason = 'collection name partially matches topic';
    } else if (uniqueTerms.some(t => descLower.includes(t))) {
      score = Math.max(score, 0.5);
      reason = 'collection description matches topic';
    }

    if (intent.primary === 'preference' || intent.primary === 'factual') {
      score = Math.min(score + 0.1, 1.0);
    }

    sources.push({ sourceType: 'vector', sourceId: coll.collection, relevanceScore: score, reason });
  }

  // Score graph
  const graphScore = (() => {
    if (intent.primary === 'relationship') return 0.9;
    if (intent.relationHints.length > 0) return 0.7;
    if (intent.entityTypeHints.length > 0) return 0.6;
    return 0.4;
  })();
  sources.push({
    sourceType: 'graph',
    sourceId: 'knowledge_graph',
    relevanceScore: graphScore,
    reason: intent.primary === 'relationship'
      ? 'relationship intent matches graph'
      : intent.entityTypeHints.length > 0
        ? 'entity type hints suggest graph data'
        : 'knowledge graph as supplementary source',
  });

  // Score profile
  if (profile) {
    let profileScore = 0.3;
    let reason = 'default profile source';

    const profileKeys = Object.keys(profile).map(k => k.toLowerCase());
    const profileValues = Object.values(profile)
      .filter((v): v is string => typeof v === 'string')
      .map(v => v.toLowerCase());

    if (uniqueTerms.some(t => profileKeys.includes(t))) {
      profileScore = 0.8;
      reason = 'profile has matching key';
    } else if (uniqueTerms.some(t => profileKeys.some(k => k.includes(t)))) {
      profileScore = 0.6;
      reason = 'profile has partially matching key';
    } else if (uniqueTerms.some(t => profileValues.some(v => v.includes(t)))) {
      profileScore = 0.5;
      reason = 'profile has matching value';
    }

    if (intent.primary === 'preference') profileScore = Math.min(profileScore + 0.1, 1.0);

    sources.push({ sourceType: 'profile', sourceId: 'user_profile', relevanceScore: profileScore, reason });
  }

  return sources.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Build a retrieval plan with recommended tool calls.
 * Used by getUserContext to guide weak planners.
 */
export function buildRetrievalPlan(
  intent: ClassifiedIntent,
  scoredSources: ScoredSource[],
): RetrievalPlan {
  const recommendedCalls: RecommendedCall[] = [];

  // Always recommend the federated retrieval tool as primary
  recommendedCalls.push({
    tool: 'recall',
    args: { topic: '<user_topic>', budget: 'medium' },
    reason: 'Single call that searches all data sources in parallel',
  });

  // Also recommend mode-specific recall calls for high-scoring sources
  for (const source of scoredSources.filter(s => s.relevanceScore >= 0.5)) {
    switch (source.sourceType) {
      case 'vector':
        recommendedCalls.push({
          tool: 'recall',
          args: { mode: 'memory', memory: { collection: source.sourceId, query: '<user_topic>' } },
          reason: source.reason,
        });
        break;
      case 'table':
        recommendedCalls.push({
          tool: 'recall',
          args: { mode: 'table', table: { table: source.sourceId, filters: {}, limit: 20 } },
          reason: source.reason,
        });
        break;
      case 'graph':
        recommendedCalls.push({
          tool: 'recall',
          args: { mode: 'graph', graph: { queryType: 'pattern', pattern: '<user_topic>' } },
          reason: source.reason,
        });
        break;
    }
  }

  return { intent, scoredSources, recommendedCalls };
}

/**
 * Normalize a fact string for dedup comparison.
 */
function normalizeFact(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Fuse facts: normalize, dedup, corroboration boost, sort by confidence.
 */
export function fuseFacts(facts: RetrievedFact[], maxFacts?: number): RetrievedFact[] {
  if (facts.length === 0) return [];

  const deduped: Array<RetrievedFact & { _norm: string; _sources: Set<SourceType> }> = [];

  for (const fact of facts) {
    const norm = normalizeFact(fact.fact);

    const existing = deduped.find(d => {
      if (d._norm === norm) return true;
      // Substring containment for meaningful-length strings
      if (d._norm.length > 20 && norm.length > 20) {
        if (d._norm.includes(norm) || norm.includes(d._norm)) return true;
      }
      return false;
    });

    if (existing) {
      // Keep higher confidence version
      if (fact.confidence > existing.confidence) {
        existing.fact = fact.fact;
        existing.confidence = fact.confidence;
        existing.sourceRef = fact.sourceRef;
      }
      existing._sources.add(fact.sourceType);
      // Cross-source corroboration boost
      if (existing._sources.size > 1 && existing.confidence < 0.95) {
        existing.confidence = Math.min(existing.confidence + 0.1, 0.95);
      }
    } else {
      deduped.push({ ...fact, _norm: norm, _sources: new Set([fact.sourceType]) });
    }
  }

  // Sort: confidence desc, then timestamp desc (recent first)
  deduped.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.timestamp && b.timestamp) return b.timestamp.localeCompare(a.timestamp);
    return 0;
  });

  const limit = maxFacts ?? Infinity;
  return deduped.slice(0, limit).map(({ _norm, _sources, ...f }) => f);
}

// ── Internal Retrieval Helpers ─────────────────────────────────────────

/** Escape ILIKE special characters */
function escapeILIKE(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Escape single quotes for SQL string literals */
function escapeSQLString(str: string): string {
  return str.replace(/'/g, "''");
}

async function retrieveFromVectors(
  userId: string,
  topic: string,
  config: BudgetConfig,
  selectedCollections: string[],
  consentChecker: (resource: string, permission: string) => Promise<boolean>,
): Promise<RetrievedFact[]> {
  const hasConsent = await consentChecker('vectors', 'read');
  if (!hasConsent) return [];

  const results = await searchAllVectors(userId, topic, config.maxVectorResults, config.vectorMinSimilarity);

  // Filter to selected collections if specifically scored
  const filtered = selectedCollections.length > 0
    ? results.filter(r => selectedCollections.includes(r.collection))
    : results;

  return filtered.map(r => ({
    fact: r.text,
    sourceType: 'vector' as SourceType,
    sourceRef: `vectors/${r.collection}#${r.id}`,
    confidence: r.similarity * (r.confidence ?? 1),
    timestamp: r.createdAt?.toISOString(),
  }));
}

async function retrieveFromGraph(
  userId: string,
  topic: string,
  _intent: ClassifiedIntent,
  config: BudgetConfig,
  consentChecker: (resource: string, permission: string) => Promise<boolean>,
): Promise<RetrievedFact[]> {
  const hasConsent = await consentChecker('graph', 'read');
  if (!hasConsent) return [];

  const entities = await getEntityByName(userId, topic, undefined, 0.3, config.maxGraphSeeds);
  const facts: RetrievedFact[] = [];

  // Convert found entities to facts
  for (const entity of entities) {
    facts.push({
      fact: `${entity.name} (${entity.type})`,
      sourceType: 'graph',
      sourceRef: `graph/entity/${entity.id}`,
      confidence: entity.similarity ?? 0.5,
      timestamp: entity.lastSeen?.toISOString(),
    });
  }

  // For top seeds with high similarity, traverse relationships
  const topSeeds = entities
    .filter(e => (e.similarity ?? 0) > 0.5)
    .slice(0, 5);

  const traversalPromises = topSeeds.map(async (seed) => {
    try {
      const paths = await traverse(userId, seed.id, {
        maxDepth: config.maxGraphHops,
        limit: 20,
      });
      // Filter out the start node itself
      return paths
        .filter(node => node.id !== seed.id)
        .map(node => ({
          fact: `${seed.name} → ${node.type} → ${node.name}`,
          sourceType: 'graph' as SourceType,
          sourceRef: `graph/traverse/${seed.id}→${node.id}`,
          confidence: (seed.similarity ?? 0.5) * 0.8,
        }));
    } catch {
      return [];
    }
  });

  const traversalResults = await Promise.allSettled(traversalPromises);
  for (const result of traversalResults) {
    if (result.status === 'fulfilled') {
      facts.push(...result.value);
    }
  }

  return facts;
}

async function retrieveFromTables(
  userId: string,
  topic: string,
  intent: ClassifiedIntent,
  config: BudgetConfig,
  selectedTables: string[],
  tablesMeta: TableMetadata[],
  consentChecker: (resource: string, permission: string) => Promise<boolean>,
): Promise<RetrievedFact[]> {
  const hasConsent = await consentChecker('tables', 'read');
  if (!hasConsent) return [];

  const facts: RetrievedFact[] = [];
  const terms = [topic, ...intent.expandedTerms].filter(Boolean);
  const searchTerm = escapeSQLString(escapeILIKE(terms[0] || topic));

  for (const tableName of selectedTables.slice(0, config.maxTables)) {
    try {
      // Find text columns from metadata
      const meta = tablesMeta.find(t => t.tableName === tableName);
      const textCols = meta?.columns
        ?.filter(c => /text|varchar|char/i.test(c.type))
        .map(c => c.name) ?? [];

      let sql: string;
      if (textCols.length > 0) {
        // Build ILIKE conditions across text columns
        const conditions = textCols
          .map(col => `"${col}" ILIKE '%${searchTerm}%'`)
          .join(' OR ');
        sql = `SELECT * FROM "${tableName}" WHERE ${conditions} LIMIT ${config.maxRowsPerTable}`;
      } else {
        // No text columns — fall back to recent rows
        sql = `SELECT * FROM "${tableName}" ORDER BY created_at DESC LIMIT ${config.maxRowsPerTable}`;
      }

      const result = await executeSandboxedQuery(userId, sql, 10, config.maxRowsPerTable);

      for (const row of result.rows) {
        const factParts: string[] = [];
        for (const [key, value] of Object.entries(row)) {
          if (value != null && key !== 'id' && key !== 'created_at' && key !== 'updated_at' && key !== '_deleted_at') {
            factParts.push(`${key}: ${String(value)}`);
          }
        }
        if (factParts.length > 0) {
          facts.push({
            fact: factParts.join(', '),
            sourceType: 'table',
            sourceRef: `tables/${tableName}`,
            confidence: 0.7,
            timestamp: (row.created_at as string | undefined) ?? undefined,
          });
        }
      }
    } catch {
      // Individual table failure shouldn't block others
    }
  }

  return facts;
}

function retrieveFromProfile(
  topic: string,
  intent: ClassifiedIntent,
  profile: Record<string, unknown> | null,
): RetrievedFact[] {
  if (!profile) return [];

  const facts: RetrievedFact[] = [];
  const lower = topic.toLowerCase();
  const terms = [lower, ...lower.split(/\s+/), ...intent.expandedTerms].filter(Boolean);
  const uniqueTerms = [...new Set(terms)];

  for (const [key, value] of Object.entries(profile)) {
    const keyLower = key.toLowerCase();
    const isMatch = uniqueTerms.some(t => keyLower.includes(t) || t.includes(keyLower));

    if (isMatch) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // One level deep for object values
        for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
          if (subValue != null) {
            facts.push({
              fact: `${key}.${subKey}: ${String(subValue)}`,
              sourceType: 'profile',
              sourceRef: `profile/${key}/${subKey}`,
              confidence: 0.9,
            });
          }
        }
      } else if (value != null) {
        facts.push({
          fact: `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
          sourceType: 'profile',
          sourceRef: `profile/${key}`,
          confidence: 0.9,
        });
      }
    }
  }

  return facts;
}

// ── Async Orchestrator ─────────────────────────────────────────────────

/**
 * Fan out across all data sources, fuse results, return unified facts.
 *
 * IMPORTANT: Does not call withUserSchema() directly — each service function
 * manages its own transaction to avoid deadlocks.
 */
export async function retrieveKnowledge(
  userId: string,
  topic: string,
  budget: RetrievalBudget,
  consentChecker: (resource: string, permission: string) => Promise<boolean>,
  tablesMeta: TableMetadata[],
  collectionsMeta: CollectionMetadata[],
  profile: Record<string, unknown> | null,
): Promise<RetrievalResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const sourcesQueried: SourceType[] = [];
  let allFacts: RetrievedFact[] = [];

  const intent = classifyIntent(topic);
  const scoredSources = scoreSourceRelevance(topic, intent, tablesMeta, collectionsMeta, profile);
  const config = BUDGET_CONFIG[budget];

  // Select sources based on scoring
  const selectedTables = scoredSources
    .filter(s => s.sourceType === 'table' && s.relevanceScore >= 0.3)
    .slice(0, config.maxTables)
    .map(s => s.sourceId);

  const selectedCollections = scoredSources
    .filter(s => s.sourceType === 'vector')
    .map(s => s.sourceId);

  const useGraph = scoredSources.some(s => s.sourceType === 'graph' && s.relevanceScore >= 0.3);
  const useProfile = scoredSources.some(s => s.sourceType === 'profile' && s.relevanceScore >= 0.3);

  // Parallel retrieval via Promise.allSettled
  const [vectorResult, graphResult, tableResult, profileResult] = await Promise.allSettled([
    retrieveFromVectors(userId, topic, config, selectedCollections, consentChecker),
    useGraph
      ? retrieveFromGraph(userId, topic, intent, config, consentChecker)
      : Promise.resolve([]),
    selectedTables.length > 0
      ? retrieveFromTables(userId, topic, intent, config, selectedTables, tablesMeta, consentChecker)
      : Promise.resolve([]),
    useProfile
      ? Promise.resolve(retrieveFromProfile(topic, intent, profile))
      : Promise.resolve([]),
  ]);

  // Collect results and warnings
  if (vectorResult.status === 'fulfilled') {
    allFacts.push(...vectorResult.value);
    sourcesQueried.push('vector');
  } else {
    warnings.push(`Vector search failed: ${vectorResult.reason}`);
  }

  if (graphResult.status === 'fulfilled') {
    allFacts.push(...graphResult.value);
    if (useGraph) sourcesQueried.push('graph');
  } else {
    warnings.push(`Graph search failed: ${graphResult.reason}`);
  }

  if (tableResult.status === 'fulfilled') {
    allFacts.push(...tableResult.value);
    if (selectedTables.length > 0) sourcesQueried.push('table');
  } else {
    warnings.push(`Table search failed: ${tableResult.reason}`);
  }

  if (profileResult.status === 'fulfilled') {
    allFacts.push(...profileResult.value);
    if (useProfile) sourcesQueried.push('profile');
  } else {
    warnings.push(`Profile search failed: ${profileResult.reason}`);
  }

  // Progressive deepening: if small budget yields < 3 facts, upgrade vector search
  if (budget === 'small' && allFacts.length < 3) {
    const mediumConfig = BUDGET_CONFIG.medium;
    try {
      const moreFacts = await retrieveFromVectors(
        userId, topic, mediumConfig, selectedCollections, consentChecker,
      );
      allFacts.push(...moreFacts);
      warnings.push('Auto-upgraded vector search depth due to low initial results');
    } catch {
      // Ignore — keep what we have
    }
  }

  // Fuse, dedup, and truncate
  const fused = fuseFacts(allFacts, config.maxTotalFacts);

  const plannedSources: SourceType[] = ['vector'];
  if (selectedTables.length > 0) plannedSources.push('table');
  if (useGraph) plannedSources.push('graph');
  if (useProfile) plannedSources.push('profile');
  const queriedSources = [...new Set(sourcesQueried)];
  const missingSources = plannedSources.filter((source) => !queriedSources.includes(source));
  const coverageScore = plannedSources.length > 0 ? queriedSources.length / plannedSources.length : 0;

  let uncertaintyReason: string | undefined;
  if (fused.length === 0) {
    uncertaintyReason = 'No corroborated facts matched the query across permitted sources.';
  } else if (coverageScore < 0.6 && missingSources.length > 0) {
    uncertaintyReason = `Partial source coverage; missing or empty sources: ${missingSources.join(', ')}`;
  } else if (warnings.length > 0) {
    uncertaintyReason = 'Some retrieval sources returned warnings; confidence may be partial.';
  }

  return {
    topic,
    intent,
    budget,
    facts: fused,
    sourcesQueried: queriedSources,
    coverage: coverageScore,
    coverageDetails: {
      score: coverageScore,
      plannedSources,
      queriedSources,
      missingSources,
    },
    uncertaintyReason,
    warnings,
    timingMs: Date.now() - startTime,
  };
}
