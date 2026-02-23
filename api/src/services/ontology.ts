/**
 * Ontology — Single source of truth for entity taxonomy, relation taxonomy,
 * allowed relation matrix, display config, and employment model.
 *
 * Self-evolving — novel relations are allowed into the graph (soft quarantine)
 * and flagged for review. Known aliases are normalized to canonical relations.
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
// RELATION TAXONOMY
// =====================================================

export const EDGE_RELATIONS = [
  // Person → Organization
  'works_at', 'attended', 'founded',
  // Person → Person
  'married_to', 'parent_of', 'friend', 'knows', 'family_member', 'communicates_with',
  // Person → Place
  'visited', 'lives_at', 'works_out_at',
  // Person → Food
  'likes', 'dislikes', 'ate', 'allergic_to',
  // Person → Activity/Topic/Preference
  'interested_in', 'has_skill', 'performed', 'follows', 'tracks',
  // Person → Medication
  'takes',
  // Commerce & Ownership
  'owns', 'uses', 'bought', 'created', 'consumed', 'experiences',
  // Entity → Attribute (descriptive properties)
  'has_attribute',
  // Structural (any → any)
  'category', 'similar_to', 'part_of', 'related_to', 'located_at',
  // System
  'thread_next', 'contradicts', 'has_condition',
] as const;

// The (string & {}) trick preserves IDE autocomplete for standard relations
// while allowing the system to naturally ingest novel relations from the LLM.
export type EdgeRelation = (typeof EDGE_RELATIONS)[number] | (string & {});

// =====================================================
// RELATION ALIASES (normalize LLM inventions → canonical)
// =====================================================

const EDGE_RELATION_ALIASES: Record<string, string> = {
  // Family / Person
  child_of: 'family_member', parent: 'parent_of', mother: 'parent_of', father: 'parent_of',
  has_child: 'parent_of', child: 'parent_of', daughter: 'parent_of', son: 'parent_of',
  is_married_to: 'married_to', husband: 'married_to', wife: 'married_to', spouse: 'married_to', partner: 'married_to',
  // Media / Consumption
  read_by: 'interested_in', finished_reading: 'consumed', read: 'consumed',
  watched: 'consumed', listening_to: 'consumed', listened_to: 'consumed', played: 'consumed',
  // Actions
  performed_by: 'attended', completed: 'performed', did: 'performed', engaged_in: 'performed',
  // Creation / Authorship
  author_of: 'created', birth_of: 'created', has_author: 'created', wrote: 'created',
  created_by: 'created', authored_by: 'created', built: 'created', made: 'created',
  // Ownership / Usage
  has: 'owns', possesses: 'owns', belongs_to: 'owns', utilizes: 'uses',
  operates: 'uses', subscribes_to: 'uses',
  // Commerce
  purchased: 'bought', paid_for: 'bought', shopped_at: 'visited',
  // Attributes
  has_age: 'has_attribute', has_birthday: 'has_attribute', has_nickname: 'has_attribute',
  has_relation: 'has_attribute', has_relationship: 'has_attribute', has_name: 'has_attribute',
  has_email: 'has_attribute', has_location: 'has_attribute', has_rating: 'has_attribute',
  is_a: 'has_attribute', status: 'has_attribute',
  // Communication
  spoke_to: 'communicates_with', emailed: 'communicates_with', called: 'communicates_with', met_with: 'communicates_with',
  // Events
  birth_event_of: 'related_to', event_of: 'related_to', happened_on: 'has_attribute',
};

/**
 * Normalize relation aliases to canonical ontology relations.
 * Unknown values pass through unchanged — soft quarantine handles them.
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
  works_at:          { source: ['person'], target: ['organization'] },
  attended:          { source: ['person'], target: ['organization', 'event'] },
  founded:           { source: ['person'], target: ['organization'] },
  married_to:        { source: ['person'], target: ['person'] },
  parent_of:         { source: ['person'], target: ['person'] },
  friend:            { source: ['person'], target: ['person'] },
  knows:             { source: ['person'], target: ['person'] },
  family_member:     { source: ['person'], target: ['person'] },
  communicates_with: { source: ['person', 'organization'], target: ['person', 'organization'] },
  takes:             { source: ['person'], target: ['medication'] },
  ate:               { source: ['person'], target: ['food'] },
  allergic_to:       { source: ['person'], target: ['food', 'topic'] },
  visited:           { source: ['person'], target: ['place', 'organization'] },
  lives_at:          { source: ['person'], target: ['place'] },
  works_out_at:      { source: ['person'], target: ['place'] },
  likes:             { source: ['person'], target: null },
  dislikes:          { source: ['person'], target: null },
  interested_in:     { source: ['person'], target: null },
  has_skill:         { source: ['person'], target: ['topic'] },
  performed:         { source: ['person'], target: ['activity', 'event'] },
  follows:           { source: ['person'], target: ['preference', 'topic'] },
  tracks:            { source: ['person'], target: ['preference'] },
  has_condition:     { source: ['person'], target: ['topic'] },
  // Commerce & Ownership
  owns:              { source: ['person', 'organization'], target: null },
  uses:              { source: ['person', 'organization'], target: null },
  bought:            { source: ['person', 'organization'], target: null },
  created:           { source: ['person', 'organization'], target: null },
  consumed:          { source: ['person'], target: ['food', 'medication', 'media', 'custom'] },
  experiences:       { source: ['person'], target: ['event', 'activity', 'topic', 'custom'] },
  // Attribute
  has_attribute:     { source: null, target: ['preference', 'topic'] },
  // Structural
  category:          { source: null, target: null },
  similar_to:        { source: null, target: null },
  part_of:           { source: null, target: null },
  related_to:        { source: null, target: null },
  located_at:        { source: null, target: ['place'] },
  thread_next:       { source: null, target: null },
  contradicts:       { source: null, target: null },
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
// VALIDATION (Soft Quarantine)
// =====================================================

export function validateEdge(
  sourceType: EntityType,
  targetType: EntityType,
  relation: string
): { valid: boolean; error?: string; quarantine?: boolean } {
  // SELF-EVOLVING MODE: Unknown relations are considered VALID so they can be
  // stored in the graph and naturally adapt to novel use cases.
  // However, we still flag them for quarantine so developers can review
  // and promote popular novel relations to the core EDGE_RELATIONS list over time.
  if (!RELATION_MATRIX[relation]) {
    return {
      valid: true,
      quarantine: true,
      error: `Novel relation '${relation}' — allowed into graph, flagged for review`,
    };
  }

  const rule = RELATION_MATRIX[relation];

  // Soft validation for known relations — allow but flag unexpected type combos
  if (rule.source && !rule.source.includes(sourceType as EntityType)) {
    return {
      valid: true,
      quarantine: true,
      error: `${relation}: unexpected source '${sourceType}' (expected: ${rule.source.join('|')})`,
    };
  }
  if (rule.target && !rule.target.includes(targetType as EntityType)) {
    return {
      valid: true,
      quarantine: true,
      error: `${relation}: unexpected target '${targetType}' (expected: ${rule.target.join('|')})`,
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
