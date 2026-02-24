/**
 * Deduplication Service
 *
 * 6-stage entity deduplication pipeline to prevent duplicate entities
 * in the knowledge graph.
 *
 * Stages:
 * 1. Exact match: (type, lower(name))
 * 1.5. Normalized match: (plural/singular)
 * 2. Fuzzy match: pg_trgm similarity > 0.6
 * 3. Alias match: Check properties.aliases array
 * 4. Cross-type exact match (behind CROSS_TYPE_DEDUP_ENABLED flag)
 * 5. Cross-type fuzzy → quarantine (behind CROSS_TYPE_DEDUP_ENABLED flag)
 *
 * Reference: EPITOME_TECH_SPEC.md §6.3
 * Reference: knowledge-graph SKILL.md
 */

import { withUserSchema } from '@/db/client';
import { getEntityInternal, type EntityType } from './graphService';
import { logger } from '@/utils/logger';
import { isFeatureEnabled } from './featureFlags';
import { insertEdgeQuarantine } from './ontology';

// =====================================================
// TYPES
// =====================================================

/**
 * Deduplication match result
 */
export interface DuplicateMatch {
  entityId: number;
  matchType: 'exact' | 'fuzzy' | 'alias' | 'context';
  similarity?: number;
  confidence: number;
  crossType?: boolean;
}

/**
 * Entity candidate for deduplication
 */
export interface EntityCandidate {
  type: EntityType;
  name: string;
  properties?: Record<string, any>;
  context?: {
    relations?: string[];
    connectedEntities?: string[];
  };
}

// =====================================================
// NORMALIZED MATCHING HELPERS
// =====================================================

/**
 * Normalize an entity name for comparison.
 *
 * - Lowercase
 * - Strip corporate suffixes for organizations (Inc., LLC, Corp., etc.)
 * - Strip trailing plural suffixes: s, es, ies→y
 * - Trim whitespace
 *
 * @param name - Entity name to normalize
 * @param type - Optional entity type for type-specific normalization
 * @returns Normalized form
 */
export function normalizeForComparison(name: string, type?: string): string {
  let n = name.toLowerCase().trim();

  // Strip corporate suffixes for organizations
  if (type === 'organization') {
    n = n.replace(/,?\s*\b(inc\.?|llc|corp\.?|corporation|ltd\.?|co\.?|company)\s*$/i, '').trim();
  }

  // ies → y (e.g., "burritos" won't match, but "berries" → "berry")
  if (n.endsWith('ies')) {
    n = n.slice(0, -3) + 'y';
  } else if (n.endsWith('ses') || n.endsWith('xes') || n.endsWith('zes') || n.endsWith('ches') || n.endsWith('shes')) {
    // "dishes" → "dish", "boxes" → "box"
    n = n.slice(0, -2);
  } else if (n.endsWith('s') && !n.endsWith('ss')) {
    // "burritos" → "burrito", but not "grass" → "gras"
    n = n.slice(0, -1);
  }

  return n;
}

/**
 * Stage 1.5: Find match using normalized name comparison
 *
 * Handles plural/singular mismatches that pg_trgm misses due to
 * length differences degrading similarity scores.
 *
 * @param userId - User ID for schema isolation
 * @param candidate - Entity candidate to check
 * @returns Matching entity ID or null
 */
async function findNormalizedMatch(
  userId: string,
  candidate: EntityCandidate
): Promise<DuplicateMatch | null> {
  const normalizedCandidate = normalizeForComparison(candidate.name, candidate.type);

  return withUserSchema(userId, async (tx) => {
    // Fetch up to 200 entities of same type, ordered by mention_count DESC
    const entities = await tx<{ id: number; name: string; confidence: number }[]>`
      SELECT id, name, confidence
      FROM entities
      WHERE type = ${candidate.type}
        AND _deleted_at IS NULL
      ORDER BY mention_count DESC
      LIMIT 200
    `;

    for (const entity of entities) {
      const normalizedExisting = normalizeForComparison(entity.name, candidate.type);

      // Check normalized exact match
      if (normalizedCandidate === normalizedExisting) {
        return {
          entityId: entity.id,
          matchType: 'fuzzy' as const, // Report as fuzzy since it's not a literal exact match
          similarity: 0.95,
          confidence: entity.confidence,
        };
      }

      // Check prefix match: shorter must be ≥60% of longer's length
      const shorter = normalizedCandidate.length <= normalizedExisting.length ? normalizedCandidate : normalizedExisting;
      const longer = normalizedCandidate.length > normalizedExisting.length ? normalizedCandidate : normalizedExisting;

      if (shorter.length >= longer.length * 0.6 && longer.startsWith(shorter)) {
        return {
          entityId: entity.id,
          matchType: 'fuzzy' as const,
          similarity: shorter.length / longer.length,
          confidence: entity.confidence,
        };
      }
    }

    return null;
  });
}

// =====================================================
// SIMILARITY CALCULATION
// =====================================================

/**
 * Calculate similarity between two strings using pg_trgm
 *
 * @param userId - User ID for schema isolation
 * @param name1 - First name
 * @param name2 - Second name
 * @returns Similarity score (0-1)
 */
export async function calculateSimilarity(
  userId: string,
  name1: string,
  name2: string
): Promise<number> {
  return withUserSchema(userId, async (tx) => {
    const result = await tx<{ similarity: number }[]>`
      SELECT similarity(${name1}, ${name2}) AS similarity
    `;

    return result[0]?.similarity || 0;
  });
}

// =====================================================
// DUPLICATE DETECTION
// =====================================================

/**
 * Stage 1: Find exact match on (type, lower(name))
 *
 * @param userId - User ID for schema isolation
 * @param candidate - Entity candidate to check
 * @returns Matching entity ID or null
 */
async function findExactMatch(
  userId: string,
  candidate: EntityCandidate
): Promise<DuplicateMatch | null> {
  return withUserSchema(userId, async (tx) => {
    const result = await tx<{ id: number; confidence: number }[]>`
      SELECT id, confidence
      FROM entities
      WHERE type = ${candidate.type}
        AND lower(name) = lower(${candidate.name})
        AND _deleted_at IS NULL
      LIMIT 1
    `;

    if (result.length > 0) {
      return {
        entityId: result[0].id,
        matchType: 'exact',
        confidence: result[0].confidence,
      };
    }

    return null;
  });
}

/**
 * Stage 2: Find fuzzy match using pg_trgm similarity > 0.6
 *
 * @param userId - User ID for schema isolation
 * @param candidate - Entity candidate to check
 * @returns Matching entity ID with similarity score or null
 */
async function findFuzzyMatch(
  userId: string,
  candidate: EntityCandidate
): Promise<DuplicateMatch | null> {
  // Invariant: fuzzy match is type-constrained — prevents cross-type dedup
  return withUserSchema(userId, async (tx) => {
    const result = await tx<{ id: number; similarity: number; confidence: number }[]>`
      SELECT
        id,
        similarity(name, ${candidate.name}) AS similarity,
        confidence
      FROM entities
      WHERE type = ${candidate.type}
        AND _deleted_at IS NULL
        AND similarity(name, ${candidate.name}) > 0.6
      ORDER BY similarity DESC
      LIMIT 1
    `;

    if (result.length > 0) {
      return {
        entityId: result[0].id,
        matchType: 'fuzzy',
        similarity: result[0].similarity,
        confidence: result[0].confidence,
      };
    }

    return null;
  });
}

/**
 * Stage 3: Find match in properties.aliases array
 *
 * @param userId - User ID for schema isolation
 * @param candidate - Entity candidate to check
 * @returns Matching entity ID or null
 */
async function findAliasMatch(
  userId: string,
  candidate: EntityCandidate
): Promise<DuplicateMatch | null> {
  return withUserSchema(userId, async (tx) => {
    const result = await tx<{ id: number; confidence: number }[]>`
      SELECT id, confidence
      FROM entities
      WHERE type = ${candidate.type}
        AND _deleted_at IS NULL
        AND properties->'aliases' ? ${candidate.name}
      LIMIT 1
    `;

    if (result.length > 0) {
      return {
        entityId: result[0].id,
        matchType: 'alias',
        confidence: result[0].confidence,
      };
    }

    return null;
  });
}

/**
 * Stage 4: Cross-type exact name match
 * Finds entities with the same name but different type.
 * Only runs when CROSS_TYPE_DEDUP_ENABLED flag is on.
 */
async function findCrossTypeExactMatch(
  userId: string,
  candidate: EntityCandidate
): Promise<DuplicateMatch | null> {
  return withUserSchema(userId, async (tx) => {
    const result = await tx<{ id: number; type: string; name: string; confidence: number; mention_count: number }[]>`
      SELECT id, type, name, confidence, mention_count
      FROM entities
      WHERE lower(name) = lower(${candidate.name})
        AND type != ${candidate.type}
        AND _deleted_at IS NULL
      ORDER BY confidence DESC, mention_count DESC
      LIMIT 1
    `;

    if (result.length > 0) {
      logger.info('Cross-type exact match found', {
        event: 'cross_type_dedup_match',
        candidateName: candidate.name,
        candidateType: candidate.type,
        existingType: result[0].type,
        entityId: result[0].id,
      });
      return {
        entityId: result[0].id,
        matchType: 'exact',
        confidence: result[0].confidence,
        crossType: true,
      };
    }

    return null;
  });
}

/**
 * Stage 5: Cross-type fuzzy candidate → quarantine
 * Does NOT return a DuplicateMatch. Instead inserts into edge_quarantine
 * for human review. The entity will still be created as new.
 */
async function findCrossTypeFuzzyCandidate(
  userId: string,
  candidate: EntityCandidate
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    const result = await tx<{ id: number; type: string; name: string; similarity: number }[]>`
      SELECT id, type, name, similarity(name, ${candidate.name}) as similarity
      FROM entities
      WHERE type != ${candidate.type}
        AND _deleted_at IS NULL
        AND similarity(name, ${candidate.name}) > 0.7
      ORDER BY similarity DESC
      LIMIT 1
    `;

    if (result.length > 0) {
      logger.info('Cross-type fuzzy candidate found, quarantining for review', {
        event: 'cross_type_fuzzy_quarantine',
        candidateName: candidate.name,
        candidateType: candidate.type,
        existingName: result[0].name,
        existingType: result[0].type,
        similarity: result[0].similarity,
      });

      await insertEdgeQuarantine(tx, {
        sourceType: candidate.type,
        targetType: result[0].type,
        relation: 'cross_type_candidate',
        sourceName: candidate.name,
        targetName: result[0].name,
        reason: 'cross_type_fuzzy_candidate',
        payload: {
          candidateType: candidate.type,
          existingEntityId: result[0].id,
          existingType: result[0].type,
          similarity: result[0].similarity,
        },
      });
    }
  });
}

/**
 * Stage 4 (context): Disambiguate using edge context
 *
 * When multiple entities have similar names (e.g., two "Sarah"s),
 * resolve using connected entities and relations.
 *
 * Example:
 * - "Sarah" + dinner + wife → Sarah Chen (wife)
 * - "Sarah" + work + meeting → Sarah Park (colleague)
 *
 * @param userId - User ID for schema isolation
 * @param candidate - Entity candidate with context
 * @param potentialMatches - List of potential duplicate entities
 * @returns Best matching entity ID or null
 */
export async function disambiguateByContext(
  userId: string,
  candidate: EntityCandidate,
  potentialMatches: number[]
): Promise<DuplicateMatch | null> {
  if (!candidate.context || potentialMatches.length === 0) {
    return null;
  }

  return withUserSchema(userId, async (tx) => {
    // Score each potential match based on context overlap
    const scores: { entityId: number; score: number; confidence: number }[] = [];

    for (const entityId of potentialMatches) {
      let score = 0;

      // Check relation overlap
      if (candidate.context?.relations) {
        const relationOverlap = await tx<{ count: number }[]>`
          SELECT COUNT(*) AS count
          FROM edges
          WHERE (source_id = ${entityId} OR target_id = ${entityId})
            AND relation = ANY(${candidate.context.relations})
            AND _deleted_at IS NULL
        `;

        score += (relationOverlap[0]?.count || 0) * 2; // Relations are strong signals
      }

      // Check connected entity overlap
      if (candidate.context?.connectedEntities) {
        const lowerNames = candidate.context.connectedEntities.map((n) => n.toLowerCase());
        const entityOverlap = await tx<{ count: number }[]>`
          SELECT COUNT(*) AS count
          FROM edges e1
          JOIN entities e2 ON (e2.id = e1.target_id OR e2.id = e1.source_id)
          WHERE (e1.source_id = ${entityId} OR e1.target_id = ${entityId})
            AND e1._deleted_at IS NULL
            AND e2._deleted_at IS NULL
            AND lower(e2.name) = ANY(${lowerNames})
        `;

        score += entityOverlap[0]?.count || 0;
      }

      // Get confidence
      const entity = await tx<{ confidence: number }[]>`
        SELECT confidence
        FROM entities
        WHERE id = ${entityId}
      `;

      scores.push({
        entityId,
        score,
        confidence: entity[0]?.confidence || 0.5,
      });
    }

    // Return best match if it has a significant score
    scores.sort((a, b) => b.score - a.score);

    if (scores.length > 0 && scores[0].score > 0) {
      return {
        entityId: scores[0].entityId,
        matchType: 'context',
        confidence: scores[0].confidence,
      };
    }

    return null;
  });
}

/**
 * Find duplicate entity using 4-stage pipeline
 *
 * @param userId - User ID for schema isolation
 * @param candidate - Entity candidate to check
 * @returns Duplicate match or null if no duplicate found
 */
export async function findDuplicateEntity(
  userId: string,
  candidate: EntityCandidate
): Promise<DuplicateMatch | null> {
  // Stage 1: Exact match
  const exactMatch = await findExactMatch(userId, candidate);
  if (exactMatch) {
    return exactMatch;
  }

  // Stage 1.5: Normalized match (handles plural/singular, e.g. "burrito" vs "burritos")
  const normalizedMatch = await findNormalizedMatch(userId, candidate);
  if (normalizedMatch) {
    return normalizedMatch;
  }

  // Stage 2: Fuzzy match
  const fuzzyMatch = await findFuzzyMatch(userId, candidate);
  if (fuzzyMatch) {
    // Fuzzy match found (SQL already filters to similarity > 0.6)
    return fuzzyMatch;
  }

  // Stage 3: Alias match
  const aliasMatch = await findAliasMatch(userId, candidate);
  if (aliasMatch) {
    return aliasMatch;
  }

  // Stages 4-5: Cross-type matching (behind feature flag)
  if (isFeatureEnabled('CROSS_TYPE_DEDUP_ENABLED')) {
    // Stage 4: Cross-type exact match
    const crossTypeExact = await findCrossTypeExactMatch(userId, candidate);
    if (crossTypeExact) {
      return crossTypeExact;
    }

    // Stage 5: Cross-type fuzzy → quarantine (does not return a match)
    await findCrossTypeFuzzyCandidate(userId, candidate);
  }

  // No duplicate found
  return null;
}

// =====================================================
// ENTITY MERGING
// =====================================================

/**
 * Merge two entities by transferring edges and soft deleting source
 *
 * Steps:
 * 1. Transfer all edges from source to target
 * 2. Increment edge weights for duplicate edges
 * 3. Union properties (target wins on conflicts)
 * 4. Add source name as alias on target
 * 5. Update mention_count and confidence
 * 6. Soft delete source entity
 *
 * @param userId - User ID for schema isolation
 * @param sourceId - Entity to merge from (will be deleted)
 * @param targetId - Entity to merge into (will be kept)
 */
export async function mergeEntities(
  userId: string,
  sourceId: number,
  targetId: number
): Promise<void> {
  if (sourceId === targetId) {
    throw new Error('Cannot merge an entity with itself');
  }

  return withUserSchema(userId, async (tx) => {
    // Get both entities (use internal variant to reuse transaction, avoiding deadlock)
    const source = await getEntityInternal(tx, sourceId);
    const target = await getEntityInternal(tx, targetId);

    if (!source || !target) {
      throw new Error('Source or target entity not found');
    }

    // 1. Transfer edges from source to target
    // Update outbound edges (source_id)
    await tx.unsafe(`
      UPDATE edges
      SET source_id = ${targetId},
          last_seen = NOW()
      WHERE source_id = ${sourceId}
        AND _deleted_at IS NULL
        AND NOT EXISTS (
          -- Don't create duplicate edges
          SELECT 1 FROM edges e2
          WHERE e2.source_id = ${targetId}
            AND e2.target_id = edges.target_id
            AND e2.relation = edges.relation
            AND e2._deleted_at IS NULL
        )
    `);

    // Update inbound edges (target_id)
    await tx.unsafe(`
      UPDATE edges
      SET target_id = ${targetId},
          last_seen = NOW()
      WHERE target_id = ${sourceId}
        AND _deleted_at IS NULL
        AND NOT EXISTS (
          -- Don't create duplicate edges
          SELECT 1 FROM edges e2
          WHERE e2.source_id = edges.source_id
            AND e2.target_id = ${targetId}
            AND e2.relation = edges.relation
            AND e2._deleted_at IS NULL
        )
    `);

    // Handle duplicate edges by incrementing weight
    await tx.unsafe(`
      UPDATE edges e1
      SET weight = e1.weight + e2.weight,
          confidence = GREATEST(e1.confidence, e2.confidence),
          last_seen = NOW(),
          evidence = e1.evidence || e2.evidence
      FROM edges e2
      WHERE e2.source_id = ${sourceId}
        AND e2._deleted_at IS NULL
        AND e1.source_id = ${targetId}
        AND e1.target_id = e2.target_id
        AND e1.relation = e2.relation
        AND e1._deleted_at IS NULL
    `);

    await tx.unsafe(`
      UPDATE edges e1
      SET weight = e1.weight + e2.weight,
          confidence = GREATEST(e1.confidence, e2.confidence),
          last_seen = NOW(),
          evidence = e1.evidence || e2.evidence
      FROM edges e2
      WHERE e2.target_id = ${sourceId}
        AND e2._deleted_at IS NULL
        AND e1.source_id = e2.source_id
        AND e1.target_id = ${targetId}
        AND e1.relation = e2.relation
        AND e1._deleted_at IS NULL
    `);

    // Soft delete remaining source edges
    await tx.unsafe(`
      UPDATE edges
      SET _deleted_at = NOW()
      WHERE (source_id = ${sourceId} OR target_id = ${sourceId})
        AND _deleted_at IS NULL
    `);

    // 2. Merge properties
    const mergedProperties = {
      ...source.properties,
      ...target.properties, // Target wins on conflicts
    };

    // Add source name as alias
    const aliases = new Set(mergedProperties.aliases || []);
    aliases.add(source.name);
    mergedProperties.aliases = Array.from(aliases);

    // 3. Update target entity
    const firstSeenStr = source.firstSeen instanceof Date
      ? source.firstSeen.toISOString()
      : String(source.firstSeen);
    await tx`
      UPDATE entities
      SET properties = ${JSON.stringify(mergedProperties)}::jsonb,
          mention_count = mention_count + ${source.mentionCount || 1},
          confidence = GREATEST(confidence, ${source.confidence}),
          first_seen = LEAST(first_seen, ${firstSeenStr}::timestamptz),
          last_seen = NOW()
      WHERE id = ${targetId}
    `;

    // 4. Soft delete source entity
    await tx.unsafe(`
      UPDATE entities
      SET _deleted_at = NOW()
      WHERE id = ${sourceId}
    `);

    logger.info('Merged entity', { sourceId, sourceName: source.name, targetId, targetName: target.name });
  });
}

/**
 * Check if entity should be deduplicated before creation
 * Returns existing entity ID if duplicate found, null otherwise
 *
 * @param userId - User ID for schema isolation
 * @param candidate - Entity candidate to check
 * @returns Existing entity ID or null
 */
export async function checkAndDeduplicateBeforeCreate(
  userId: string,
  candidate: EntityCandidate
): Promise<number | null>;
export async function checkAndDeduplicateBeforeCreate(
  userId: string,
  candidate: EntityCandidate,
  returnMatch: true
): Promise<DuplicateMatch | null>;
export async function checkAndDeduplicateBeforeCreate(
  userId: string,
  candidate: EntityCandidate,
  returnMatch?: boolean
): Promise<number | DuplicateMatch | null> {
  const duplicate = await findDuplicateEntity(userId, candidate);

  if (duplicate) {
    logger.info('Found duplicate entity', { matchType: duplicate.matchType, candidateName: candidate.name, existingEntityId: duplicate.entityId });
    return returnMatch ? duplicate : duplicate.entityId;
  }

  return null;
}
