/**
 * Ontology — Single source of truth for entity taxonomy, relation taxonomy,
 * allowed relation matrix, display config, and employment model.
 *
 * Strict — no escape hatches. Unknown relations go through quarantine.
 *
 * Reference: EPITOME_DATA_MODEL.md §7.1-7.2
 */

import { TransactionSql } from '@/db/client';
import { logger } from '@/utils/logger';

// =====================================================
// ENTITY TAXONOMY (strict)
// =====================================================

export const ENTITY_TYPES = [
  'person',
  'organization',
  'place',
  'food',
  'topic',
  'preference',
  'event',
  'activity',
  'medication',
  'media',
  'custom',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

// =====================================================
// RELATION TAXONOMY (strict, no | string escape)
// =====================================================

export const EDGE_RELATIONS = [
  // Person → Organization
  'works_at',
  'attended',
  'founded',
  // Person → Person
  'married_to',
  'parent_of',
  'friend',
  'knows',
  'family_member',
  // Person → Place
  'visited',
  'lives_at',
  'works_out_at',
  // Person → Food
  'likes',
  'dislikes',
  'ate',
  'allergic_to',
  // Person → Activity/Topic/Preference
  'interested_in',
  'has_skill',
  'performed',
  'follows',
  'tracks',
  // Person → Medication
  'takes',
  // Structural (any → any)
  'category',
  'similar_to',
  'part_of',
  'related_to',
  'located_at',
  // System
  'thread_next',
  'contradicts',
  'has_condition',
] as const;

export type EdgeRelation = (typeof EDGE_RELATIONS)[number];
// NO `| string` — unknown relations go through quarantine

const EDGE_RELATION_ALIASES: Record<string, EdgeRelation> = {
  child_of: 'family_member',
  read_by: 'interested_in',
  performed_by: 'attended',
  author_of: 'related_to',
  birth_of: 'related_to',
};

/**
 * Normalize relation aliases to canonical ontology relations.
 * Unknown values pass through unchanged and can still be quarantined by validateEdge().
 */
export function normalizeEdgeRelation(relation: string): string {
  const normalized = relation.trim().toLowerCase();
  return EDGE_RELATION_ALIASES[normalized] ?? normalized;
}

// =====================================================
// ALLOWED RELATION MATRIX
// =====================================================

interface RelationRule {
  source: EntityType[] | null;
  target: EntityType[] | null;
}

export const RELATION_MATRIX: Record<string, RelationRule> = {
  works_at:      { source: ['person'], target: ['organization'] },
  attended:      { source: ['person'], target: ['organization', 'event'] },
  founded:       { source: ['person'], target: ['organization'] },
  married_to:    { source: ['person'], target: ['person'] },
  parent_of:     { source: ['person'], target: ['person'] },
  friend:        { source: ['person'], target: ['person'] },
  knows:         { source: ['person'], target: ['person'] },
  family_member: { source: ['person'], target: ['person'] },
  takes:         { source: ['person'], target: ['medication'] },
  ate:           { source: ['person'], target: ['food'] },
  allergic_to:   { source: ['person'], target: ['food', 'topic'] },
  visited:       { source: ['person'], target: ['place', 'organization'] },
  lives_at:      { source: ['person'], target: ['place'] },
  works_out_at:  { source: ['person'], target: ['place'] },
  likes:         { source: ['person'], target: null },
  dislikes:      { source: ['person'], target: null },
  interested_in: { source: ['person'], target: null },
  has_skill:     { source: ['person'], target: ['topic'] },
  performed:     { source: ['person'], target: ['activity'] },
  follows:       { source: ['person'], target: ['preference', 'topic'] },
  tracks:        { source: ['person'], target: ['preference'] },
  has_condition:  { source: ['person'], target: ['topic'] },
  category:      { source: null, target: null },
  similar_to:    { source: null, target: null },
  part_of:       { source: null, target: null },
  related_to:    { source: null, target: null },
  located_at:    { source: null, target: ['place'] },
  thread_next:   { source: null, target: null },
  contradicts:   { source: null, target: null },
};

// =====================================================
// CANONICAL EMPLOYMENT MODEL
// =====================================================

/**
 * works_at edge carries role as qualifier in edge.properties.
 * No separate has_role entity/relation — role lives on the works_at edge.
 */
export interface WorksAtQualifiers {
  role?: string;
  is_current: boolean;
  start_date?: string;   // ISO date or "YYYY-MM"
  end_date?: string | null;
}

// =====================================================
// ENTITY DISPLAY CONFIG (drives API + Dashboard)
// =====================================================

export const ENTITY_DISPLAY: Record<EntityType, { label: string; color: string }> = {
  person:       { label: 'Person',       color: '#3b82f6' },
  organization: { label: 'Organization', color: '#8b5cf6' },
  place:        { label: 'Place',        color: '#10b981' },
  food:         { label: 'Food',         color: '#84cc16' },
  topic:        { label: 'Topic',        color: '#06b6d4' },
  preference:   { label: 'Preference',   color: '#ec4899' },
  event:        { label: 'Event',        color: '#f59e0b' },
  activity:     { label: 'Activity',     color: '#14b8a6' },
  medication:   { label: 'Medication',   color: '#ef4444' },
  media:        { label: 'Media',        color: '#a855f7' },
  custom:       { label: 'Custom',       color: '#78716c' },
};

// =====================================================
// VALIDATION
// =====================================================

export function validateEdge(
  sourceType: EntityType,
  targetType: EntityType,
  relation: string
): { valid: boolean; error?: string; quarantine?: boolean } {
  // Unknown relation → quarantine (don't silently accept)
  if (!RELATION_MATRIX[relation]) {
    return {
      valid: false,
      quarantine: true,
      error: `Unknown relation '${relation}' — routed to quarantine`,
    };
  }
  const rule = RELATION_MATRIX[relation];
  if (rule.source && !rule.source.includes(sourceType as EntityType)) {
    return {
      valid: false,
      error: `${relation}: invalid source '${sourceType}' (expected: ${rule.source.join('|')})`,
    };
  }
  if (rule.target && !rule.target.includes(targetType as EntityType)) {
    return {
      valid: false,
      error: `${relation}: invalid target '${targetType}' (expected: ${rule.target.join('|')})`,
    };
  }
  return { valid: true };
}

// =====================================================
// SOURCE PRECEDENCE (higher = wins)
// =====================================================

export const SOURCE_PRECEDENCE: Record<string, number> = {
  user_typed: 100,    // Explicit dashboard edit
  user_stated: 90,    // Direct user statement
  imported: 70,       // Google/Apple import
  system: 50,         // System-generated
  ai_stated: 40,      // AI direct statement
  ai_inferred: 30,    // AI inference
  ai_pattern: 20,     // Statistical pattern
};

// =====================================================
// QUARANTINE HELPERS
// =====================================================

export interface QuarantineEntry {
  sourceType: string;
  targetType: string;
  relation: string;
  sourceName: string;
  targetName: string;
  reason: string;
  payload?: Record<string, any>;
}

export async function insertEdgeQuarantine(
  tx: TransactionSql,
  entry: QuarantineEntry
): Promise<void> {
  try {
    await tx.unsafe(
      `INSERT INTO edge_quarantine (source_type, target_type, relation, source_name, target_name, reason, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.sourceType,
        entry.targetType,
        entry.relation,
        entry.sourceName,
        entry.targetName,
        entry.reason,
        JSON.stringify(entry.payload || {}),
      ]
    );
  } catch (err) {
    logger.warn('Failed to insert edge quarantine entry', { error: String(err), entry });
  }
}
