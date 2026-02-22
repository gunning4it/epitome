/**
 * Entity Extraction Service
 *
 * Automatically extracts entities and edges from user data using three methods:
 * - Method C: Rule-based extraction (zero LLM cost, instant)
 * - Method A: LLM-assisted extraction (async, for unknown tables)
 * - Method B: Batch nightly extraction (pg_cron)
 *
 * Reference: EPITOME_TECH_SPEC.md §5.4, §6.2
 * Reference: knowledge-graph SKILL.md
 */

import { withUserSchema, sql as pgSql } from '@/db/client';
import { createEntity, createEdge, getEntityByName, type CreateEntityInput, type CreateEdgeInput } from './graphService';
import { ENTITY_TYPES, type EntityType } from './ontology';
import { checkAndDeduplicateBeforeCreate, type EntityCandidate } from './deduplication';
import { getLatestProfile } from './profile.service';
import { softCheckLimit } from './metering.service';
import { syncEntityToProfile } from './profileSync.service';
import { logger } from '@/utils/logger';

// =====================================================
// FOOD DESCRIPTION PRE-PROCESSING
// =====================================================

/**
 * Parsed food description result
 */
export interface ParsedFoodDescription {
  foodName: string;
  restaurant?: string;
  ingredients?: string;
  dishes?: string[];
}

function normalizeDishName(raw: string): string {
  let name = raw
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/^[\-\u2013\u2014]\s*/, '')
    .replace(/^\band\b\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  name = name.replace(/\bbone[-\s]?in\b/gi, '').replace(/\s+/g, ' ').trim();
  if (/^ribeye$/i.test(name)) {
    name = 'ribeye steak';
  }

  return name;
}

function splitDishCandidates(foodName: string): string[] {
  if (!foodName) return [];

  const protectedText = foodName
    .replace(/mac\s*&\s*cheese/gi, 'mac_and_cheese')
    .replace(/mac\s+and\s+cheese/gi, 'mac_and_cheese');

  const commaParts = protectedText
    .split(',')
    .map((part) => part.replace(/mac_and_cheese/gi, 'mac & cheese').trim())
    .filter(Boolean);

  // If there are many comma parts, this is likely ingredients not dish names.
  const candidates = commaParts.length >= 2 && commaParts.length <= 4
    ? commaParts
    : [foodName];

  const deduped = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeDishName(candidate);
    if (!normalized) continue;
    deduped.add(normalized);
  }

  return Array.from(deduped);
}

/**
 * Parse a food description string into structured components.
 *
 * Handles patterns like:
 * - "Breakfast burrito from Crest Cafe - scrambled eggs, bacon, cheese"
 * - "Pizza from Domino's"
 * - "Pasta Carbonara - cream, bacon, parmesan"
 * - "Chicken tikka masala with rice and naan"
 * - Plain "Sushi" (no separators)
 *
 * @param raw - Raw food description string
 * @returns Parsed components
 */
export function parseFoodDescription(raw: string): ParsedFoodDescription {
  const trimmed = raw.trim();

  if (!trimmed) {
    return { foodName: '' };
  }

  let foodName = trimmed;
  let restaurant: string | undefined;
  let ingredients: string | undefined;

  // Pattern 1: "X from Y - Z" or "X from Y"
  const fromMatch = trimmed.match(/^(.+?)\s+from\s+(.+?)(?:\s*[-–—]\s*(.+))?$/i);
  if (fromMatch) {
    foodName = fromMatch[1].trim();
    restaurant = fromMatch[2].trim();
    if (fromMatch[3]) {
      ingredients = fromMatch[3].trim();
    }
  } else {
    // Pattern 2: "X at Y - Z" or "X at Y"
    const atMatch = trimmed.match(/^(.+?)\s+at\s+(.+?)(?:\s*[-–—]\s*(.+))?$/i);
    if (atMatch) {
      foodName = atMatch[1].trim();
      restaurant = atMatch[2].trim();
      if (atMatch[3]) {
        ingredients = atMatch[3].trim();
      }
    } else {
      // Pattern 3: "X - Y" (food name - description/ingredients)
      const dashMatch = trimmed.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashMatch) {
        foodName = dashMatch[1].trim();
        ingredients = dashMatch[2].trim();
      }
    }
  }

  // Safety net: truncate food name to 80 chars
  if (foodName.length > 80) {
    foodName = foodName.substring(0, 80).trim();
  }

  const result: ParsedFoodDescription = { foodName };
  if (restaurant) result.restaurant = restaurant;
  if (ingredients) result.ingredients = ingredients;
  const dishes = splitDishCandidates(foodName);
  if (dishes.length > 0) result.dishes = dishes;

  return result;
}

// =====================================================
// TYPES
// =====================================================

/**
 * Extracted entity with optional edge information
 */
export interface ExtractedEntity {
  name: string;
  type: EntityType;
  properties?: Record<string, any>;
  // Optional edge to create from user to this entity
  edge?: {
    relation: string;
    weight?: number;
    properties?: Record<string, any>;
    /** If set, edge originates from this entity instead of the owner. Matched by name+type. */
    sourceRef?: { name: string; type: string };
  };
}

/**
 * Extraction result
 */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  method: 'rule_based' | 'llm' | 'batch' | 'llm_first';
}

/**
 * Extraction method type
 */
export type ExtractionMethod = 'rule_based' | 'llm' | 'batch' | 'llm_first';

// =====================================================
// CONTEXT-AWARE EXTRACTION HELPERS
// =====================================================

export interface ExtractionContext {
  currentDate: string;       // "2026-02-15"
  dayOfWeek: string;         // "Saturday"
  yesterday: string;         // "2026-02-14"
  nextMonth: string;         // "2026-03"
  profileSummary: string | null;
  existingEntities: Array<{ name: string; type: string; relation?: string }>;
}

/**
 * Compute temporal reference context from a Date.
 * Pure function — no side effects.
 */
export function getTemporalContext(now: Date): Pick<ExtractionContext, 'currentDate' | 'dayOfWeek' | 'yesterday' | 'nextMonth'> {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const pad = (n: number) => String(n).padStart(2, '0');

  const currentDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dayOfWeek = days[now.getDay()];

  const yd = new Date(now);
  yd.setDate(yd.getDate() - 1);
  const yesterday = `${yd.getFullYear()}-${pad(yd.getMonth() + 1)}-${pad(yd.getDate())}`;

  const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nm.getFullYear()}-${pad(nm.getMonth() + 1)}`;

  return { currentDate, dayOfWeek, yesterday, nextMonth };
}

/**
 * Fetch user profile + top entities to build extraction context.
 * Each DB call wrapped in try/catch — returns partial context on failure.
 */
export async function buildExtractionContext(userId: string): Promise<ExtractionContext> {
  const temporal = getTemporalContext(new Date());
  let profileSummary: string | null = null;
  let existingEntities: ExtractionContext['existingEntities'] = [];

  // 1. Profile summary
  try {
    const profile = await getLatestProfile(userId);
    if (profile?.data) {
      const parts: string[] = [];
      if (profile.data.name) parts.push(`Name: ${profile.data.name}`);
      if (profile.data.timezone) parts.push(`Timezone: ${profile.data.timezone}`);
      if (profile.data.family) {
        const members = Array.isArray(profile.data.family)
          ? profile.data.family
          : Object.entries(profile.data.family).flatMap(([rel, m]: [string, any]) => {
              if (Array.isArray(m)) {
                return m
                  .filter((member) => member && typeof member === 'object')
                  .map((member) => ({ ...member, relation: normalizeFamilyRole(rel) }));
              }
              if (m && typeof m === 'object') {
                return [{ ...m, relation: normalizeFamilyRole(rel) }];
              }
              return [];
            });
        for (const m of members) {
          if (m.name) parts.push(`${m.relation || 'family'}: ${m.name}`);
        }
      }
      // Work/career context
      const pdata = profile.data as Record<string, any>;
      const workCompany = pdata.career?.primary_job?.company || pdata.work?.company;
      const workRole = pdata.career?.primary_job?.title || pdata.work?.role;
      if (workCompany) parts.push(`Company: ${workCompany}`);
      if (workRole) parts.push(`Role: ${workRole}`);

      if (parts.length > 0) profileSummary = parts.join('; ');
    }
  } catch (err) {
    logger.warn('buildExtractionContext: failed to fetch profile', { error: String(err) });
  }

  // 2. Top 50 entities by mention_count with primary edge relation
  try {
    existingEntities = await withUserSchema(userId, async (tx) => {
      const rows = await tx.unsafe<Array<{ name: string; type: string; relation: string | null }>>(`
        SELECT e.name, e.type, (
          SELECT ed.relation FROM edges ed
          WHERE ed.target_id = e.id AND ed._deleted_at IS NULL
          ORDER BY ed.weight DESC
          LIMIT 1
        ) AS relation
        FROM entities e
        WHERE e._deleted_at IS NULL
        ORDER BY e.mention_count DESC
        LIMIT 50
      `);
      return rows.map(r => ({
        name: r.name,
        type: r.type,
        ...(r.relation ? { relation: r.relation } : {}),
      }));
    });
  } catch (err) {
    logger.warn('buildExtractionContext: failed to fetch entities', { error: String(err) });
  }

  return { ...temporal, profileSummary, existingEntities };
}

/**
 * Build the context-aware system prompt for LLM extraction.
 * Pure function — assembles sections conditionally.
 */
export function buildContextAwarePrompt(context: ExtractionContext): string {
  let prompt = `You are the entity extraction engine for a personal knowledge graph. Extract people, organizations, places, foods, topics, preferences, events, activities, medications, and media from the user's data.

Return JSON matching the required schema. Each entity needs name, type, properties, and edge (or null).

## Today
${context.currentDate} (${context.dayOfWeek})
Temporal reference guide: "yesterday" = ${context.yesterday}, "next month" = ${context.nextMonth}`;

  if (context.profileSummary) {
    prompt += `

## User Profile
${context.profileSummary}`;
  }

  if (context.existingEntities.length > 0) {
    const entityLines = context.existingEntities.map(e => {
      const parts = [`"${e.name}" (${e.type})`];
      if (e.relation) parts.push(`relation: ${e.relation}`);
      return `- ${parts.join(', ')}`;
    }).join('\n');
    prompt += `

## Known Entities (match these names when possible — do NOT create duplicates)
${entityLines}`;
  }

  prompt += `

## Rules
1. TEMPORAL: Resolve ALL relative dates to ISO strings. "next month" → "${context.nextMonth}", "yesterday" → "${context.yesterday}", "last Tuesday" → compute from today. Store resolved dates in entity properties as \`resolved_date\` or in edge properties as \`when\`.
2. DISAMBIGUATION: When a name matches or is close to a known entity, use that exact name and type. Do NOT create a new entity if a match exists.
3. ENTITY-TO-ENTITY: Use sourceRef when a relationship belongs to another entity, not the user. "Sarah is moving to Portland" → Portland entity with sourceRef pointing to Sarah.
4. SELECTIVITY: Only extract clear, meaningful entities. Skip vague references, pronouns without antecedents, filler words.
5. EVENTS: Create event entities for specific occurrences with resolved dates.
6. Both free text and structured data are valid inputs — extract from either form.`;

  return prompt;
}

/**
 * Build the user prompt, detecting free text vs structured data.
 * Pure function.
 */
export function buildUserPrompt(tableName: string, record: Record<string, any>): string {
  const text = record.text || record.content || record.note || record.entry;
  if (typeof text === 'string' && text.length > 20) {
    // Prose mode — quote the text, add metadata separately
    const meta: Record<string, any> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k !== 'text' && k !== 'content' && k !== 'note' && k !== 'entry' && k !== 'id') {
        meta[k] = v;
      }
    }
    const metaStr = Object.keys(meta).length > 0
      ? `\nMetadata: ${JSON.stringify(meta)}`
      : '';
    return `Source: ${tableName}\nText: "${text}"${metaStr}\n\nExtract entities and relationships:`;
  }

  // Structured mode
  return `Table: ${tableName}\nData: ${JSON.stringify(record, null, 2)}\n\nExtract entities and relationships:`;
}

// =====================================================
// RULE-BASED EXTRACTION (Method C)
// =====================================================

/**
 * Keys on a family member object that are handled explicitly and should NOT
 * be treated as nested family members when scanning for sub-objects.
 */
const KNOWN_MEMBER_KEYS = new Set([
  'name', 'relation', 'age', 'birthday', 'nickname',
  'preferences', 'interests', 'allergies', 'dislikes',
  'food_dislikes', 'food_preferences',
]);

/**
 * Extract entities from a single family member object.
 *
 * Produces:
 * - Person entity (edge from owner, as before)
 * - Food preference entities with sourceRef → family member
 * - Interest topic entities with sourceRef
 * - Allergy topic entities with sourceRef
 * - Dislike preference entities with sourceRef
 * - Flat string/boolean preference entities with sourceRef
 * - Nested family members (e.g., wife.mother) recursively
 */
// Map raw family role names (wife, mother, etc.) to valid ontology edge relations.
// The original role is preserved in edge.properties.family_role.
const SPOUSE_ROLE_SET = new Set(['wife', 'husband', 'spouse', 'partner']);
function mapFamilyRoleToRelation(role: string): string {
  if (SPOUSE_ROLE_SET.has(role)) return 'married_to';
  return 'family_member';
}

function normalizeFamilyRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === 'children' || normalized === 'kids') return 'child';
  if (normalized === 'parents') return 'parent';
  return normalized;
}

function extractFamilyMemberEntities(
  member: Record<string, any>,
  relation: string,
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  if (!member.name) return entities;

  const memberRef = { name: member.name, type: 'person' as const };

  // 1. Person entity (edge from owner)
  entities.push({
    name: member.name,
    type: 'person',
    properties: {
      relation,
      age: member.age,
      birthday: member.birthday,
      ...(member.nickname ? { nickname: member.nickname } : {}),
    },
    edge: {
      relation: mapFamilyRoleToRelation(relation),
      weight: 1.0,
      properties: { family_role: relation },
    },
  });

  // 2. Food preferences → food entities with sourceRef
  const prefs = member.preferences;
  if (prefs?.food?.favorites && Array.isArray(prefs.food.favorites)) {
    for (const item of prefs.food.favorites) {
      if (typeof item === 'string') {
        entities.push({
          name: item,
          type: 'food',
          properties: {},
          edge: { relation: 'likes', weight: 1.0, sourceRef: memberRef },
        });
      }
    }
  }

  // 3. Interests → topic entities with sourceRef
  if (Array.isArray(member.interests)) {
    for (const interest of member.interests) {
      if (typeof interest === 'string') {
        entities.push({
          name: interest,
          type: 'topic',
          properties: { category: 'interest' },
          edge: { relation: 'interested_in', weight: 1.0, sourceRef: memberRef },
        });
      }
    }
  }

  // 4. Allergies → topic entities with sourceRef
  if (Array.isArray(member.allergies)) {
    for (const allergy of member.allergies) {
      if (typeof allergy === 'string') {
        entities.push({
          name: allergy,
          type: 'topic',
          properties: { category: 'allergy' },
          edge: { relation: 'allergic_to', weight: 1.0, sourceRef: memberRef },
        });
      }
    }
  }

  // 5. Dislikes → preference entities with sourceRef (array or food_dislikes)
  const dislikeArrays = [member.dislikes, member.food_dislikes].filter(Array.isArray);
  for (const arr of dislikeArrays) {
    for (const dislike of arr) {
      if (typeof dislike === 'string') {
        entities.push({
          name: dislike,
          type: 'preference',
          properties: { category: 'dislike' },
          edge: { relation: 'dislikes', weight: 1.0, sourceRef: memberRef },
        });
      }
    }
  }

  // 6. Flat string/boolean preferences with sourceRef
  if (prefs && typeof prefs === 'object') {
    for (const [key, value] of Object.entries(prefs)) {
      if (key === 'food') continue; // Already handled above
      if (typeof value === 'string' || typeof value === 'boolean') {
        entities.push({
          name: key,
          type: 'preference',
          properties: { value, category: 'preference' },
          edge: {
            relation: value ? 'likes' : 'dislikes',
            weight: 1.0,
            sourceRef: memberRef,
          },
        });
      }
    }
  }

  // 7. Nested family members (e.g., wife.mother → { name: "Lauren", nickname: "Moo Moo" })
  for (const [key, value] of Object.entries(member)) {
    if (KNOWN_MEMBER_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && value.name) {
      // Recursively extract nested member and their attributes
      const nestedEntities = extractFamilyMemberEntities(value, key);

      if (nestedEntities.length > 0 && nestedEntities[0].type === 'person') {
        // Add an owner → nested member edge so they're discoverable
        // All nested family connections use 'family_member' with specific role in properties
        entities.push({
          name: nestedEntities[0].name,
          type: 'person',
          properties: nestedEntities[0].properties,
          edge: { relation: 'family_member', weight: 1.0, properties: { family_role: key } },
        });

        // Change the recursive person entry's edge to parent → nested (sourceRef)
        nestedEntities[0].edge = {
          relation: mapFamilyRoleToRelation(key),
          weight: 1.0,
          sourceRef: memberRef,
          properties: { family_role: key },
        };
      }

      entities.push(...nestedEntities);
    }
  }

  return entities;
}

const GENERIC_SKIP_KEYS = new Set([
  'id',
  '_meta_id',
  '_deleted_at',
  'created_at',
  'updated_at',
  'version',
  // Prose fields — contain full sentences, not entity names
  'text',
  'content',
  'note',
  'entry',
  'description',
  'summary',
  'body',
  'message',
  'comment',
]);

const GENERIC_SYSTEM_KEYS = new Set([
  'source',
  'source_ref',
  'source_ref_hint',
  'agent',
  'agent_id',
  'agent_name',
  'origin',
  'collection',
  'table',
  'table_name',
  'record_id',
  'resource',
  'resource_type',
  'resource_id',
  'write_status',
  'job_id',
  'vector_id',
  'pending_vector_id',
]);

const LOW_SIGNAL_NAMES = new Set([
  'add_record',
  'save_memory',
  'mcp_add_record',
  'mcp_save_memory',
  'unknown',
  'none',
  'null',
  'undefined',
  'value',
  'test',
  'true',
  'false',
  'yes',
  'no',
  'n/a',
  'user',
  'profile',
  'data',
  'record',
  'entry',
  'item',
  'thing',
  'update',
  'note',
  'notes',
  'info',
  'general',
  'other',
  'misc',
  'default',
  'new',
  'old',
  'current',
  'previous',
  'latest',
]);

const LOW_SIGNAL_BY_TYPE: Partial<Record<ExtractedEntity['type'], Set<string>>> = {
  food: new Set(['bone']),
};

function looksLikeDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[t\s].*)?$/i.test(value);
}

function inferGenericEntityType(tableName: string, path: string[]): EntityType {
  const joined = path.join('.').toLowerCase();

  if (/(family|wife|husband|spouse|partner|daughter|son|mother|father|friend|member|nickname|name)/.test(joined)) {
    return 'person';
  }
  if (/(work|company|employer|organization|org|corporation|firm|business|workplace)/.test(joined)) {
    return 'organization';
  }
  if (/(school|university|college|institute|academy|education)/.test(joined)) {
    return 'organization';
  }
  if (/(gym|location|city|state|country|address|place|home|house|restaurant|cafe|beach|park)/.test(joined)) {
    return 'place';
  }
  if (/(food|meal|dish|cuisine|diet|ingredient|nutrition)/.test(joined)) {
    return 'food';
  }
  if (/(exercise|workout|fitness|activity|wellness|sauna|sport|hobby|interest)/.test(joined)) {
    return 'activity';
  }
  if (/(medication|dose|drug|prescription)/.test(joined)) {
    return 'medication';
  }
  if (/(skill|expertise|proficiency|competency)/.test(joined)) {
    return 'topic';
  }
  if (/(goal|preference|plan|likes|loves|dislikes|avoid|condition|health)/.test(joined)) {
    return 'preference';
  }
  if (tableName === 'profile') {
    return 'preference';
  }
  return 'topic';
}

function inferGenericRelation(path: string[], entityType: EntityType): string {
  const joined = path.join('.').toLowerCase();
  const relationFromFamily = path.includes('family') ? path[path.indexOf('family') + 1] : undefined;

  if (/(dislike|avoid|allerg)/.test(joined)) return 'dislikes';
  if (/(condition|diagnosis)/.test(joined)) return 'has_condition';
  if (/(goal|target|plan)/.test(joined)) return 'tracks';
  if (entityType === 'organization' && /(work|company|employer)/.test(joined)) return 'works_at';
  if (entityType === 'organization' && /(school|university|education)/.test(joined)) return 'attended';
  if (entityType === 'medication') return 'takes';
  if (entityType === 'place' && /gym/.test(joined)) return 'works_out_at';
  if (entityType === 'person' && relationFromFamily) return mapFamilyRoleToRelation(relationFromFamily);
  if (entityType === 'person') return 'knows';
  if (/(skill|expertise)/.test(joined)) return 'has_skill';
  if (entityType === 'activity') return 'likes';
  if (entityType === 'food') return 'likes';
  if (entityType === 'topic') return 'interested_in';
  return 'likes';
}

function extractGoalPairEntities(
  value: unknown,
  path: string[] = []
): ExtractedEntity[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const entities: ExtractedEntity[] = [];
  const obj = value as Record<string, unknown>;
  const pairs = new Map<string, { current?: number; goal?: number }>();

  for (const [key, raw] of Object.entries(obj)) {
    if (typeof raw !== 'number') continue;
    const match = key.match(/^(current|goal)_(.+)$/);
    if (!match) continue;

    const [, kind, suffix] = match;
    const pair = pairs.get(suffix) || {};
    if (kind === 'current') pair.current = raw;
    if (kind === 'goal') pair.goal = raw;
    pairs.set(suffix, pair);
  }

  for (const [suffix, pair] of pairs.entries()) {
    if (pair.current === undefined || pair.goal === undefined) continue;
    entities.push({
      name: `${suffix.replace(/_/g, ' ')} goal`,
      type: 'preference',
      properties: {
        current: pair.current,
        goal: pair.goal,
        path: path.join('.') || 'root',
      },
      edge: {
        relation: 'tracks',
        weight: 1.0,
      },
    });
  }

  for (const [key, nested] of Object.entries(obj)) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      entities.push(...extractGoalPairEntities(nested, [...path, key]));
    }
  }

  return entities;
}

function collectGenericEntities(
  tableName: string,
  value: unknown,
  path: string[],
  entities: ExtractedEntity[]
): void {
  if (value === null || value === undefined) return;

  const lastKey = path[path.length - 1]?.toLowerCase();
  if (lastKey && GENERIC_SKIP_KEYS.has(lastKey)) return;
  if (lastKey && GENERIC_SYSTEM_KEYS.has(lastKey)) return;
  if (path.length >= 2 && path[0].toLowerCase() === 'metadata' && lastKey && GENERIC_SYSTEM_KEYS.has(lastKey)) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 80) return;
    if (looksLikeDateString(trimmed)) return;

    const entityType = inferGenericEntityType(tableName, path);
    const relation = inferGenericRelation(path, entityType);
    entities.push({
      name: trimmed,
      type: entityType,
      properties: {
        path: path.join('.'),
      },
      edge: {
        relation,
        weight: 0.8,
      },
    });
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGenericEntities(tableName, item, path, entities);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectGenericEntities(tableName, nested, [...path, key], entities);
    }
  }
}

function normalizeExtractedEntityName(entity: ExtractedEntity): string {
  let name = entity.name
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`.,;:()\[\]{}!?-]+|[\s"'`.,;:()\[\]{}!?-]+$/g, '')
    .trim();

  if (entity.type === 'food') {
    name = name.replace(/\bbone[-\s]?in\b/gi, '').replace(/\s+/g, ' ').trim();
    if (/^ribeye$/i.test(name)) {
      name = 'ribeye steak';
    }
  }

  return name;
}

function shouldDropExtractedEntity(entity: ExtractedEntity): boolean {
  const normalized = normalizeExtractedEntityName(entity);
  if (!normalized || normalized.length < 2 || normalized.length > 120) return true;
  if (looksLikeDateString(normalized)) return true;

  const lower = normalized.toLowerCase();
  if (LOW_SIGNAL_NAMES.has(lower)) return true;
  if (LOW_SIGNAL_BY_TYPE[entity.type]?.has(lower)) return true;
  if (/^[a-z]+(?:_[a-z0-9]+)+$/.test(lower) && !lower.includes(' ')) return true;

  // Drop names starting with system/metadata terms
  if (/^(profile|table|collection|vector|memory|audit|system)\b/i.test(lower)) return true;
  // Drop pure numeric strings
  if (/^\d+$/.test(lower)) return true;
  // Drop short generic words when type is 'topic'
  if (lower.length <= 3 && entity.type === 'topic') return true;

  return false;
}

function sanitizeExtractedEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const sanitized: ExtractedEntity[] = [];

  for (const entity of entities) {
    if (shouldDropExtractedEntity(entity)) continue;
    sanitized.push({
      ...entity,
      name: normalizeExtractedEntityName(entity),
    });
  }

  return dedupeExtractedEntities(sanitized);
}

function dedupeExtractedEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Set<string>();
  const result: ExtractedEntity[] = [];

  for (const entity of entities) {
    const sourceRefKey = entity.edge?.sourceRef ? `:ref:${entity.edge.sourceRef.name}` : '';
    const key = `${entity.type}:${entity.name.toLowerCase()}:${entity.edge?.relation || ''}${sourceRefKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entity);
  }

  return result;
}

function extractEntitiesGeneric(
  tableName: string,
  record: Record<string, unknown>
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  collectGenericEntities(tableName, record, [], entities);
  entities.push(...extractGoalPairEntities(record));
  return dedupeExtractedEntities(entities);
}

/**
 * Extraction rules for known table types
 * Hardcoded patterns for common data structures
 */
const EXTRACTION_RULES: Record<string, (data: Record<string, unknown>) => ExtractedEntity[]> = {
  meals: (data) => {
    const entities: ExtractedEntity[] = [];

    const rawFood = data.food || data.meal || data.text;

    // Extract food entities — split list-style dishes where possible.
    if (rawFood) {
      const parsed = parseFoodDescription(String(rawFood));
      const dishNames = parsed.dishes && parsed.dishes.length > 0
        ? parsed.dishes
        : [parsed.foodName || String(rawFood)];

      for (const foodName of dishNames) {
        entities.push({
          name: foodName,
          type: 'food',
          properties: {
            calories: data.calories,
            meal_type: data.meal_type,
            ...(parsed.ingredients ? { ingredients: parsed.ingredients } : {}),
          },
          edge: {
            relation: 'ate',
            weight: 1.0,
            properties: {
              when: data.created_at || new Date().toISOString(),
              calories: data.calories,
            },
          },
        });
      }

      // If parsed a restaurant from food text and no explicit restaurant/location column exists,
      // create a place entity from the parsed restaurant.
      if (parsed.restaurant && !data.restaurant && !data.location) {
        entities.push({
          name: parsed.restaurant,
          type: 'place',
          properties: {
            category: 'restaurant',
          },
          edge: {
            relation: 'visited',
            weight: 1.0,
          },
        });
      }
    }

    // Extract place entity if explicit location/restaurant column exists
    if (data.restaurant || data.location) {
      entities.push({
        name: String(data.restaurant || data.location),
        type: 'place',
        properties: {
          category: 'restaurant',
        },
        edge: {
          relation: 'visited',
          weight: 1.0,
        },
      });
    }

    return entities;
  },

  workouts: (data) => {
    const entities: ExtractedEntity[] = [];

    // Extract activity entity
    if (data.exercise || data.activity) {
      entities.push({
        name: String(data.exercise || data.activity),
        type: 'activity',
        properties: {
          duration: data.duration,
          intensity: data.intensity,
          calories_burned: data.calories_burned,
        },
        edge: {
          relation: 'performed',
          weight: 1.0,
          properties: {
            when: data.created_at || new Date().toISOString(),
            duration: data.duration,
          },
        },
      });
    }

    // Extract place if location mentioned
    if (data.location || data.gym) {
      entities.push({
        name: String(data.location || data.gym),
        type: 'place',
        properties: {
          category: 'gym',
        },
        edge: {
          relation: 'visited',
          weight: 1.0,
        },
      });
    }

    return entities;
  },

  medications: (data) => {
    const entities: ExtractedEntity[] = [];

    // Extract medication entity
    if (data.name || data.medication_name) {
      entities.push({
        name: String(data.name || data.medication_name),
        type: 'medication',
        properties: {
          dose: data.dose || data.dosage,
          frequency: data.frequency,
          purpose: data.purpose || data.reason,
        },
        edge: {
          relation: 'takes',
          weight: 1.0,
          properties: {
            dose: data.dose || data.dosage,
            frequency: data.frequency,
          },
        },
      });
    }

    return entities;
  },

  profile: (data) => {
    const entities: ExtractedEntity[] = [];

    // Note: owner entity is created automatically by findOrCreateOwnerEntity()
    // when edges are created — no need to push a separate is_owner entity here.

    // Extract family members from profile.family array
    if (data.family && Array.isArray(data.family)) {
      for (const member of data.family) {
        if (member && typeof member === 'object') {
          const relation = typeof member.relation === 'string'
            ? normalizeFamilyRole(member.relation)
            : 'family_member';
          entities.push(...extractFamilyMemberEntities(member, relation));
        }
      }
    }

    // Extract family members from profile.family object
    // (e.g. { wife: { name, birthday }, children: [{ name: ... }] })
    if (data.family && typeof data.family === 'object' && !Array.isArray(data.family)) {
      for (const [relation, member] of Object.entries(data.family as Record<string, any>)) {
        const normalizedRelation = normalizeFamilyRole(relation);
        if (Array.isArray(member)) {
          for (const nestedMember of member) {
            if (nestedMember && typeof nestedMember === 'object') {
              entities.push(...extractFamilyMemberEntities(nestedMember, normalizedRelation));
            }
          }
        } else if (member && typeof member === 'object') {
          entities.push(...extractFamilyMemberEntities(member, normalizedRelation));
        }
      }
    }

    // Extract food favorites from nested preferences.food
    const food = (data.preferences as any)?.food;
    if (food?.favorites && Array.isArray(food.favorites)) {
      for (const item of food.favorites) {
        if (typeof item === 'string') {
          entities.push({
            name: item,
            type: 'food',
            properties: { regional_style: food.regional_style },
            edge: { relation: 'likes', weight: 1.0 },
          });
        }
      }
    }

    // Extract health conditions and dietary goals
    if (data.health && typeof data.health === 'object') {
      const health = data.health as Record<string, unknown>;
      if (Array.isArray(health.conditions)) {
        for (const condition of health.conditions) {
          if (typeof condition === 'string') {
            entities.push({
              name: condition,
              type: 'topic',
              properties: { category: 'health_condition' },
              edge: { relation: 'has_condition', weight: 1.0 },
            });
          }
        }
      }
      if (Array.isArray(health.dietary_goals)) {
        for (const goal of health.dietary_goals) {
          if (typeof goal === 'string') {
            entities.push({
              name: goal,
              type: 'preference',
              properties: { category: 'dietary_goal' },
              edge: { relation: 'follows', weight: 1.0 },
            });
          }
        }
      }
    }

    // Extract flat preferences (string/boolean values)
    if (data.preferences && typeof data.preferences === 'object') {
      for (const [key, value] of Object.entries(data.preferences)) {
        if (typeof value === 'string' || typeof value === 'boolean') {
          entities.push({
            name: key,
            type: 'preference',
            properties: {
              value: value,
              category: 'user_preference',
            },
            edge: {
              relation: value ? 'likes' : 'dislikes',
              weight: 1.0,
            },
          });
        }
      }
    }

    // Extract work/career data → organization entity + works_at edge with role qualifier
    const workCompany = (data.career as any)?.primary_job?.company || (data.work as any)?.company;
    const workRole = (data.career as any)?.primary_job?.title || (data.work as any)?.role;

    if (workCompany && typeof workCompany === 'string') {
      entities.push({
        name: workCompany,
        type: 'organization',
        properties: { category: 'employer' },
        edge: {
          relation: 'works_at',
          weight: 1.0,
          properties: {
            role: workRole || undefined,
            is_current: true,
          },
        },
      });
    }

    // Extract education → organization entity + attended edge
    if (data.education && typeof data.education === 'object') {
      const edu = data.education as Record<string, any>;
      if (edu.institution && typeof edu.institution === 'string') {
        entities.push({
          name: edu.institution,
          type: 'organization',
          properties: {
            category: 'education',
            ...(edu.degree ? { degree: edu.degree } : {}),
            ...(edu.field ? { field: edu.field } : {}),
          },
          edge: { relation: 'attended', weight: 1.0 },
        });
      }
    }

    // Extract interests → activity entities + interested_in edges
    if (Array.isArray(data.interests)) {
      for (const interest of data.interests as unknown[]) {
        if (typeof interest === 'string') {
          entities.push({
            name: interest,
            type: 'activity',
            properties: { category: 'interest' },
            edge: { relation: 'interested_in', weight: 1.0 },
          });
        }
      }
    }

    // Extract skills → topic entities + has_skill edges
    if (Array.isArray(data.skills)) {
      for (const skill of data.skills as unknown[]) {
        if (typeof skill === 'string') {
          entities.push({
            name: skill,
            type: 'topic',
            properties: { category: 'skill' },
            edge: { relation: 'has_skill', weight: 1.0 },
          });
        }
      }
    }

    // Extract social connections (friends, colleagues, etc.)
    if (data.social && typeof data.social === 'object') {
      const social = data.social as Record<string, any>;
      if (social.friends && typeof social.friends === 'object') {
        for (const [groupName, group] of Object.entries(social.friends as Record<string, any>)) {
          if (!group || typeof group !== 'object') continue;
          const members = group.members;
          if (!Array.isArray(members)) continue;

          // Determine edge source from relation field (e.g. "Brianna's friends")
          let sourceRef: { name: string; type: 'person' } | undefined;
          if (typeof group.relation === 'string') {
            const relMatch = group.relation.match(/^(\w+)(?:'s?\s)/i);
            if (relMatch) {
              const refName = relMatch[1];
              // Search family for matching first name
              if (data.family && typeof data.family === 'object' && !Array.isArray(data.family)) {
                for (const member of Object.values(data.family as Record<string, any>)) {
                  if (member?.name && member.name.split(' ')[0].toLowerCase() === refName.toLowerCase()) {
                    sourceRef = { name: member.name, type: 'person' };
                    break;
                  }
                }
              }
            }
          }

          for (const memberName of members) {
            if (typeof memberName !== 'string') continue;
            entities.push({
              name: memberName,
              type: 'person',
              properties: {
                group: groupName,
                ...(group.location ? { location: group.location } : {}),
              },
              edge: {
                relation: 'friend',
                weight: 1.0,
                ...(sourceRef ? { sourceRef } : {}),
              },
            });
          }
        }
      }
    }

    return entities;
  },
};

/**
 * Extract entities from a record using rule-based patterns
 *
 * @param tableName - Name of the table
 * @param record - Record data
 * @returns Extracted entities
 */
export function extractEntitiesRuleBased(
  tableName: string,
  record: Record<string, any>
): ExtractedEntity[] {
  const extractor = EXTRACTION_RULES[tableName];

  if (!extractor) {
    // No rules for this table — use generic extraction
    return sanitizeExtractedEntities(extractEntitiesGeneric(tableName, record));
  }

  try {
    const fromRules = extractor(record);
    if (fromRules.length === 0) {
      // Rules produced nothing — fall back to generic
      return sanitizeExtractedEntities(extractEntitiesGeneric(tableName, record));
    }
    // Rules produced results — use only rule output (generic adds noise for known tables)
    return sanitizeExtractedEntities(fromRules);
  } catch (error) {
    logger.error('Error in rule-based extraction', { tableName, error: String(error) });
    return sanitizeExtractedEntities(extractEntitiesGeneric(tableName, record));
  }
}

// =====================================================
// LLM-ASSISTED EXTRACTION (Method A)
// =====================================================

/**
 * Extract entities using LLM (gpt-5-mini via OpenAI Responses API)
 * Async, non-blocking, for unknown table types
 *
 * When userId is provided, builds context (profile + known entities + temporal refs)
 * for disambiguation and temporal resolution. Without userId, uses a generic prompt.
 *
 * @param tableName - Name of the table
 * @param record - Record data
 * @param userId - Optional user ID for context-aware extraction
 * @returns Promise of extracted entities
 */
export async function extractEntitiesLLM(
  tableName: string,
  record: Record<string, any>,
  userId?: string
): Promise<ExtractedEntity[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set, skipping LLM extraction');
    return [];
  }

  let systemPrompt: string;
  let userPrompt: string;

  if (userId) {
    // Context-aware path: inject profile, entities, and temporal context
    const context = await buildExtractionContext(userId);
    systemPrompt = buildContextAwarePrompt(context);
    userPrompt = buildUserPrompt(tableName, record);
  } else {
    // Legacy generic path (backward compat for tests, batch jobs without userId)
    systemPrompt = `You are an entity extraction system. Extract entities (people, organizations, places, foods, topics, preferences, events, activities, medications, media) and their relationships from structured data.

Return JSON array of entities with this schema:
[{
  "name": "entity name",
  "type": "${[...ENTITY_TYPES].join('|')}",
  "properties": { additional metadata },
  "edge": {
    "relation": "likes|dislikes|ate|visited|performed|takes|interested_in|allergic_to|etc",
    "weight": 1.0,
    "sourceRef": { "name": "entity name", "type": "entity type" } // optional — if set, edge originates from this entity instead of the owner
  }
}]

By default, edges originate from the owner (user). Use sourceRef when a relationship belongs to another entity (e.g. "wife likes sushi" → sourceRef points to the wife entity, not the user).
Only extract clear, meaningful entities. Omit generic or unclear data.`;

    userPrompt = `Table: ${tableName}
Data: ${JSON.stringify(record, null, 2)}

Extract entities and relationships:`;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'extracted_entities',
            strict: false,
            schema: {
              type: 'object',
              properties: {
                entities: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: [...ENTITY_TYPES] },
                      properties: { type: 'object', additionalProperties: false },
                      edge: {
                        type: ['object', 'null'],
                        properties: {
                          relation: { type: 'string' },
                          weight: { type: 'number' },
                          sourceRef: {
                            type: ['object', 'null'],
                            properties: {
                              name: { type: 'string' },
                              type: { type: 'string' },
                            },
                            required: ['name', 'type'],
                            additionalProperties: false,
                          },
                        },
                        required: ['relation', 'weight', 'sourceRef'],
                        additionalProperties: false,
                      },
                    },
                    required: ['name', 'type', 'properties', 'edge'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['entities'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json() as {
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      output_text?: string;
    };

    // Responses API: find the message output (skip reasoning), then get output_text content
    const messageOutput = data.output?.find((o) => o.type === 'message');
    const textContent = messageOutput?.content?.find((c) => c.type === 'output_text')?.text
      || data.output_text
      || '{"entities":[]}';
    const parsed = JSON.parse(textContent) as { entities: ExtractedEntity[] };

    return sanitizeExtractedEntities(parsed.entities);
  } catch (error) {
    logger.error('Error in LLM extraction', { error: String(error) });
    return [];
  }
}

// =====================================================
// INTER-ENTITY EDGE CREATION (LLM-assisted)
// =====================================================

/**
 * Reference to a recently created entity
 */
export interface CreatedEntityRef {
  id: number;
  name: string;
  type: string;
}

/**
 * Result of inter-entity edge creation
 */
interface InterEntityEdgeResult {
  newEntities: Array<{ name: string; type: string; id?: number }>;
  edges: Array<{ sourceId: number; targetId: number; relation: string; weight: number }>;
}

/**
 * Create inter-entity edges using LLM analysis
 *
 * Takes a batch of recently created entities and asks Claude to identify
 * relationships between them: category, similar_to, part_of, related_to.
 * Also creates new parent category entities as needed.
 *
 * @param userId - User ID for schema isolation
 * @param entities - Recently created entities with IDs
 * @returns Created entities and edges
 */
export async function createInterEntityEdgesLLM(
  userId: string,
  entities: CreatedEntityRef[]
): Promise<InterEntityEdgeResult> {
  const result: InterEntityEdgeResult = { newEntities: [], edges: [] };

  if (entities.length < 2) {
    return result;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set, skipping inter-entity edge creation');
    return result;
  }

  const systemPrompt = `You are a knowledge graph relationship analyzer. Given a list of entities, identify meaningful relationships between them.

Return a JSON object with:
- "new_entities": parent category entities that should be created (e.g., "Mexican food" as a category for "San Diego-style burrito")
- "edges": relationships between entities (using entity names as references)

Valid edge relations:
- "category": specific → general (e.g., "San Diego-style burrito" → "Mexican food")
- "similar_to": variants or related items (e.g., "San Diego-style burrito" ↔ "breakfast burritos")
- "part_of": hierarchical membership (e.g., "more fish" → "Mediterranean diet")
- "related_to": loose thematic connection (e.g., "eating healthier" → "Mediterranean diet")

Rules:
- Only create edges for genuinely related entities
- New category entities should have type matching their children (e.g., food categories are type "food")
- Weights: category=1.0, similar_to=0.8, part_of=0.9, related_to=0.6
- Do NOT create trivial or obvious-only relationships
- Keep new_entities minimal — only create parent categories when multiple entities share one

Return JSON only, no explanation:
{
  "new_entities": [{ "name": "...", "type": "...", "properties": { "is_category": true } }],
  "edges": [{ "source_name": "...", "target_name": "...", "relation": "...", "weight": 1.0 }]
}`;

  const entityList = entities.map((e) => `- "${e.name}" (type: ${e.type})`).join('\n');
  const userPrompt = `Entities:\n${entityList}\n\nIdentify inter-entity relationships:`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'inter_entity_edges',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                new_entities: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: [...ENTITY_TYPES] },
                    },
                    required: ['name', 'type'],
                    additionalProperties: false,
                  },
                },
                edges: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      source_name: { type: 'string' },
                      target_name: { type: 'string' },
                      relation: { type: 'string', enum: ['category', 'similar_to', 'part_of', 'related_to'] },
                      weight: { type: 'number' },
                    },
                    required: ['source_name', 'target_name', 'relation', 'weight'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['new_entities', 'edges'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json() as {
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      output_text?: string;
    };

    // Responses API: find the message output (skip reasoning), then get output_text content
    const messageOutput = data.output?.find((o) => o.type === 'message');
    const textContent = messageOutput?.content?.find((c) => c.type === 'output_text')?.text
      || data.output_text  // shorthand
      || '{"new_entities":[],"edges":[]}';

    const llmResult = JSON.parse(textContent) as {
      new_entities: Array<{ name: string; type: string }>;
      edges: Array<{ source_name: string; target_name: string; relation: string; weight: number }>;
    };

    logger.info('Inter-entity LLM parsed result', {
      newEntities: llmResult.new_entities?.length ?? 0,
      edges: llmResult.edges?.length ?? 0,
    });

    // Build name → id lookup from existing entities
    const nameToId = new Map<string, number>();
    for (const entity of entities) {
      nameToId.set(entity.name.toLowerCase(), entity.id);
    }

    // Create new category entities
    if (llmResult.new_entities && Array.isArray(llmResult.new_entities)) {
      for (const newEntity of llmResult.new_entities) {
        if (!newEntity.name || !newEntity.type) continue;
        const candidateEntity: ExtractedEntity = {
          name: newEntity.name,
          type: newEntity.type as ExtractedEntity['type'],
        };
        if (shouldDropExtractedEntity(candidateEntity)) continue;
        const normalizedName = normalizeExtractedEntityName(candidateEntity);

        try {
          // Dedup check before creating
          const candidate: EntityCandidate = {
            type: newEntity.type as EntityType,
            name: normalizedName,
          };

          const existingId = await checkAndDeduplicateBeforeCreate(userId, candidate);
          let entityId: number;

          if (existingId) {
            entityId = existingId;
          } else {
            const created = await createEntity(userId, {
              name: normalizedName,
              type: newEntity.type as EntityType,
              properties: { is_category: true },
              origin: 'ai_inferred',
              agentSource: 'inter_entity_edges',
            });
            entityId = created.id!;
          }

          nameToId.set(normalizedName.toLowerCase(), entityId);
          result.newEntities.push({ name: normalizedName, type: newEntity.type, id: entityId });
        } catch (error) {
          logger.error('Error creating category entity', { name: normalizedName, error: String(error) });
        }
      }
    }

    // Create edges between entities
    if (llmResult.edges && Array.isArray(llmResult.edges)) {
      for (const edge of llmResult.edges) {
        if (!edge.source_name || !edge.target_name || !edge.relation) continue;

        const sourceId = nameToId.get(edge.source_name.toLowerCase());
        const targetId = nameToId.get(edge.target_name.toLowerCase());

        if (!sourceId || !targetId || sourceId === targetId) continue;

        try {
          const edgeInput: CreateEdgeInput = {
            sourceId,
            targetId,
            relation: edge.relation,
            weight: edge.weight ?? 0.8,
            properties: {},
            evidence: [],
            origin: 'ai_inferred',
            agentSource: 'inter_entity_edges',
          };

          const created = await createEdge(userId, edgeInput);
          if (created) {
            result.edges.push({ sourceId, targetId, relation: edge.relation, weight: edge.weight ?? 0.8 });
          }
        } catch (error) {
          logger.error('Error creating inter-entity edge', {
            source: edge.source_name,
            target: edge.target_name,
            error: String(error),
          });
        }
      }
    }

    logger.info('Inter-entity edges created', {
      newEntities: result.newEntities.length,
      edges: result.edges.length,
    });

    return result;
  } catch (error) {
    logger.error('Error in inter-entity edge creation', { error: String(error) });
    return result;
  }
}

// =====================================================
// BATCH EXTRACTION (Method B)
// =====================================================

/**
 * Schedule nightly batch extraction job
 * Uses pg_cron to process unlinked records in batches
 *
 * This function sets up a pg_cron job in the public schema
 * that runs nightly at 2 AM to extract entities from records
 * that don't have associated entities yet.
 */
export async function scheduleNightlyExtraction(): Promise<void> {
  try {
    const cronAvailable = await pgSql.unsafe<Array<{ available: boolean }>>(
      `SELECT to_regclass('cron.job') IS NOT NULL AS available`
    );
    if (!cronAvailable[0]?.available) {
      logger.warn('pg_cron is not available; nightly extraction scheduler is disabled');
      return;
    }

    const existing = await pgSql.unsafe<Array<{ jobid: number }>>(
      `SELECT jobid FROM cron.job WHERE jobname = $1 LIMIT 1`,
      ['epitome-batch-extraction']
    );

    if (existing.length > 0) {
      logger.info('Nightly extraction job already scheduled', { jobId: existing[0].jobid });
      return;
    }

    // L-3 SECURITY FIX: Validate and clamp batchSize to prevent injection via env var
    const rawBatchSize = Math.floor(Number(process.env.NIGHTLY_EXTRACTION_BATCH_SIZE || 100));
    const batchSize = Math.max(1, Math.min(1000, Number.isFinite(rawBatchSize) ? rawBatchSize : 100));
    const command = `
DO $job$
DECLARE
  user_schema TEXT;
BEGIN
  FOR user_schema IN
    SELECT schema_name
    FROM public.users
    WHERE schema_name LIKE 'user_%'
  LOOP
    PERFORM public.epitome_batch_extract_entities(user_schema, ${batchSize});
  END LOOP;
END
$job$;
`.trim();

    const scheduled = await pgSql.unsafe<Array<{ jobid: number }>>(
      `SELECT cron.schedule($1, $2, $3) as jobid`,
      ['epitome-batch-extraction', '0 2 * * *', command]
    );

    logger.info('Nightly extraction job scheduled successfully', {
      jobId: scheduled[0]?.jobid,
      batchSize,
    });
  } catch (error) {
    logger.error('Error scheduling nightly extraction', { error: String(error) });
    throw error;
  }
}

export interface NightlyExtractionStatus {
  enabled: boolean;
  pgCronAvailable: boolean;
  scheduled: boolean;
  jobId?: number;
  schedule?: string;
  active?: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunMessage?: string | null;
}

export async function getNightlyExtractionStatus(): Promise<NightlyExtractionStatus> {
  const enabled = process.env.ENABLE_NIGHTLY_EXTRACTION === 'true';

  const cronAvailable = await pgSql.unsafe<Array<{ available: boolean }>>(
    `SELECT to_regclass('cron.job') IS NOT NULL AS available`
  );
  if (!cronAvailable[0]?.available) {
    return {
      enabled,
      pgCronAvailable: false,
      scheduled: false,
    };
  }

  const jobs = await pgSql.unsafe<
    Array<{ jobid: number; schedule: string; active: boolean }>
  >(
    `SELECT jobid, schedule, active
     FROM cron.job
     WHERE jobname = $1
     LIMIT 1`,
    ['epitome-batch-extraction']
  );

  if (jobs.length === 0) {
    return {
      enabled,
      pgCronAvailable: true,
      scheduled: false,
    };
  }

  const job = jobs[0];
  const runRows = await pgSql.unsafe<
    Array<{ end_time: string | null; status: string | null; return_message: string | null }>
  >(
    `SELECT end_time, status, return_message
     FROM cron.job_run_details
     WHERE jobid = $1
     ORDER BY start_time DESC
     LIMIT 1`,
    [job.jobid]
  );

  const lastRun = runRows[0];
  return {
    enabled,
    pgCronAvailable: true,
    scheduled: true,
    jobId: job.jobid,
    schedule: job.schedule,
    active: job.active,
    lastRunAt: lastRun?.end_time || null,
    lastRunStatus: lastRun?.status || null,
    lastRunMessage: lastRun?.return_message || null,
  };
}

/**
 * Run batch extraction for a user schema
 * Processes up to 50 unlinked records per run
 *
 * @param userId - User ID for schema isolation
 * @returns Number of records processed
 */
export async function runBatchExtraction(userId: string): Promise<number> {
  return withUserSchema(userId, async (tx) => {
    // Find tables in the registry
    const tables = await tx.unsafe(`
      SELECT table_name
      FROM _table_registry
      WHERE table_name NOT IN ('_table_registry', '_vector_collections')
      ORDER BY updated_at DESC
      LIMIT 10
    `);

    let totalProcessed = 0;

    for (const { table_name } of tables) {
      // Find records without entity links (no evidence in edges table)
      const records = await tx<any[]>`
        SELECT * FROM ${tx(table_name)}
        WHERE _deleted_at IS NULL
          AND id NOT IN (
            SELECT DISTINCT (evidence_item->>'row_id')::INTEGER
            FROM edges,
            LATERAL jsonb_array_elements(evidence) AS evidence_item
            WHERE evidence_item->>'table' = ${table_name}
              AND _deleted_at IS NULL
          )
        LIMIT 50
      `;

      for (const record of records) {
        // Try rule-based first, fallback to LLM
        const entities = extractEntitiesRuleBased(table_name, record);

        if (entities.length === 0) {
          // Fallback to LLM for unknown tables
          const llmEntities = await extractEntitiesLLM(table_name, record);
          entities.push(...llmEntities);
        }

        // Create entities (extraction result handling done in main function)
        totalProcessed++;
      }
    }

    return totalProcessed;
  });
}

// =====================================================
// OWNER ENTITY HELPER
// =====================================================

/**
 * Find or create the owner entity for edge sources.
 *
 * Looks up by `(properties->>'is_owner')::boolean = true` instead of by name,
 * so the same node is reused regardless of whether the name is "user" or the
 * person's real name. If no owner entity exists yet, pulls the name from
 * the profile table and creates with the real name. Falls back to 'user'
 * only if no profile name exists.
 */
async function findOrCreateOwnerEntity(
  userId: string
): Promise<{ id: number }> {
  // Look up existing owner entity by is_owner property
  const existing = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe(`
      SELECT id, name
      FROM entities
      WHERE type = 'person'
        AND (properties->>'is_owner')::boolean = true
        AND _deleted_at IS NULL
      ORDER BY id ASC
      LIMIT 1
    `);
    return rows[0] || null;
  });

  if (existing) {
    return { id: existing.id };
  }

  // No owner entity yet — get real name from profile
  let ownerName = 'user';
  try {
    const profile = await getLatestProfile(userId);
    if (profile?.data?.name && typeof profile.data.name === 'string') {
      ownerName = profile.data.name;
    }
  } catch {
    // Profile may not exist yet — fall back to 'user'
  }

  const created = await createEntity(userId, {
    name: ownerName,
    type: 'person',
    properties: { is_owner: true },
    origin: 'system',
  });

  return { id: created.id! };
}

// =====================================================
// MAIN EXTRACTION INTERFACE
// =====================================================

/**
 * Extract entities from a record and create them in the graph
 *
 * @param userId - User ID for schema isolation
 * @param tableName - Name of the table
 * @param record - Record data
 * @param method - Extraction method to use
 * @returns Extraction result with created entities
 */
export async function extractEntitiesFromRecord(
  userId: string,
  tableName: string,
  record: Record<string, any>,
  method: ExtractionMethod = 'rule_based',
  tier?: string
): Promise<ExtractionResult> {
  let entities: ExtractedEntity[] = [];
  let methodUsed: ExtractionResult['method'] = method;

  // Extract entities based on method
  if (method === 'rule_based') {
    entities = extractEntitiesRuleBased(tableName, record);
  } else if (method === 'llm') {
    entities = await extractEntitiesLLM(tableName, record, userId);
  } else if (method === 'llm_first') {
    entities = await extractEntitiesLLM(tableName, record, userId);
    if (entities.length === 0) {
      entities = extractEntitiesRuleBased(tableName, record);
      if (entities.length > 0) {
        methodUsed = 'rule_based';
      } else {
        methodUsed = 'llm';
      }
    } else {
      methodUsed = 'llm';
    }
  } else if (method === 'batch') {
    // Batch mode: try rule-based first, fallback to LLM
    entities = extractEntitiesRuleBased(tableName, record);
    if (entities.length === 0) {
      entities = await extractEntitiesLLM(tableName, record, userId);
      methodUsed = 'llm';
    } else {
      methodUsed = 'rule_based';
    }
  }

  entities = sanitizeExtractedEntities(entities);

  // Soft limit check for graph entities (skip extraction if over limit, don't fail the write)
  if (tier) {
    const { exceeded, current, limit } = await softCheckLimit(userId, tier, 'graphEntities');
    if (exceeded) {
      logger.info('Entity extraction skipped: graph entity limit exceeded', {
        userId, current, limit, skippedEntities: entities.map(e => e.name),
      });
      // Emit audit event for observability
      try {
        await withUserSchema(userId, async (tx) => {
          await tx.unsafe(
            `INSERT INTO audit_log (agent_id, action, resource, details, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [
              'system',
              'write',
              'graph_entities',
              JSON.stringify({
                action: 'entity_extraction_skipped',
                reason: 'tier_limit_exceeded',
                current,
                limit,
                skipped_entities: entities.map(e => ({ name: e.name, type: e.type })),
              }),
            ]
          );
        });
      } catch (auditErr) {
        logger.warn('Failed to log extraction skip audit event', { error: String(auditErr) });
      }
      return { entities: [], method: methodUsed };
    }
  }

  // Create entities in the graph and collect refs for inter-entity edges
  const createdEntityRefs: CreatedEntityRef[] = [];
  // Map "type:lowername" → entityId for resolving sourceRef within this pass
  const entityIdMap = new Map<string, number>();

  for (const extracted of entities) {
    try {
      // Check for deduplication before creating
      const candidate: EntityCandidate = {
        type: extracted.type,
        name: extracted.name,
        properties: extracted.properties,
      };

      // Check if entity already exists (deduplication)
      const existingEntityId = await checkAndDeduplicateBeforeCreate(userId, candidate);

      let entityId: number;
      let createdEntity;

      if (existingEntityId) {
        // Use existing entity
        entityId = existingEntityId;
        // Entity already exists, just increment mention count
        await withUserSchema(userId, async (tx) => {
          await tx.unsafe(`
            UPDATE entities
            SET mention_count = mention_count + 1,
                last_seen = NOW()
            WHERE id = ${existingEntityId}
          `);
        });
        createdEntity = { id: entityId };
      } else {
        // Create new entity
        const entityInput: CreateEntityInput = {
          name: extracted.name,
          type: extracted.type,
          properties: extracted.properties || {},
          origin: methodUsed === 'rule_based' ? 'ai_pattern' : 'ai_inferred',
          agentSource: 'entity_extraction',
        };

        createdEntity = await createEntity(userId, entityInput, tier || 'free');
        entityId = createdEntity.id!;
      }

      // Track entity in map for sourceRef resolution
      entityIdMap.set(`${extracted.type}:${extracted.name.toLowerCase()}`, entityId);

      // Collect ref for inter-entity edge creation
      createdEntityRefs.push({ id: entityId, name: extracted.name, type: extracted.type });

      let edgeCreated = false;

      // Create edge if specified
      if (extracted.edge && entityId) {
        let sourceId: number;

        if (extracted.edge.sourceRef) {
          // Resolve sourceRef: check map first, then DB, then fall back to owner
          const mapKey = `${extracted.edge.sourceRef.type}:${extracted.edge.sourceRef.name.toLowerCase()}`;
          const mappedId = entityIdMap.get(mapKey);

          if (mappedId) {
            sourceId = mappedId;
          } else {
            // DB lookup via fuzzy search
            const dbResults = await getEntityByName(
              userId,
              extracted.edge.sourceRef.name,
              extracted.edge.sourceRef.type as any,
              0.8,  // high threshold for exact-ish match
              1,
            );
            if (dbResults.length > 0) {
              sourceId = dbResults[0].id;
            } else {
              logger.warn('sourceRef entity not found, falling back to owner', {
                sourceRef: extracted.edge.sourceRef,
                target: extracted.name,
              });
              const ownerEntity = await findOrCreateOwnerEntity(userId);
              sourceId = ownerEntity.id;
            }
          }
        } else {
          // Default: owner is the edge source
          const ownerEntity = await findOrCreateOwnerEntity(userId);
          sourceId = ownerEntity.id;
        }

        const edgeInput: CreateEdgeInput = {
          sourceId,
          targetId: entityId,
          relation: extracted.edge.relation,
          weight: extracted.edge.weight || 1.0,
          properties: extracted.edge.properties || {},
          evidence: [
            {
              table: tableName,
              row_id: record.id,
              method: methodUsed,
              extracted_at: new Date().toISOString(),
            },
          ],
          origin: methodUsed === 'rule_based' ? 'ai_pattern' : 'ai_inferred',
          agentSource: 'entity_extraction',
        };

        const createdEdge = await createEdge(userId, edgeInput);
        if (!createdEdge) {
          logger.info('Edge skipped (quarantined or rejected)', {
            entity: extracted.name,
            relation: extracted.edge.relation,
          });
        } else if (!extracted.edge.sourceRef && ['works_at', 'attended'].includes(extracted.edge.relation)) {
          edgeCreated = true;
          // Fire-and-forget: sync entity data to profile
          void syncEntityToProfile(userId, {
            name: extracted.name, type: extracted.type, properties: extracted.properties,
          }, extracted.edge.relation, extracted.edge.properties || {}, true).catch(err =>
            logger.warn('Profile sync failed', { error: String(err) })
          );
        } else {
          edgeCreated = true;
        }
      }

      // Orphan prevention: if no valid edge was created, add a fallback owner link.
      if (!edgeCreated && entityId) {
        const ownerEntity = await findOrCreateOwnerEntity(userId);
        if (ownerEntity.id !== entityId) {
          const fallbackEdge = await createEdge(userId, {
            sourceId: ownerEntity.id,
            targetId: entityId,
            relation: 'related_to',
            weight: 0.2,
            properties: {
              fallback: true,
              reason: extracted.edge ? 'primary_edge_rejected' : 'missing_edge',
            },
            evidence: [
              {
                table: tableName,
                row_id: record.id,
                method: methodUsed,
                extracted_at: new Date().toISOString(),
              },
            ],
            origin: 'system',
            agentSource: 'entity_extraction_fallback',
          });

          if (!fallbackEdge) {
            logger.warn('Fallback edge creation rejected', {
              entity: extracted.name,
              entityId,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error creating entity', { entityName: extracted.name, error: String(error) });
      // Continue with other entities even if one fails
    }
  }

  // Fire-and-forget: create inter-entity edges asynchronously
  if (createdEntityRefs.length >= 2) {
    createInterEntityEdgesLLM(userId, createdEntityRefs).catch((err) => {
      logger.error('Error creating inter-entity edges', { error: String(err) });
    });
  }

  return {
    entities,
    method: methodUsed,
  };
}
