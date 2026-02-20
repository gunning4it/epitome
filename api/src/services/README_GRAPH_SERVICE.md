# GraphService Documentation

**Version**: 1.0.0 (Phase 2.1 - Part A: Basic CRUD)
**Author**: graph-engineer agent
**Date**: 2026-02-12

## Overview

GraphService provides basic CRUD operations for the Epitome knowledge graph. All graph data is stored in PostgreSQL using `entities` and `edges` tables. This is Part A of the graph implementation — basic operations only. Advanced features (extraction, deduplication, thread linking) are deferred to Phase 3.

## Architecture

```
Knowledge Graph (PostgreSQL)
├── entities (nodes)
│   ├── 11 entity types: person, organization, place, food, topic, preference, event, activity, medication, media, custom
│   ├── Unique constraint: (type, lower(name)) WHERE _deleted_at IS NULL
│   └── Fuzzy search via pg_trgm similarity
│
├── edges (relationships)
│   ├── Directed, typed, weighted relationships
│   ├── Evidence array tracks data sources
│   └── Deduplication: increment weight instead of duplicate rows
│
└── memory_meta
    ├── Quality tracking for all entities/edges
    └── Confidence scoring, status lifecycle
```

## Entity Types

| Type | Examples | Properties |
|------|----------|------------|
| person | Sarah, Mike, Dr. Chen | relation, age, birthday, contact |
| place | Bestia, Home, Office, Paris | address, category, coordinates, cuisine |
| food | Italian food, Sushi, Pasta | cuisine, dietary_flags, allergens |
| topic | Machine learning, Photography | interest_level, expertise |
| preference | Spicy food, Morning runs | strength, category, context |
| event | Birthday dinner, Conference | date, location, attendees |
| activity | Running, Yoga, Reading | frequency, duration |
| medication | Metformin, Vitamin D | dose, frequency, purpose |
| media | The Bear, Shogun | type (show/book/movie), rating |
| custom | (user-defined) | (freeform JSONB) |

## Edge Relations

Common relations: `likes`, `dislikes`, `ate`, `visited`, `attended`, `located_at`, `married_to`, `works_at`, `takes`, `performed`, `category`, `related_to`, `thread_next`, `contradicts`, `interested_in`, `allergic_to`, `founded`, `parent_of`, `friend`, `knows`, `family_member`, `lives_at`, `works_out_at`, `has_skill`, `follows`, `tracks`, `similar_to`, `part_of`, `has_condition`

## API Reference

### Entity Operations

#### createEntity(userId, input)

Create a new entity in the knowledge graph.

```typescript
const entity = await createEntity(userId, {
  type: 'person',
  name: 'Alice',
  properties: { relation: 'friend', birthday: '1990-05-20' },
  origin: 'user_stated', // or 'ai_inferred', 'imported', etc.
  agentSource: 'claude-desktop',
});
```

**Duplicate Prevention**: Enforces unique constraint on (type, lower(name)). Throws `DUPLICATE_ENTITY` error if duplicate exists.

**Returns**: `EntityWithMeta` (entity + memory_meta record)

---

#### getEntity(userId, entityId, includeDeleted?)

Fetch entity by ID.

```typescript
const entity = await getEntity(userId, 42);
// Returns null if not found or soft-deleted

const deleted = await getEntity(userId, 42, true);
// Returns entity even if soft-deleted
```

**Returns**: `EntityWithMeta | null`

---

#### updateEntity(userId, entityId, updates)

Update entity properties, name, or confidence.

```typescript
const updated = await updateEntity(userId, 42, {
  name: 'Alice Chen',
  properties: { age: 32 }, // Deep merged with existing properties
  confidence: 0.95,
});
```

**Property Merging**: Deep merge — new properties merged into existing, not replaced.

**Returns**: `EntityWithMeta`

---

#### deleteEntity(userId, entityId)

Soft delete entity.

```typescript
await deleteEntity(userId, 42);
// Sets _deleted_at timestamp
// Updates memory_meta status to 'rejected'
// Cascade handled by database trigger
```

**Returns**: `void`

---

#### listEntities(userId, filters?)

List entities with optional filters.

```typescript
const entities = await listEntities(userId, {
  type: 'person',
  confidenceMin: 0.7,
  confidenceMax: 1.0,
  limit: 50,
  offset: 0,
});
```

**Ordering**: confidence DESC, name ASC

**Returns**: `EntityWithMeta[]`

---

#### getEntityByName(userId, name, type?, similarityThreshold?, limit?)

Fuzzy search entities by name using pg_trgm similarity.

```typescript
const results = await getEntityByName(userId, 'Bestea', 'place', 0.3, 10);
// Finds "Bestia" despite typo
// Returns entities with similarity scores
```

**Returns**: `EntitySearchResult[]` (includes similarity score)

---

### Edge Operations

#### createEdge(userId, input)

Create edge between entities. Implements automatic deduplication.

```typescript
const edge = await createEdge(userId, {
  sourceId: 1,
  targetId: 2,
  relation: 'married_to',
  weight: 1.0,
  evidence: [{ type: 'table', table: 'profile', row_id: 1 }],
  origin: 'user_stated',
});
```

**Deduplication**: If edge with same (source, target, relation) exists:
- Increments weight instead of creating duplicate row
- Appends new evidence to existing array
- Updates last_seen timestamp

**Returns**: `EdgeWithMeta` (new or updated edge)

---

#### getEdge(userId, edgeId)

Fetch edge by ID.

```typescript
const edge = await getEdge(userId, 5);
```

**Returns**: `EdgeWithMeta | null`

---

#### updateEdge(userId, edgeId, updates)

Update edge properties.

```typescript
const updated = await updateEdge(userId, 5, {
  weight: 3.0,
  evidence: [{ type: 'vector', vector_id: 17 }], // Appended to existing
  confidence: 0.8,
});
```

**Evidence Merging**: New evidence appended to array, not replaced.

**Returns**: `EdgeWithMeta`

---

#### deleteEdge(userId, edgeId)

Delete edge (hard delete — edges don't support soft delete).

```typescript
await deleteEdge(userId, 5);
// Removes edge row
// Updates memory_meta status to 'rejected'
```

**Returns**: `void`

---

#### listEdges(userId, filters?)

List edges with optional filters.

```typescript
const edges = await listEdges(userId, {
  sourceId: 1,
  targetId: 2,
  relation: 'likes',
  limit: 50,
  offset: 0,
});
```

**Ordering**: weight DESC

**Returns**: `EdgeWithMeta[]`

---

### Graph Queries

#### getNeighbors(userId, entityId, options?)

Single-hop graph traversal. Find entities connected to a given entity.

```typescript
const neighbors = await getNeighbors(userId, 1, {
  direction: 'outbound', // or 'inbound' or 'both'
  relationFilter: 'likes',
  confidenceMin: 0.5,
  limit: 50,
});
```

**Directions**:
- `outbound`: Entities this entity points to (A → B)
- `inbound`: Entities that point to this entity (A ← B)
- `both`: All connected entities (default)

**Returns**: `EntityWithEdge[]` (entities with their connecting edge metadata)

---

## Memory Quality Integration

GraphService integrates with the Memory Quality Engine via `memory_meta` records and uses `MemoryQualityService` for confidence scoring.

### Confidence Scoring

Confidence scores are assigned based on data origin using `ORIGIN_CONFIDENCE` from MemoryQualityService:

```typescript
user_typed   → 0.95 confidence (trusted)  // Explicit dashboard input
user_stated  → 0.85 confidence (trusted)  // Direct statement to AI
imported     → 0.80 confidence (active)   // Google/Apple import
ai_inferred  → 0.40 confidence (active)   // AI inferred from conversation
ai_pattern   → 0.30 confidence (unvetted) // Statistical inference
contradicted → 0.10 confidence (decayed)  // Demoted by contradiction
```

The service uses `createMemoryMeta()` which automatically:
- Sets initial confidence based on origin
- Determines initial status (unvetted/active/trusted) based on confidence threshold
- Creates promote_history tracking

### Status Lifecycle

```
unvetted → active → trusted
             ↓
          decayed
             ↓
          rejected (on delete)
```

---

## Error Handling

| Error | Meaning | Example |
|-------|---------|---------|
| `DUPLICATE_ENTITY` | Entity with same (type, name) exists | Creating "Pizza" when "pizza" exists |
| `NOT_FOUND` | Entity/edge not found or deleted | Updating non-existent entity |
| `INTERNAL_ERROR` | Unexpected state (should never happen) | Entity disappeared after update |

---

## Database Schema Requirements

GraphService assumes the following schema exists (from Phase 1.1):

### Extensions
- `pg_trgm` — Trigram similarity for fuzzy search

### Tables
- `entities` — With unique index on (type, lower(name))
- `edges` — With unique index on (source_id, target_id, relation)
- `memory_meta` — Quality metadata

### Indexes
- `idx_entities_name_trgm` — GIN index for fuzzy search
- `idx_edges_traverse` — Composite index for graph traversal
- `idx_edges_source`, `idx_edges_target` — Traversal optimization

---

## Testing

### Run Tests

```bash
# All graph service tests
npm test -- tests/unit/services/graphService.test.ts

# With coverage
npm run test:coverage -- tests/unit/services/graphService.test.ts
```

### Test Coverage

**38 test cases** across 3 test suites:
- Entity Operations (21 tests)
- Edge Operations (11 tests)
- Graph Queries (6 tests)

**Target**: 90%+ code coverage

---

## Future Enhancements (Phase 3.1)

GraphService Part A provides basic CRUD. Advanced features deferred to Phase 3:

1. **Entity Extraction Pipeline**
   - Method C: Rule-based (meals, workouts, medications)
   - Method A: LLM-assisted for unknown tables
   - Method B: Batch extraction for bulk imports

2. **Advanced Deduplication**
   - Exact match (current)
   - Fuzzy match (pg_trgm)
   - Alias matching (properties.aliases array)
   - Context disambiguation (use edge context)

3. **Thread Linking**
   - Temporal proximity
   - Semantic similarity
   - Entity overlap
   - Anaphora resolution

4. **Multi-Hop Traversal**
   - Recursive CTEs for depth 2-4 queries
   - Structured query params
   - SQL-over-graph support

---

## Performance Notes

- **Personal graphs**: Hundreds to thousands of nodes
- **Traversal depth**: Rarely >3 hops
- **Query performance**: <10ms for single-hop with proper indexes
- **No Neo4j needed**: PostgreSQL handles personal-scale graphs efficiently

---

## References

- **Data Model**: `.claude/docs/EPITOME_DATA_MODEL.md` §5.3-5.4, §6.3-6.4
- **Tech Spec**: `.claude/docs/EPITOME_TECH_SPEC.md` §5.4, §6.2-6.4
- **Skill**: `.claude/skills/knowledge-graph/SKILL.md`
