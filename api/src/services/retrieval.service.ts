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
import { getEntityByName, traverse, getNeighbors } from '@/services/graphService';
import { executeSandboxedQuery } from '@/services/sqlSandbox.service';
import { getFlag } from '@/services/featureFlags';

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
  family:    ['parent', 'child', 'sibling', 'spouse', 'relative', 'kid', 'mom', 'dad', 'wife', 'husband', 'daughter', 'son', 'brother', 'sister', 'uncle', 'aunt', 'cousin', 'grandparent', 'grandmother', 'grandfather'],
  friend:    ['buddy', 'pal', 'companion', 'social'],
  pet:       ['dog', 'cat', 'animal'],
  finance:   ['money', 'budget', 'investment', 'savings', 'expense', 'income', 'salary'],
  education: ['school', 'university', 'course', 'degree', 'study', 'learn', 'class'],
};

// ── Intent Classification Patterns ─────────────────────────────────────

const TIMELINE_PATTERNS = /\b(when|last\s+time|history|recently|how\s+long\s+ago|date|ago|latest|previous|first\s+time|ever)\b/i;
const PREFERENCE_PATTERNS = /\b(like|prefer|favorite|enjoy|love|hate|dislike|best|worst|opinion|feel\s+about)\b/i;
const RELATIONSHIP_PATTERNS = /\b(who\s+(does|do|is|are|did)|knows?|friend|family|colleague|connected|relationship|related|together|introduced|met|daughter|son|wife|husband|spouse|partner|mother|father|parent|child|children|sibling|brother|sister|uncle|aunt|cousin|grandparent|grandmother|grandfather)\b/i;
const QUANTITATIVE_PATTERNS = /\b(how\s+many|how\s+much|count|total|average|frequency|number\s+of|sum|statistics|stats)\b/i;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'in',
  'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'that',
  'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'with',
  'you', 'your',
]);

const TIMELINE_EXCEPTION_PATTERNS = /\b(reading\s+history|book\s+history|books\s+history)\b/i;
const MAX_PROFILE_FACT_DEPTH = 3;
const MAX_PROFILE_FACTS = 30;

const POSSESSIVE_ROLE_PATTERNS = /\bmy\s+(daughter|son|wife|husband|spouse|partner|mother|father|parent|child|children|sibling|brother|sister|uncle|aunt|cousin|grandparent|grandmother|grandfather)\b/i;

const ROLE_TO_RELATION: Record<string, string[]> = {
  daughter: ['family_member', 'parent_of'],
  son: ['family_member', 'parent_of'],
  wife: ['family_member', 'married_to'],
  husband: ['family_member', 'married_to'],
  spouse: ['family_member', 'married_to'],
  partner: ['family_member', 'married_to'],
  mother: ['family_member'],
  father: ['family_member'],
  parent: ['family_member'],
  child: ['family_member', 'parent_of'],
  children: ['family_member', 'parent_of'],
  sibling: ['family_member'],
  brother: ['family_member'],
  sister: ['family_member'],
  uncle: ['family_member'],
  aunt: ['family_member'],
  cousin: ['family_member'],
  grandparent: ['family_member'],
  grandmother: ['family_member'],
  grandfather: ['family_member'],
};

function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(token: string): string {
  if (!token) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function isMeaningfulToken(token: string): boolean {
  return token.length >= 2 && !STOP_WORDS.has(token);
}

function buildSearchTerms(topic: string, expandedTerms: string[] = []): string[] {
  const topicTokens = normalizeSearchText(topic)
    .split(/\s+/)
    .map(normalizeToken)
    .filter(isMeaningfulToken);

  const expandedTokens = expandedTerms
    .flatMap((term) => normalizeSearchText(term).split(/\s+/))
    .map(normalizeToken)
    .filter(isMeaningfulToken);

  const merged = [...new Set([...topicTokens, ...expandedTokens])];
  if (merged.length > 0) return merged;

  const normalizedTopic = normalizeSearchText(topic);
  return normalizedTopic ? [normalizedTopic] : [];
}

function textMatchesTerms(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const normalizedText = normalizeSearchText(text);
  return terms.some((term) => normalizedText.includes(term));
}

interface FlattenedProfileFact {
  path: string;
  value: string;
}

function flattenProfileValue(
  value: unknown,
  path: string,
  depth = 0,
): FlattenedProfileFact[] {
  if (value == null) return [];
  if (depth > MAX_PROFILE_FACT_DEPTH) return [];

  if (Array.isArray(value)) {
    const flattened = value.flatMap((item, index) =>
      flattenProfileValue(item, `${path}[${index}]`, depth + 1),
    );
    return flattened.length > 0 ? flattened : [{ path, value: '[]' }];
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const flattened = entries.flatMap(([key, nested]) =>
      flattenProfileValue(nested, `${path}.${key}`, depth + 1),
    );
    return flattened.length > 0 ? flattened : [{ path, value: '{}' }];
  }

  return [{ path, value: String(value) }];
}

// ── Pure Functions ─────────────────────────────────────────────────────

/**
 * Classify intent from topic string.
 * Pattern-matches for intent type and expands terms via synonym map.
 */
export function classifyIntent(topic: string): ClassifiedIntent {
  const lower = normalizeSearchText(topic);

  if (!lower) {
    return { primary: 'general', expandedTerms: [], entityTypeHints: [], relationHints: [] };
  }

  // Declare all output variables at top
  let primary: IntentType = 'general';
  const expandedTerms: string[] = [];
  const entityTypeHints: string[] = [];
  const relationHints: string[] = [];

  // Possessive role detection ("my daughter", "my wife") — runs first
  const possessiveMatch = lower.match(POSSESSIVE_ROLE_PATTERNS);
  if (possessiveMatch) {
    const role = possessiveMatch[1].toLowerCase();
    primary = 'relationship'; // Override — family queries are always relationship intent
    entityTypeHints.push('person');
    const relations = ROLE_TO_RELATION[role] || ['family_member'];
    relationHints.push(...relations);
    expandedTerms.push(role);
  }

  // Determine primary intent (only if possessive didn't already set it)
  if (!possessiveMatch) {
    if (TIMELINE_PATTERNS.test(lower) && !TIMELINE_EXCEPTION_PATTERNS.test(lower)) primary = 'timeline';
    else if (PREFERENCE_PATTERNS.test(lower)) primary = 'preference';
    else if (RELATIONSHIP_PATTERNS.test(lower)) primary = 'relationship';
    else if (QUANTITATIVE_PATTERNS.test(lower)) primary = 'quantitative';
    else if (lower.split(/\s+/).map(normalizeToken).filter(isMeaningfulToken).length >= 2) primary = 'factual';
  }

  // Expand terms using synonym map
  const words = lower.split(/\s+/).map(normalizeToken).filter(isMeaningfulToken);
  for (const word of words) {
    for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
      const normalizedSynonyms = synonyms.map(normalizeToken);
      if (word === key || synonyms.includes(word) || normalizedSynonyms.includes(word)) {
        expandedTerms.push(
          key,
          ...synonyms.filter((synonym) => {
            const normalizedSynonym = normalizeToken(synonym);
            return normalizedSynonym !== word && !words.includes(normalizedSynonym);
          }),
        );
        break;
      }
    }
  }

  // Entity type hints
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
  const uniqueTerms = buildSearchTerms(topic, intent.expandedTerms);
  const sources: ScoredSource[] = [];

  // Score tables
  for (const table of tablesMeta) {
    let score = 0.2;
    let reason = 'default table source';

    const tableLower = table.tableName.toLowerCase();
    const normalizedTableLower = normalizeToken(tableLower);
    const descLower = (table.description || '').toLowerCase();

    if (uniqueTerms.some(t => tableLower === t || normalizedTableLower === t)) {
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
    const normalizedCollectionLower = normalizeToken(collLower);
    const descLower = (coll.description || '').toLowerCase();

    if (uniqueTerms.some(t => collLower === t || normalizedCollectionLower === t)) {
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
        if (getFlag('FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED')) {
          recommendedCalls.push({
            tool: 'recall',
            args: { mode: 'graph', graph: { queryType: 'pattern', pattern: { entityType: '<type>', relation: '<relation>', targetType: '<target_type>' } } },
            reason: `${source.reason} (structured pattern preferred)`,
          });
        } else {
          recommendedCalls.push({
            tool: 'recall',
            args: { mode: 'graph', graph: { queryType: 'pattern', pattern: '<user_topic>' } },
            reason: source.reason,
          });
        }
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
export function fuseFacts(facts: RetrievedFact[], maxFacts?: number, intent?: ClassifiedIntent): RetrievedFact[] {
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

  // Role-match boosting: boost facts matching relation hints
  if (intent?.relationHints.length) {
    for (const entry of deduped) {
      const factLower = entry._norm;
      const matchesHint = intent.relationHints.some(hint =>
        factLower.includes(hint.replace(/_/g, ' ')) || factLower.includes(hint)
      );
      if (matchesHint && entry.confidence < 0.95) {
        entry.confidence = Math.min(entry.confidence + 0.05, 0.95);
      }
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
  intent: ClassifiedIntent,
  config: BudgetConfig,
  consentChecker: (resource: string, permission: string) => Promise<boolean>,
): Promise<RetrievedFact[]> {
  const hasConsent = await consentChecker('graph', 'read');
  if (!hasConsent) return [];

  const seedTerms = [
    topic,
    ...topic.split(/\s+/),
    ...intent.expandedTerms,
  ]
    .map((term) => term.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim())
    .filter((term) => term.length >= 3);

  const uniqueSeedTerms = [...new Set(seedTerms)].slice(0, config.maxGraphSeeds);
  const searchTerms = uniqueSeedTerms.length > 0 ? uniqueSeedTerms : [topic];

  const seedMatches = await Promise.allSettled(
    searchTerms.map((term) =>
      getEntityByName(
        userId,
        term,
        undefined,
        0.28,
        Math.max(3, Math.ceil(config.maxGraphSeeds / 2)),
      )),
  );

  const byEntityId = new Map<number, Awaited<ReturnType<typeof getEntityByName>>[number]>();
  for (const result of seedMatches) {
    if (result.status !== 'fulfilled') continue;
    for (const entity of result.value) {
      const existing = byEntityId.get(entity.id);
      const similarity = entity.similarity ?? 0;
      const existingSimilarity = existing?.similarity ?? 0;
      if (!existing || similarity > existingSimilarity) {
        byEntityId.set(entity.id, entity);
      }
    }
  }

  const entities = [...byEntityId.values()]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, config.maxGraphSeeds);

  const facts: RetrievedFact[] = [];

  // Convert found entities to facts with ranking boosts
  for (const entity of entities) {
    let confidence = entity.similarity ?? 0.5;
    // Boost: relationship intent + person entity type
    if (intent.primary === 'relationship' && entity.type === 'person') {
      confidence = Math.min(confidence + 0.15, 0.95);
    }
    // Boost: high mention count indicates well-established entity
    if (entity.mentionCount >= 3) {
      confidence = Math.min(confidence + 0.05, 0.95);
    }

    facts.push({
      fact: `${entity.name} (${entity.type})`,
      sourceType: 'graph',
      sourceRef: `graph/entity/${entity.id}`,
      confidence,
      timestamp: entity.lastSeen?.toISOString(),
    });
  }

  // For top seeds with high similarity, get neighbors with edge relation info
  const topSeeds = entities
    .filter(e => (e.similarity ?? 0) > 0.4)
    .slice(0, 5);

  // Build relation filter from intent hints for traversal
  const graphRelationFilter: string[] = [];
  if (intent.relationHints.length > 0) {
    const known = ['works_at', 'attended', 'founded', 'married_to', 'parent_of',
                    'friend', 'knows', 'family_member', 'visited', 'lives_at',
                    'interested_in', 'related_to'];
    for (const hint of intent.relationHints) {
      if (known.includes(hint)) {
        graphRelationFilter.push(hint);
      }
    }
  }

  // Get 1-hop neighbors with full edge info for rich fact formatting
  const neighborPromises = topSeeds.map(async (seed) => {
    try {
      const neighbors = await getNeighbors(userId, seed.id, {
        direction: 'both',
        relationFilter: graphRelationFilter.length === 1 ? graphRelationFilter[0] : undefined,
        limit: 20,
      });

      return neighbors.map(neighbor => {
        const edge = neighbor.edge;
        const relation = String(edge.relation).replace(/_/g, ' ');
        const isOutbound = edge.sourceId === seed.id;
        const fact = isOutbound
          ? `${seed.name} ${relation} ${neighbor.name}`
          : `${neighbor.name} ${relation} ${seed.name}`;

        let conf = (seed.similarity ?? 0.5) * 0.85;
        // Boost: edge weight indicates reinforcement
        if (edge.weight > 1.5) {
          conf = Math.min(conf + 0.05, 0.95);
        }
        // Boost: relation matches intent hints
        if (intent.relationHints.length > 0 &&
            intent.relationHints.some(hint => edge.relation.includes(hint) || hint.includes(edge.relation))) {
          conf = Math.min(conf + 0.1, 0.95);
        }

        return {
          fact,
          sourceType: 'graph' as SourceType,
          sourceRef: `graph/edge/${edge.id}`,
          confidence: conf,
        };
      });
    } catch {
      return [];
    }
  });

  // Also run deep traversal for multi-hop paths (depth > 1)
  const traversalPromises = topSeeds.map(async (seed) => {
    try {
      const paths = await traverse(userId, seed.id, {
        maxDepth: config.maxGraphHops,
        limit: 20,
        ...(graphRelationFilter.length > 0 ? { relationFilter: graphRelationFilter } : {}),
      });
      // Filter out the start node and depth-1 nodes (already covered by getNeighbors)
      return paths
        .filter(node => node.id !== seed.id && node.depth > 1)
        .map(node => ({
          fact: `${seed.name} is connected to ${node.name} (${node.type})`,
          sourceType: 'graph' as SourceType,
          sourceRef: `graph/traverse/${seed.id}→${node.id}`,
          confidence: (seed.similarity ?? 0.5) * 0.7,
        }));
    } catch {
      return [];
    }
  });

  const [neighborResults, traversalResults] = await Promise.all([
    Promise.allSettled(neighborPromises),
    Promise.allSettled(traversalPromises),
  ]);

  for (const result of neighborResults) {
    if (result.status === 'fulfilled') {
      facts.push(...result.value);
    }
  }
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
  const searchTerms = buildSearchTerms(topic, intent.expandedTerms).slice(0, 6);
  const escapedSearchTerms = searchTerms.map((term) => escapeSQLString(escapeILIKE(term)));

  for (const tableName of selectedTables.slice(0, config.maxTables)) {
    try {
      // Find text columns from metadata
      const meta = tablesMeta.find(t => t.tableName === tableName);
      const textCols = meta?.columns
        ?.filter(c => /text|varchar|char/i.test(c.type))
        .map(c => c.name) ?? [];
      const normalizedTableName = normalizeToken(tableName.toLowerCase());
      const tableContextMatch = searchTerms.some((term) =>
        normalizedTableName === term ||
        normalizedTableName.includes(term) ||
        term.includes(normalizedTableName),
      );

      let sql: string;
      if (textCols.length > 0 && escapedSearchTerms.length > 0) {
        // Build ILIKE conditions across text columns
        const conditions = escapedSearchTerms
          .flatMap(searchTerm => textCols.map(col => `"${col}" ILIKE '%${searchTerm}%'`))
          .join(' OR ');
        sql = `SELECT * FROM "${tableName}" WHERE ${conditions} LIMIT ${config.maxRowsPerTable}`;
      } else {
        // No text columns — fall back to recent rows
        sql = `SELECT * FROM "${tableName}" ORDER BY created_at DESC LIMIT ${config.maxRowsPerTable}`;
      }

      let result = await executeSandboxedQuery(userId, sql, 10, config.maxRowsPerTable);
      if (result.rows.length === 0 && textCols.length > 0 && tableContextMatch) {
        // If the table itself strongly matches topic terms, return recent rows even
        // when row text does not explicitly mention those terms (e.g., books table).
        result = await executeSandboxedQuery(
          userId,
          `SELECT * FROM "${tableName}" ORDER BY created_at DESC LIMIT ${config.maxRowsPerTable}`,
          10,
          config.maxRowsPerTable,
        );
      }

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
  const uniqueTerms = buildSearchTerms(topic, intent.expandedTerms);

  for (const [key, value] of Object.entries(profile)) {
    const rootMatches = textMatchesTerms(key, uniqueTerms);
    const flattened = flattenProfileValue(value, key);

    for (const entry of flattened) {
      if (facts.length >= MAX_PROFILE_FACTS) break;
      const entryMatches =
        rootMatches ||
        textMatchesTerms(entry.path, uniqueTerms) ||
        textMatchesTerms(entry.value, uniqueTerms);
      if (!entryMatches) continue;

      facts.push({
        fact: `${entry.path}: ${entry.value}`,
        sourceType: 'profile',
        sourceRef: `profile/${entry.path.replace(/\./g, '/').replace(/\[/g, '/').replace(/]/g, '')}`,
        confidence: 0.9,
      });
    }

    if (facts.length >= MAX_PROFILE_FACTS) break;
  }

  return facts;
}

/**
 * Expand query terms using profile family context.
 * When intent is relationship and profile has family data, add family member
 * names and nicknames that match the query role terms.
 */
export function expandQueryWithProfileContext(
  topic: string,
  intent: ClassifiedIntent,
  profile: Record<string, unknown> | null,
): string[] {
  if (!profile || intent.primary !== 'relationship') return [];

  const additionalTerms: string[] = [];

  // Scan profile family structure
  const family = profile.family;
  if (!family) return [];

  const members: Array<Record<string, unknown>> = [];

  if (Array.isArray(family)) {
    for (const m of family) {
      if (m && typeof m === 'object') members.push(m as Record<string, unknown>);
    }
  } else if (typeof family === 'object' && family !== null) {
    for (const [key, val] of Object.entries(family as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        for (const m of val) {
          if (m && typeof m === 'object') members.push(m as Record<string, unknown>);
        }
      } else if (val && typeof val === 'object') {
        members.push({ ...(val as Record<string, unknown>), relation: key });
      }
    }
  }

  for (const member of members) {
    const relation = String(member.relation || '').toLowerCase();
    const name = String(member.name || '').toLowerCase();
    const nickname = String(member.nickname || '').toLowerCase();

    // Check if any query term or expanded term matches this member's relation
    const allTerms = [...intent.expandedTerms, ...topic.toLowerCase().split(/\s+/)];
    const matchesRole = allTerms.some(
      (term) => relation.includes(term) || term.includes(relation),
    );

    if (matchesRole && name) {
      additionalTerms.push(name);
      if (nickname) additionalTerms.push(nickname);
    }
  }

  return [...new Set(additionalTerms)];
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

  // Expand query with profile family context
  const profileExpansion = expandQueryWithProfileContext(topic, intent, profile);
  if (profileExpansion.length > 0) {
    intent.expandedTerms.push(...profileExpansion);
    intent.expandedTerms = [...new Set(intent.expandedTerms)];
  }

  const scoredSources = scoreSourceRelevance(topic, intent, tablesMeta, collectionsMeta, profile);
  const config = BUDGET_CONFIG[budget];

  // Select sources based on scoring
  const selectedTables = scoredSources
    .filter(s => s.sourceType === 'table' && s.relevanceScore >= 0.3)
    .slice(0, config.maxTables)
    .map(s => s.sourceId);

  const selectedCollections = scoredSources
    .filter(s => s.sourceType === 'vector' && s.relevanceScore >= 0.3)
    .map(s => s.sourceId);

  // Include edge summary vectors when feature flag is enabled
  if (getFlag('FEATURE_RETRIEVAL_EDGE_VECTORS') && !selectedCollections.includes('graph_edges')) {
    selectedCollections.push('graph_edges');
  }

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
  const fused = fuseFacts(allFacts, config.maxTotalFacts, intent);

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
